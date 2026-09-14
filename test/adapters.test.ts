import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { ResultCollector, MAX_BYTES, rowsAsObjects } from '../src/adapters/common';
import { SqlServerAdapter, sqlServerConfig } from '../src/adapters/sqlserver';
import { OracleAdapter, oracleConfig } from '../src/adapters/oracle';
import { SnowflakeAdapter, snowflakeConfig } from '../src/adapters/snowflake';
import { BigQueryAdapter, bigQueryConfig } from '../src/adapters/bigquery';
import { catalogPlan } from '../src/adapters/catalog';
import { validateReadQuery } from '../src/core/readOnly';
import { validateProfile } from '../src/core/profileRepository';
import { starterQuery } from '../src/core/engines';
import { ConnectionProfile, Engine, QueryOptions } from '../src/core/types';
import { profile } from './helpers';

const options = (changes: Partial<QueryOptions> = {}): QueryOptions => ({ sql: 'SELECT 1 AS n', maxRows: 1000, timeoutMs: 1000, signal: new AbortController().signal, ...changes });
const connection = (engine: Engine) => profile({ engine, tls: 'verify-full', ...(engine === 'oracle' ? { database: 'FREEPDB1' } : {}), ...(engine === 'snowflake' ? { accountUrl: 'https://org-account.snowflakecomputing.com', oauthClientId: 'client', oauthMode: 'authorization-code' } : {}), ...(engine === 'bigquery' ? { database: 'my-project', location: 'US', maximumBytesBilled: '1073741824' } : {}) });

test('dialects accept their own SELECT syntax and reject writes, SELECT INTO, and multiple statements', () => {
  const queries = { sqlserver: 'SELECT TOP (5) [id] FROM [sales].[orders]', oracle: 'SELECT "ID" FROM "SALES"."ORDERS" FETCH FIRST 5 ROWS ONLY', snowflake: 'SELECT "ID" FROM "SALES"."ORDERS" QUALIFY ROW_NUMBER() OVER (ORDER BY "ID") = 1', bigquery: 'SELECT id FROM `my-project.sales.orders` LIMIT 5' };
  for (const [engine, sql] of Object.entries(queries)) {
    validateReadQuery(sql, engine as Engine);
    validateReadQuery(starterQuery(connection(engine as Engine)), engine as Engine);
    for (const bad of ['DELETE FROM orders', 'SELECT 1; DELETE FROM orders', 'CREATE TABLE example(id INT)', 'CALL dangerous()']) assert.throws(() => validateReadQuery(bad, engine as Engine));
  }
  assert.throws(() => validateReadQuery('SELECT id INTO copy FROM original', 'sqlserver'));
  assert.throws(() => validateReadQuery('SELECT * FROM orders FOR UPDATE', 'oracle'));
});

test('catalog plans quote identifiers, bind filters in SQL order and expose all required operations', () => {
  for (const engine of ['sqlserver', 'oracle', 'snowflake', 'bigquery'] as const) {
    const p = connection(engine);
    for (const operation of ['list_databases', 'list_schemas', 'list_tables', 'list_columns', 'describe_table', 'search_objects', 'constraints', 'comment'] as const) {
      const plan = catalogPlan(p, operation, { schema: 'sales', table: "orders' OR 1=1 --", filter: "needle' OR 1=1 --", limit: 10, offset: 20 });
      assert.ok(!plan.sql.includes("needle'")); assert.ok(!plan.sql.includes("orders'"));
      assert.ok(plan.parameters.includes("needle' OR 1=1 --"));
      if (engine !== 'oracle') validateReadQuery(plan.sql, engine);
      const placeholders = plan.sql.match(engine === 'sqlserver' ? /@p\d+/g : engine === 'oracle' ? /:\d+/g : /\?/g) ?? [];
      assert.equal(placeholders.length, plan.parameters.length);
    }
  }
  assert.deepEqual(rowsAsObjects({ columns: [{ name: 'NULLABLE', type: 'NUMBER' }], rows: [['0'], ['1']], truncated: false, cellsTruncated: false }), [{ nullable: false }, { nullable: true }]);
});

test('collector bounds retained rows, bytes and cell size, including binary data', () => {
  const rows = new ResultCollector(1000);
  for (let i = 0; i < 1_000_000; i++) if (!rows.add([i])) break;
  assert.equal(rows.result.rows.length, 1000); assert.equal(rows.result.truncated, true);
  const wide = new ResultCollector(1000);
  for (let i = 0; i < 1000; i++) if (!wide.add(['x'.repeat(16_000)])) break;
  assert.ok(wide.result.rows.length < 1000); assert.ok(Buffer.byteLength(JSON.stringify(wide.result.rows)) <= MAX_BYTES);
  const cell = new ResultCollector(1); cell.add([Buffer.alloc(1_000_000)]);
  assert.equal(cell.result.cellsTruncated, true); assert.ok(JSON.stringify(cell.result.rows).length < 17_000);
});

test('driver configurations use requested authentication, verified TLS and scoped BigQuery job limits', () => {
  for (const engine of ['sqlserver', 'oracle', 'snowflake', 'bigquery'] as const) validateProfile(connection(engine));
  const ms = sqlServerConfig(connection('sqlserver'), 'secret', 1000);
  assert.equal(ms.password, 'secret'); assert.equal(ms.pool?.max, 1); assert.equal(ms.options?.trustServerCertificate, false);
  const ora = oracleConfig(connection('oracle'), 'secret'); assert.match(ora.connectString!, /^tcps:/); assert.equal(ora.password, 'secret');
  const sf = snowflakeConfig(connection('snowflake'), 'client-secret');
  assert.equal(sf.authenticator, 'OAUTH_AUTHORIZATION_CODE'); assert.equal(sf.oauthClientSecret, 'client-secret'); assert.equal(sf.clientStoreTemporaryCredential, false); assert.equal(sf.oauthRedirectUri, undefined);
  const bq = bigQueryConfig(connection('bigquery'), options()); assert.equal(bq.maximumBytesBilled, '1073741824'); assert.equal(bq.useLegacySql, false);
  assert.throws(() => validateProfile({ ...connection('snowflake'), accountUrl: 'http://bad.test' }));
});

test('SQL Server streams rows, cancels at the cap, preserves empty metadata and closes only its own pool', async () => {
  const pools: FakePool[] = [];
  class FakeRequest extends EventEmitter {
    stream = false; arrayRowMode = false; cancelled = false;
    input() { return this; }
    cancel() { this.cancelled = true; }
    query(sql: string, callback: (error?: Error) => void) {
      setImmediate(() => {
        this.emit('recordset', [{ name: 'n', type: { name: 'Int' } }]);
        for (let i = 0; i < (sql.includes('empty') ? 0 : 1_000_000) && !this.cancelled; i++) this.emit('row', [i]);
        if (this.cancelled) { const error = new Error('cancelled'); this.emit('error', error); callback(error); } else callback();
      });
    }
  }
  class FakePool extends EventEmitter {
    closed = false; req = new FakeRequest();
    constructor() { super(); pools.push(this); }
    async connect() { return this; } request() { return this.req; } async close() { this.closed = true; }
  }
  const adapter = new SqlServerAdapter(() => ({ ConnectionPool: FakePool }) as any);
  const result = await adapter.query(connection('sqlserver'), '', options());
  assert.equal(result.rows.length, 1000); assert.equal(result.truncated, true); assert.equal(pools[0].req.cancelled, true); assert.equal(pools[0].closed, true);
  const empty = await adapter.query(connection('sqlserver'), '', options({ sql: 'SELECT empty' }));
  assert.equal(empty.columns[0].name, 'n'); assert.equal(empty.rows.length, 0); assert.notEqual(pools[0], pools[1]);
});

test('Oracle checks server statement type, starts a read-only transaction, bounds fetches and closes LOBs', async () => {
  let lobClosed = 0, cursorClosed = 0, closed = 0, rolledBack = 0, offset = 0;
  const calls: string[] = [];
  const cursor = { async getRows(n: number) { assert.ok(n <= 25); return Array.from({ length: n }, () => [offset++, { async close() { lobClosed++; } }]); }, async close() { cursorClosed++; } };
  const conn = { callTimeout: 0, async getStatementInfo() { return { statementType: 1 }; }, async execute(sql: string) { calls.push(sql); return { metaData: [{ name: 'N', dbTypeName: 'NUMBER' }, { name: 'LOB', dbTypeName: 'CLOB' }], resultSet: cursor }; }, async rollback() { rolledBack++; }, async close() { closed++; }, async break() {} };
  const adapter = new OracleAdapter(() => ({ getConnection: async () => conn, STMT_TYPE_SELECT: 1, OUT_FORMAT_ARRAY: 1, DB_TYPE_NUMBER: 1, DB_TYPE_VARCHAR: 2 }) as any);
  const result = await adapter.query(connection('oracle'), '', options());
  assert.equal(calls[0], 'SET TRANSACTION READ ONLY'); assert.equal(result.rows.length, 1000); assert.equal(result.truncated, true); assert.equal(result.cellsTruncated, true);
  assert.equal(lobClosed, 1001); assert.equal(cursorClosed, 1); assert.equal(closed, 1); assert.equal(rolledBack, 1);
  conn.getStatementInfo = async () => ({ statementType: 2 });
  await assert.rejects(adapter.query(connection('oracle'), '', options()), /only SELECT/);
  assert.equal(calls.length, 2);
});

test('Snowflake uses streaming, reuses only idle window-local sessions and isolates draft tests', async () => {
  const sessions: any[] = [];
  const sdk = { createConnection(config: unknown) {
    const session = { config, destroyed: false, async connectAsync() { return this; }, destroy(callback: Function) { this.destroyed = true; callback(); }, execute(opts: any) {
      assert.equal(opts.streamResult, true); assert.equal(opts.parameters.MULTI_STATEMENT_COUNT, 1);
      const stmt = { getColumns: () => [{ getName: () => 'n', getType: () => 'FIXED' }], getNumRows: () => 1_000_000,
        streamRows: ({ end }: { end: number }) => Readable.from(Array.from({ length: end + 1 }, (_, i) => [String(i)])), cancel(callback: Function) { callback(); } };
      setImmediate(() => opts.complete(undefined, stmt)); return stmt;
    } }; sessions.push(session); return session;
  } };
  const a = new SnowflakeAdapter(() => sdk as any), b = new SnowflakeAdapter(() => sdk as any), p = connection('snowflake');
  const first = await a.query(p, 'token', options()); assert.equal(first.rows.length, 1000); assert.equal(first.truncated, true);
  await a.query(p, 'token', options()); assert.equal(sessions.length, 1);
  await a.test(p, 'token', new AbortController().signal); assert.equal(sessions[0].destroyed, false); assert.equal(sessions[1].destroyed, true);
  await b.query(p, 'token', options()); a.disconnect(p.id); assert.equal(sessions[2].destroyed, false); b.dispose(); assert.equal(sessions[2].destroyed, true);
});

test('BigQuery dry-runs SELECT, never auto-paginates, preserves numeric strings and uses unique job IDs', async () => {
  const ids: string[] = [], configs: any[] = [];
  let cancelled = 0, fetched = 0, statementType = 'SELECT';
  class Client {
    job(id: string) { ids.push(id); let offset = 0; return { async cancel() { cancelled++; }, async getQueryResults(config: any) {
      assert.equal(config.autoPaginate, false); assert.ok(config.maxResults <= 100); assert.equal(config.skipParsing, true);
      fetched += config.maxResults; offset += config.maxResults;
      return [Array.from({ length: config.maxResults }, () => ({ f: [{ v: '12345678901234567890.12345' }] })), { pageToken: String(offset) }, { schema: { fields: [{ name: 'n', type: 'NUMERIC' }] }, jobComplete: true }];
    } }; }
    async createQueryJob(config: any) { configs.push(config); return [{ metadata: { statistics: { query: { statementType } } } }]; }
  }
  const adapter = new BigQueryAdapter(() => ({ BigQuery: Client }) as any);
  const result = await adapter.query(connection('bigquery'), undefined, options());
  assert.equal(result.rows.length, 1000); assert.equal(result.rows[0][0], '12345678901234567890.12345'); assert.equal(result.truncated, true); assert.equal(fetched, 1001); assert.equal(configs[0].dryRun, true); assert.equal(cancelled, 1);
  statementType = 'DELETE'; await assert.rejects(adapter.query(connection('bigquery'), undefined, options()), /only SELECT/);
  assert.notEqual(ids[0], ids[1]); assert.equal(configs.length, 3, 'A non-SELECT dry run must not submit a real job');
});

test('BigQuery cancellation covers a job that is submitted after the local deadline', async () => {
  let created = false, cancelsAfterCreation = 0;
  class Client {
    job() { return { async cancel() { if (created) cancelsAfterCreation++; } }; }
    async createQueryJob(config: any) {
      if (config.dryRun) return [{ metadata: { statistics: { query: { statementType: 'SELECT' } } } }];
      await new Promise(resolve => setTimeout(resolve, 50)); created = true; return [{}];
    }
  }
  const adapter = new BigQueryAdapter(() => ({ BigQuery: Client }) as any);
  await assert.rejects(adapter.query(connection('bigquery'), undefined, options({ timeoutMs: 10 })), /time limit/);
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.ok(cancelsAfterCreation > 0, 'A late job submission must still be cancelled');
});

test('Snowflake cancellation destroys only the calling window’s active session', async () => {
  const sessions: any[] = [];
  const sdk = { createConnection() {
    const session = { destroyed: false, cancelled: false, async connectAsync() { return this; }, destroy(cb: Function) { this.destroyed = true; cb(); }, execute() { return { cancel: (cb: Function) => { session.cancelled = true; cb(); } }; } };
    sessions.push(session); return session;
  } };
  const a = new SnowflakeAdapter(() => sdk as any), b = new SnowflakeAdapter(() => sdk as any);
  const ca = new AbortController(), cb = new AbortController();
  const qa = a.query(connection('snowflake'), '', options({ signal: ca.signal }));
  const qb = b.query(connection('snowflake'), '', options({ signal: cb.signal }));
  const doneA = assert.rejects(qa), doneB = assert.rejects(qb);
  await new Promise(resolve => setImmediate(resolve)); ca.abort(); await doneA;
  assert.equal(sessions[0].destroyed, true); assert.equal(sessions[0].cancelled, true);
  assert.equal(sessions[1].destroyed, false); assert.equal(sessions[1].cancelled, false);
  cb.abort(); await doneB;
});
