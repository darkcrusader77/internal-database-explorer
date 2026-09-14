import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Adapter, CatalogInput, CatalogOperation, ConnectionProfile, Execution, ProfileStore, UserError } from './types';
import { boundedInteger, serialize } from './format';
import { validateReadQuery } from './readOnly';
import { validateProfile } from './profileRepository';

export function safeError(error: unknown): string {
  if (error instanceof UserError) return error.message;
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    '28P01': 'Authentication failed. Check the saved username and password.',
    '28000': 'The server rejected authentication. Check its access policy.',
    '3D000': 'The configured database does not exist.',
    '42501': 'The database role does not have permission for this operation.',
    '25006': 'PostgreSQL rejected a write inside the read-only transaction.',
    '57014': 'PostgreSQL cancelled the query or its statement timeout expired.',
    '42P01': 'A referenced relation does not exist in this database or search path.',
    '42703': 'A referenced column does not exist. Inspect the table columns.',
    '42601': 'PostgreSQL rejected the query syntax.',
    ECONNREFUSED: 'Connection refused. Check the host, port, and server availability.',
    ENOTFOUND: 'Database hostname could not be resolved.',
    ETIMEDOUT: 'The database connection timed out.',
    SELF_SIGNED_CERT_IN_CHAIN: 'The server certificate is not trusted. Configure the appropriate CA certificate.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'The server certificate is not trusted. Configure the appropriate CA certificate.',
    ELOGIN: 'SQL Server authentication failed. Check the username, password, and SQL authentication configuration.',
    ESOCKET: 'SQL Server connection failed. Check the host, port, TLS settings, and server availability.',
    ETIMEOUT: 'The database connection or query timed out.',
    'ORA-01017': 'Oracle authentication failed. Check the username and password.',
    'ORA-12154': 'Oracle could not resolve the connection. Check the service name and host.',
    'ORA-12514': 'The Oracle listener does not recognize the configured service name.',
    'ORA-00942': 'The Oracle table or view is unavailable to this user.',
    'ORA-01031': 'The Oracle user does not have permission for this operation.',
    'ORA-01456': 'Oracle rejected a write inside the read-only transaction.',
    '401': 'Authentication was rejected. Refresh the OAuth token or Google Application Default Credentials.',
    '403': 'Access was denied. Check the database role, cloud IAM permissions, and BigQuery billing limit.',
  };
  // Database errors may embed passwords, query literals, or result values. Never forward raw text.
  return messages[code ?? ''] ?? 'Database operation failed. Check connection settings, TLS certificates, SQL, and database permissions. Server error details are withheld to avoid exposing data.';
}

export class DatabaseService extends EventEmitter {
  readonly sessionId = randomUUID();
  private executions = new Map<string, Execution>();
  private operations = new Map<string, { connectionId: string; controller: AbortController }>();
  private verified = new Map<string, string>();
  private closed = false;
  constructor(readonly profiles: ProfileStore, private readonly adapters: Partial<Record<ConnectionProfile['engine'], Adapter>>, private readonly trusted: () => boolean) { super(); }

  private profile(id: string, source: 'user' | 'agent'): ConnectionProfile {
    if (this.closed) throw new UserError('This extension session has ended.');
    if (!this.trusted()) throw new UserError('Trust this workspace before accessing databases.');
    const profile = this.profiles.list().find(p => p.id === id);
    if (!profile) throw new UserError('Connection not found. List connections again.');
    if (source === 'agent' && !profile.agentEnabled) throw new UserError('Copilot access is disabled for this connection. Enable it in the connection editor.');
    return profile;
  }
  private adapter(profile: ConnectionProfile): Adapter {
    const adapter = this.adapters[profile.engine];
    if (!adapter) throw new UserError(`The ${profile.engine} adapter is not implemented yet.`);
    return adapter;
  }
  listConnections(source: 'user' | 'agent' = 'user') {
    if (!this.trusted()) throw new UserError('Trust this workspace before accessing connections.');
    return this.profiles.list().filter(p => source === 'user' || p.agentEnabled).map(p => ({
      id: p.id, name: p.name, engine: p.engine, database: p.database, agentEnabled: p.agentEnabled,
      parameterStyle: { postgres: '$1, $2', sqlserver: '@p1, @p2', oracle: ':1, :2', snowflake: '?, ?', bigquery: '?, ?' }[p.engine],
      ...(p.engine === 'bigquery' ? { location: p.location, maximumBytesBilled: p.maximumBytesBilled } : {}),
      status: this.verified.get(p.id) === p.revision ? 'verified in this window' : 'not tested in this window',
      capabilities: { readQueries: !!this.adapters[p.engine], writes: false, metadata: !!this.adapters[p.engine] },
    }));
  }
  private operation(connectionId: string, signal?: AbortSignal) {
    if (this.operations.size >= 4) throw new UserError('This window already has four database operations running. Wait or cancel one.');
    signal?.throwIfAborted();
    const id = `${this.sessionId}:${randomUUID()}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.operations.set(id, { connectionId, controller });
    return { id, controller, done: () => { signal?.removeEventListener('abort', abort); this.operations.delete(id); } };
  }
  async testConnection(id: string, signal?: AbortSignal): Promise<void> {
    const profile = this.profile(id, 'user');
    const operation = this.operation(id, signal);
    try {
      await this.adapter(profile).test(profile, await this.profiles.password(profile.secretId), operation.controller.signal);
      this.verified.set(id, profile.revision);
      this.emit('change');
    } catch (error) { throw new UserError(safeError(error)); }
    finally { operation.done(); }
  }
  async testDraft(profile: ConnectionProfile, password: string | undefined, signal: AbortSignal): Promise<void> {
    if (this.closed) throw new UserError('This extension session has ended.');
    if (!this.trusted()) throw new UserError('Trust this workspace before testing connections.');
    validateProfile(profile);
    const operation = this.operation(profile.id, signal);
    try { await this.adapter(profile).test(profile, password, operation.controller.signal); }
    catch (error) { throw new UserError(operation.controller.signal.aborted ? 'Connection test cancelled.' : safeError(error)); }
    finally { operation.done(); }
  }
  async catalog(id: string, operationName: CatalogOperation, input: CatalogInput, source: 'user' | 'agent', signal?: AbortSignal): Promise<unknown> {
    const profile = this.profile(id, source);
    const operation = this.operation(id, signal);
    try {
      const result = await this.adapter(profile).catalog(profile, await this.profiles.password(profile.secretId), operationName, input, operation.controller.signal);
      this.profile(id, source);
      return result;
    } catch (error) { throw new UserError(operation.controller.signal.aborted ? 'Operation cancelled in this window.' : safeError(error)); }
    finally { operation.done(); }
  }
  startQuery(id: string, sql: string, parameters: unknown[] = [], source: 'user' | 'agent' = 'user', maxRows = 1000, timeoutMs = 30_000): Execution {
    const profile = this.profile(id, source);
    const adapter = this.adapter(profile);
    validateReadQuery(sql, profile.engine);
    boundedInteger(maxRows, 1000, 1, 1000);
    boundedInteger(timeoutMs, 30_000, 1000, 120_000);
    if (!Array.isArray(parameters) || Buffer.byteLength(serialize(parameters)) > 100_000) throw new UserError('Parameters must be an array of at most 100 KB.');
    const operation = this.operation(id);
    const execution: Execution = { id: operation.id, connectionId: id, connectionName: profile.name, database: profile.database,
      source, sql, startedAt: new Date().toISOString(), status: 'running' };
    this.executions.set(execution.id, execution);
    this.emit('change', execution.id);
    void (async () => {
      try {
        const password = await this.profiles.password(profile.secretId);
        const result = await adapter.query(profile, password, { sql, parameters, maxRows, timeoutMs, signal: operation.controller.signal });
        if (operation.controller.signal.aborted) execution.status = 'cancelled';
        else { execution.status = 'completed'; execution.result = result; }
      } catch (error) {
        execution.status = operation.controller.signal.aborted ? 'cancelled' : 'failed';
        if (execution.status === 'failed') execution.error = safeError(error);
      } finally {
        execution.durationMs = Date.now() - Date.parse(execution.startedAt);
        operation.done();
        this.prune();
        this.emit('change', execution.id);
      }
    })();
    return execution;
  }
  private prune() {
    const finished = [...this.executions.values()].filter(q => q.status !== 'running');
    for (const q of finished.slice(0, Math.max(0, finished.length - 10))) delete q.result;
    for (const q of finished.slice(0, Math.max(0, finished.length - 50))) this.executions.delete(q.id);
  }
  getExecution(connectionId: string, queryId: string, source: 'user' | 'agent' = 'user'): Execution {
    this.profile(connectionId, source); // Recheck shared profile policy on every result access.
    const execution = this.executions.get(queryId);
    if (!execution || execution.connectionId !== connectionId) throw new UserError('Query not found in this VS Code window and connection. Query handles cannot be shared between windows.');
    return execution;
  }
  getResults(connectionId: string, queryId: string, source: 'user' | 'agent', offset = 0, limit = 100) {
    boundedInteger(offset, 0, 0, 1000);
    boundedInteger(limit, 100, 1, 200);
    const q = this.getExecution(connectionId, queryId, source);
    const result = q.result;
    return { queryId, connectionId, database: q.database, status: q.status, error: q.error, durationMs: q.durationMs,
      columns: result?.columns ?? [], rows: result?.rows.slice(offset, offset + limit) ?? [], offset,
      fetchedRows: result?.rows.length ?? 0, totalRows: null,
      truncated: result?.truncated ?? false, cellsTruncated: result?.cellsTruncated ?? false,
      warnings: result?.warnings ?? [],
      resultExpired: q.status === 'completed' && !result,
      nextOffset: result && offset + limit < result.rows.length ? offset + limit : null,
    };
  }
  cancel(connectionId: string, queryId: string, source: 'user' | 'agent' = 'user') {
    const execution = this.getExecution(connectionId, queryId, source);
    this.operations.get(queryId)?.controller.abort();
    return { queryId, status: execution.status, cancellationRequested: execution.status === 'running' };
  }
  disconnect(connectionId: string) {
    for (const operation of this.operations.values()) if (operation.connectionId === connectionId) operation.controller.abort();
    this.verified.delete(connectionId);
    for (const adapter of Object.values(this.adapters)) adapter?.disconnect?.(connectionId);
    for (const q of this.executions.values()) if (q.connectionId === connectionId) delete q.result;
    this.emit('change');
  }
  history() { return [...this.executions.values()].reverse(); }
  clearHistory() {
    for (const q of this.executions.values()) if (q.status !== 'running') this.executions.delete(q.id);
    this.emit('change');
  }
  preview(id: string, schema: string, table: string) { return this.adapter(this.profile(id, 'user')).preview(schema, table); }
  dispose() {
    this.closed = true;
    for (const operation of this.operations.values()) operation.controller.abort();
    for (const adapter of Object.values(this.adapters)) adapter?.dispose?.();
    this.executions.clear();
    this.removeAllListeners();
  }
}
