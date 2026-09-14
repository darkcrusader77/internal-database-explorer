import type * as Oracle from 'oracledb';
import { ConnectionProfile, QueryOptions, UserError } from '../core/types';
import { CatalogAdapter } from './catalog';
import { deadline, quote, ResultCollector } from './common';

export function oracleConfig(p: ConnectionProfile, password: string | undefined): Oracle.ConnectionAttributes {
  const host = p.host.includes(':') ? `[${p.host}]` : p.host;
  return { user: p.username, password: password ?? '',
    connectString: `${p.tls === 'disable' ? 'tcp' : 'tcps'}://${host}:${p.port}/${p.database}`,
    connectTimeout: 10, transportConnectTimeout: 10, retryCount: 0, sslServerDNMatch: true,
    ...(p.oracleWalletPath ? { walletLocation: p.oracleWalletPath } : {}) };
}
export class OracleAdapter extends CatalogAdapter {
  constructor(private readonly loadDriver: () => typeof Oracle = () => require('oracledb')) { super(); }
  preview(schema: string, table: string) { return `SELECT * FROM ${quote(schema)}.${quote(table)} FETCH FIRST 100 ROWS ONLY`; }
  async query(p: ConnectionProfile, password: string | undefined, options: QueryOptions) {
    const oracle = this.loadDriver();
    let connection: Oracle.Connection | undefined;
    let resultSet: Oracle.ResultSet<unknown[]> | undefined;
    const timer = deadline(options.signal, options.timeoutMs, () => { void connection?.break().catch(() => {}); });
    try {
      connection = await oracle.getConnection(oracleConfig(p, password)); timer.check();
      connection.callTimeout = options.timeoutMs;
      const sql = options.sql.trim().replace(/;\s*$/, '');
      const info = await connection.getStatementInfo(sql);
      if (info.statementType !== oracle.STMT_TYPE_SELECT) throw new UserError('Oracle accepts only SELECT queries in this release.');
      await connection.execute('SET TRANSACTION READ ONLY'); timer.check();
      const result = await connection.execute<unknown[]>(sql, options.parameters ?? [], {
        resultSet: true, outFormat: oracle.OUT_FORMAT_ARRAY, fetchArraySize: 25, prefetchRows: 0,
        fetchTypeHandler: metadata => metadata.dbType === oracle.DB_TYPE_NUMBER ? { type: oracle.DB_TYPE_VARCHAR } : undefined,
      });
      resultSet = result.resultSet;
      const collector = new ResultCollector(options.maxRows);
      collector.result.columns = (result.metaData ?? []).map(column => ({ name: column.name, type: column.dbTypeName ?? 'unknown' }));
      if (!resultSet) throw new UserError('Oracle did not return a query result set.');
      let full = false;
      while (!full) {
        timer.check();
        const batch = await resultSet.getRows(Math.min(25, options.maxRows + 1 - collector.result.rows.length));
        if (!batch.length) break;
        for (const row of batch) {
          for (let index = 0; index < row.length; index++) {
            const value = row[index];
            // Never materialize an unbounded LOB or nested cursor in the extension process.
            if (value && typeof value === 'object' && 'close' in value && typeof value.close === 'function') {
              await value.close(); row[index] = '[LOB or cursor omitted; select a bounded scalar expression to preview]'; collector.result.cellsTruncated = true;
            }
          }
          if (!full && !collector.add(row)) full = true;
        }
      }
      timer.check();
      return collector.result;
    } catch (error) { timer.check(); throw error; }
    finally {
      timer.finish();
      await resultSet?.close().catch(() => {});
      await connection?.rollback().catch(() => {});
      await connection?.close().catch(() => {});
    }
  }
}
