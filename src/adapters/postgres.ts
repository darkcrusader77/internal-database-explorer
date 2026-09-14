import { readFileSync } from 'node:fs';
import { Client, FieldDef } from 'pg';
import Cursor from 'pg-cursor';
import { Adapter, CatalogInput, CatalogOperation, ConnectionProfile, QueryOptions, QueryResult, UserError } from '../core/types';
import { boundedInteger, serialize } from '../core/format';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CELL = 16_384;
export const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

export class PostgresAdapter implements Adapter {
  preview(schema: string, table: string): string {
    return `SELECT *\nFROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}\nLIMIT 100;`;
  }
  async test(profile: ConnectionProfile, password: string | undefined, signal: AbortSignal): Promise<void> {
    await this.query(profile, password, { sql: 'SELECT 1', maxRows: 1, timeoutMs: 10_000, signal });
  }
  async query(profile: ConnectionProfile, password: string | undefined, options: QueryOptions): Promise<QueryResult> {
    options.signal.throwIfAborted();
    const client = new Client({
      host: profile.host, port: profile.port, database: profile.database,
      user: profile.username, password: async () => password ?? '',
      ssl: profile.tls === 'disable' ? false : {
        rejectUnauthorized: true,
        ...(profile.caPath ? { ca: readFileSync(profile.caPath, 'utf8') } : {}),
      },
      application_name: `internal-db-explorer:${process.pid}`,
      connectionTimeoutMillis: Math.min(options.timeoutMs, 10_000),
      statement_timeout: options.timeoutMs,
      options: '-c default_transaction_read_only=on',
    });
    // An operation owns its client. Cancellation can never target another window's query.
    client.on('error', () => { /* Query/connect promises surface errors through the service. */ });
    const stop = () => { void client.end().catch(() => undefined); };
    options.signal.addEventListener('abort', stop, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs);
    try {
      await client.connect();
      options.signal.throwIfAborted();
      await client.query('BEGIN READ ONLY');
      const cursor = client.query(new Cursor<unknown[]>(options.sql, options.parameters ?? [], { rowMode: 'array' }));
      let fields: FieldDef[] = [];
      const rows: unknown[][] = [];
      let bytes = 0;
      let truncated = false;
      let cellsTruncated = false;
      while (true) {
        options.signal.throwIfAborted();
        const batch = await new Promise<unknown[][]>((resolve, reject) => {
          cursor.read(Math.min(100, options.maxRows + 1 - rows.length), (error, values, result) => {
            if (error) reject(error); else { if (result) fields = result.fields; resolve(values); }
          });
        });
        if (!batch.length) break;
        for (const row of batch) {
          if (rows.length >= options.maxRows) { truncated = true; break; }
          const normalized = row.map(value => {
            if (value === null) return null;
            const encoded = typeof value === 'string' ? value : serialize(value);
            if (encoded && encoded.length > MAX_CELL) { cellsTruncated = true; return encoded.slice(0, MAX_CELL) + '… [truncated]'; }
            return typeof value === 'bigint' ? String(value) : value;
          });
          const size = Buffer.byteLength(serialize(normalized));
          if (bytes + size > MAX_BYTES) { truncated = true; break; }
          bytes += size;
          rows.push(normalized);
        }
        if (truncated) break;
      }
      await cursor.close();
      await client.query('ROLLBACK');
      return { columns: fields.map(f => ({ name: f.name, type: `oid:${f.dataTypeID}` })), rows, truncated, cellsTruncated };
    } catch (error) {
      if (timedOut) throw new UserError('Query exceeded its time limit.');
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', stop);
      await client.end().catch(() => undefined);
    }
  }
  async catalog(profile: ConnectionProfile, password: string | undefined, operation: CatalogOperation, input: CatalogInput, signal: AbortSignal): Promise<unknown> {
    if (input.database && input.database !== profile.database) throw new UserError('This connection is pinned to its saved database. Create another profile to access a different database.');
    const limit = boundedInteger(input.limit, 100, 1, 200);
    const offset = boundedInteger(input.offset, 0, 0, 1_000_000);
    const filter = input.filter ?? '';
    const select = async (sql: string, parameters: unknown[], cap = limit) => {
      const result = await this.query(profile, password, { sql, parameters, maxRows: cap, timeoutMs: 15_000, signal });
      return {
        items: result.rows.map(row => Object.fromEntries(result.columns.map((column, i) => [column.name, row[i]]))),
        truncated: result.truncated || result.cellsTruncated,
      };
    };
    let result;
    const tables = `SELECT n.nspname AS schema, c.relname AS name,
      CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END AS kind
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p','v','m','f') AND has_table_privilege(c.oid,'SELECT')
      AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'`;
    if (operation === 'list_databases') {
      result = await select(`SELECT datname AS name, datname=current_database() AS current
        FROM pg_catalog.pg_database WHERE datallowconn AND NOT datistemplate
        AND has_database_privilege(oid,'CONNECT') AND strpos(lower(datname),lower($1))>0
        ORDER BY datname LIMIT $2 OFFSET $3`, [filter, limit + 1, offset]);
    } else if (operation === 'list_schemas') {
      result = await select(`SELECT nspname AS name FROM pg_catalog.pg_namespace
        WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
        AND has_schema_privilege(oid,'USAGE') AND strpos(lower(nspname),lower($1))>0
        ORDER BY nspname LIMIT $2 OFFSET $3`, [filter, limit + 1, offset]);
    } else if (operation === 'list_tables' || operation === 'search_objects') {
      if (operation === 'list_tables' && !input.schema) throw new UserError('schema is required.');
      result = await select(`${tables} AND ($1::text IS NULL OR n.nspname=$1)
        AND strpos(lower(c.relname),lower($2))>0 ORDER BY n.nspname,c.relname LIMIT $3 OFFSET $4`,
        [input.schema ?? null, filter, limit + 1, offset]);
    } else {
      if (!input.schema || !input.table) throw new UserError('schema and table are required.');
      const columns = await select(`SELECT column_name AS name, data_type AS type,
        udt_name AS native_type, is_nullable='YES' AS nullable, column_default AS default,
        ordinal_position AS position FROM information_schema.columns
        WHERE table_schema=$1 AND table_name=$2 AND strpos(lower(column_name),lower($3))>0
        ORDER BY ordinal_position LIMIT $4 OFFSET $5`, [input.schema, input.table, filter, limit + 1, offset]);
      if (operation === 'list_columns') result = columns;
      else {
        const constraints = await select(`SELECT con.conname AS name, con.contype AS kind,
          pg_get_constraintdef(con.oid) AS definition FROM pg_catalog.pg_constraint con
          JOIN pg_catalog.pg_class c ON c.oid=con.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relname=$2 AND has_table_privilege(c.oid,'SELECT') ORDER BY con.conname LIMIT 201`, [input.schema, input.table], 200);
        const indexes = await select(`SELECT indexname AS name, indexdef AS definition FROM pg_catalog.pg_indexes
          WHERE schemaname=$1 AND tablename=$2 AND has_table_privilege(format('%I.%I',schemaname,tablename),'SELECT')
          ORDER BY indexname LIMIT 201`, [input.schema, input.table], 200);
        const comments = await select(`SELECT obj_description(c.oid,'pg_class') AS comment
          FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relname=$2 AND has_table_privilege(c.oid,'SELECT')`, [input.schema, input.table], 1);
        return { connectionId: profile.id, database: profile.database, schema: input.schema, table: input.table,
          columns, constraints, indexes, comment: comments.items[0]?.comment ?? null,
          note: 'Metadata reflects this role’s visibility. Empty metadata may mean missing privileges or a missing object.' };
      }
    }
    return { connectionId: profile.id, database: profile.database, ...result, offset,
      nextOffset: result.truncated ? offset + result.items.length : null };
  }
}
