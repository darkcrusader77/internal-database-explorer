import type * as Sql from 'mssql';
import { readFileSync } from 'node:fs';
import { ConnectionProfile, QueryOptions, UserError } from '../core/types';
import { CatalogAdapter } from './catalog';
import { bracket, deadline, ResultCollector } from './common';

export function sqlServerConfig(p: ConnectionProfile, password: string | undefined, timeoutMs: number): Sql.config {
  return { server: p.host, port: p.port, database: p.database, user: p.username, password: password ?? '',
    connectionTimeout: Math.min(timeoutMs, 10_000), requestTimeout: timeoutMs,
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
    options: { encrypt: p.tls !== 'disable', trustServerCertificate: false, readOnlyIntent: true,
      appName: `internal-db-explorer:${process.pid}`, ...(p.caPath ? { cryptoCredentialsDetails: { ca: readFileSync(p.caPath) } } : {}) } };
}
export class SqlServerAdapter extends CatalogAdapter {
  constructor(private readonly loadDriver: () => typeof Sql = () => require('mssql')) { super(); }
  preview(schema: string, table: string) { return `SELECT TOP (100) * FROM ${bracket(schema)}.${bracket(table)};`; }
  async query(p: ConnectionProfile, password: string | undefined, options: QueryOptions) {
    const sql = this.loadDriver();
    options.signal.throwIfAborted();
    // A private one-client pool per operation. Never use mssql's global connect()/pool.
    const pool = new sql.ConnectionPool(sqlServerConfig(p, password, options.timeoutMs));
    pool.on('error', () => {});
    let request: Sql.Request | undefined;
    const timer = deadline(options.signal, options.timeoutMs, () => { request?.cancel(); void pool.close().catch(() => {}); });
    try {
      await pool.connect(); timer.check();
      request = pool.request(); request.stream = true; request.arrayRowMode = true;
      (options.parameters ?? []).forEach((value, index) => {
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new UserError('SQL Server parameters support strings, numbers, booleans, and null; use @p1, @p2, etc.');
        request!.input(`p${index + 1}`, value);
      });
      const collector = new ResultCollector(options.maxRows);
      let limitReached = false;
      let queryError: unknown;
      let recordsets = 0;
      request.on('recordset', (columns: Sql.IColumnMetadata[string][]) => {
        if (++recordsets > 1) { queryError = new UserError('Run a single SELECT result set at a time.'); request!.cancel(); return; }
        collector.result.columns = columns.map(column => ({ name: column.name, type: (column.type as { name?: string }).name ?? 'unknown' }));
        if (columns.some(column => (column.precision ?? 0) > 15 || /decimal|numeric|money/i.test((column.type as { name?: string }).name ?? ''))) {
          collector.result.warnings = ['SQL Server decimal/money values use driver JavaScript numbers and can lose precision. CAST exact numeric values AS varchar(100) in SQL when precision matters.'];
        }
      });
      request.on('row', (row: unknown[]) => { if (!limitReached && !collector.add(row)) { limitReached = true; request!.cancel(); } });
      request.on('error', error => { if (!limitReached) queryError = error; });
      await new Promise<void>((resolve, reject) => {
        request!.query(options.sql, error => {
          if (!limitReached && (queryError || error)) reject(queryError || error); else resolve();
        });
      });
      timer.check();
      if (queryError) throw queryError;
      return collector.result;
    } catch (error) { timer.check(); throw error; }
    finally { timer.finish(); await pool.close().catch(() => {}); }
  }
}
