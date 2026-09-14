import type * as Snowflake from 'snowflake-sdk';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { ConnectionProfile, QueryOptions } from '../core/types';
import { httpsUrl } from '../core/engines';
import { CatalogAdapter } from './catalog';
import { deadline, quote, ResultCollector } from './common';

type Session = { profileId: string; revision: string; connection: Snowflake.Connection; busy: boolean; retired: boolean };
export function snowflakeConfig(p: ConnectionProfile, credential: string | undefined): Snowflake.ConnectionOptions {
  const url = httpsUrl(p.accountUrl ?? '');
  return { account: url.hostname.split('.')[0], accessUrl: url.origin, database: p.database,
    ...(p.schema ? { schema: p.schema } : {}), ...(p.warehouse ? { warehouse: p.warehouse } : {}), ...(p.role ? { role: p.role } : {}),
    ...(p.oauthMode === 'token' ? { authenticator: 'OAUTH', token: credential ?? '' } : {
      authenticator: 'OAUTH_AUTHORIZATION_CODE', oauthClientId: p.oauthClientId, oauthClientSecret: credential ?? '',
      ...(p.oauthAuthorizationUrl ? { oauthAuthorizationUrl: p.oauthAuthorizationUrl } : {}),
      ...(p.oauthTokenRequestUrl ? { oauthTokenRequestUrl: p.oauthTokenRequestUrl } : {}),
      ...(p.oauthScope ? { oauthScope: p.oauthScope } : {}),
    }),
    // No fixed callback port or shared token cache: each host owns its OAuth flow/session.
    clientStoreTemporaryCredential: false, clientSessionKeepAlive: false,
    browserActionTimeout: 120_000, timeout: 15_000, retryTimeout: 0, rowMode: 'array', rowStreamHighWaterMark: 16,
  } as Snowflake.ConnectionOptions;
}

export class SnowflakeAdapter extends CatalogAdapter {
  constructor(private readonly loadDriver: () => typeof Snowflake = () => { const driver = require('snowflake-sdk') as typeof Snowflake; driver.configure({ logLevel: 'OFF' }); return driver; }) { super(); }
  private readonly sessions = new Set<Session>();
  preview(schema: string, table: string) { return `SELECT * FROM ${quote(schema)}.${quote(table)} LIMIT 100;`; }
  private destroy(session: Session) {
    session.retired = true; this.sessions.delete(session);
    try { session.connection.destroy(() => {}); } catch { /* Connection may already be closed. */ }
  }
  disconnect(id: string) { for (const session of this.sessions) if (session.profileId === id) this.destroy(session); }
  dispose() { for (const session of this.sessions) this.destroy(session); }
  override async test(p: ConnectionProfile, credential: string | undefined, signal: AbortSignal) {
    const draft = { ...p, id: `test:${randomUUID()}` };
    try { await super.test(draft, credential, signal); }
    finally { this.disconnect(draft.id); } // Never disconnect an existing query when testing its profile.
  }
  async query(p: ConnectionProfile, credential: string | undefined, options: QueryOptions) {
    const snowflake = this.loadDriver();
    let session: Session | undefined;
    let statement: Snowflake.RowStatement | undefined;
    let stream: Readable | undefined;
    const stop = () => {
      statement?.cancel(() => {}); stream?.destroy(); if (session) this.destroy(session);
    };
    // Interactive authentication has its own bounded window; SQL keeps the user's query deadline.
    let timer = deadline(options.signal, 120_000, stop);
    let successful = false;
    try {
      for (const old of this.sessions) if (old.profileId === p.id && old.revision !== p.revision) {
        old.retired = true; if (!old.busy) this.destroy(old);
      }
      session = [...this.sessions].find(value => value.profileId === p.id && value.revision === p.revision && !value.busy && !value.retired);
      if (session) session.busy = true;
      else {
        session = { profileId: p.id, revision: p.revision, connection: snowflake.createConnection(snowflakeConfig(p, credential)), busy: true, retired: false };
        this.sessions.add(session);
        const created = session;
        await timer.wait(created.connection.connectAsync().then(() => { if (created.retired) this.destroy(created); }));
      }
      timer.check();
      timer.finish(); timer = deadline(options.signal, options.timeoutMs, stop);
      const connection = session.connection;
      statement = await timer.wait(new Promise<Snowflake.RowStatement>((resolve, reject) => {
        const request = connection.execute({ sqlText: options.sql, binds: (options.parameters ?? []) as Snowflake.Binds,
          streamResult: true, rowMode: 'array', fetchAsString: ['Number', 'Date', 'JSON', 'Buffer'],
          parameters: { MULTI_STATEMENT_COUNT: 1, STATEMENT_TIMEOUT_IN_SECONDS: Math.max(1, Math.ceil(options.timeoutMs / 1000)) },
          complete: (error, result) => error ? reject(error) : resolve(result),
        });
        statement = request;
      }));
      const collector = new ResultCollector(options.maxRows);
      collector.result.columns = (statement.getColumns() ?? []).map(column => ({ name: column.getName(), type: column.getType() }));
      if (statement.getNumRows() > 0) {
        const rows = statement.streamRows({ start: 0, end: options.maxRows });
        stream = rows; // Inclusive end, one lookahead row.
        const iterator = rows[Symbol.asyncIterator]();
        while (true) {
          const next = await timer.wait(iterator.next()); timer.check();
          if (next.done) break;
          if (!collector.add(next.value as unknown[])) { rows.destroy(); break; }
        }
      }
      if (statement.getNumRows() > collector.result.rows.length) collector.result.truncated = true;
      timer.check(); successful = true;
      return collector.result;
    } catch (error) { timer.check(); throw error; }
    finally {
      timer.finish(); stream?.destroy();
      if (session) {
        if (!successful || session.retired) this.destroy(session); else session.busy = false;
      }
      const idle = [...this.sessions].filter(value => !value.busy);
      for (const old of idle.slice(0, Math.max(0, idle.length - 4))) this.destroy(old);
    }
  }
}
