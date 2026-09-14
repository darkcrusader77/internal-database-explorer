import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService, safeError } from '../src/core/service';
import { validateReadQuery } from '../src/core/readOnly';
import { toCsv } from '../src/core/format';
import { Adapter, QueryOptions, QueryResult } from '../src/core/types';
import { routeTool, toolDefinitions } from '../src/core/toolRouter';
import { finished, profile } from './helpers';

const data: QueryResult = { columns: [{ name: 'id', type: 'integer' }], rows: [[1]], truncated: false, cellsTruncated: false };
function fakeAdapter(query: (options: QueryOptions) => Promise<QueryResult> = async () => data): Adapter {
  return { test: async () => undefined, query: async (_p, _secret, options) => query(options), catalog: async () => ({ items: [] }), preview: () => 'SELECT 1' };
}

test('read queries accept literals, quoted identifiers and CTEs, reject writes and transaction control', () => {
  for (const sql of ["SELECT ';delete from users' AS text", 'SELECT generate_series(1, 10)', 'SELECT current_database()', 'WITH a AS (SELECT 1 AS x) SELECT * FROM a', 'SELECT 1 UNION ALL SELECT 2', 'SELECT "commit" FROM "odd table"']) assert.doesNotThrow(() => validateReadQuery(sql));
  for (const sql of ['SELECT 1; DELETE FROM users', 'COMMIT', 'SET transaction_read_only=off', 'DELETE FROM users', 'WITH a AS (DELETE FROM users RETURNING *) SELECT * FROM a', 'CREATE TABLE x(id int)', 'SELECT 1 INTO new_table']) assert.throws(() => validateReadQuery(sql));
});

test('same profile in two extension hosts has isolated results and cancellation', async () => {
  const p = profile();
  const adapter = fakeAdapter(options => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(data), 100);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); });
  }));
  const store = { list: () => [p], password: async () => 'secret' };
  const a = new DatabaseService(store, { postgres: adapter }, () => true);
  const b = new DatabaseService(store, { postgres: adapter }, () => true);
  try {
    const qa = a.startQuery(p.id, 'SELECT 1');
    const qb = b.startQuery(p.id, 'SELECT 2');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.notEqual(a.sessionId, b.sessionId);
    assert.throws(() => b.getResults(p.id, qa.id, 'agent'), /this VS Code window/);
    assert.throws(() => b.cancel(p.id, qa.id), /this VS Code window/);
    a.cancel(p.id, qa.id);
    assert.equal((await finished(qa)).status, 'cancelled');
    assert.equal((await finished(qb)).status, 'completed');
    a.dispose();
    assert.equal(b.getResults(p.id, qb.id, 'agent').rows.length, 1);
  } finally { a.dispose(); b.dispose(); }
});

test('trust, connection opt-in and current profile policy gate agent access', async () => {
  const p = profile({ agentEnabled: false });
  let trusted = false;
  const service = new DatabaseService({ list: () => [p], password: async () => undefined }, { postgres: fakeAdapter() }, () => trusted);
  assert.throws(() => service.startQuery(p.id, 'SELECT 1'), /Trust/);
  trusted = true;
  assert.equal(service.listConnections('agent').length, 0);
  assert.throws(() => service.startQuery(p.id, 'SELECT 1', [], 'agent'), /disabled/);
  p.agentEnabled = true;
  const q = await finished(service.startQuery(p.id, 'SELECT 1', [], 'agent'));
  p.agentEnabled = false;
  assert.throws(() => service.getResults(p.id, q.id, 'agent'), /disabled/);
  service.dispose();
});

test('tool contracts require scoped identifiers and return job handles', async () => {
  const p = profile();
  const service = new DatabaseService({ list: () => [p], password: async () => undefined }, { postgres: fakeAdapter() }, () => true);
  const signal = new AbortController().signal;
  assert.equal(toolDefinitions.length, 10);
  await assert.rejects(routeTool(service, 'internaldb_run_query', { sql: 'SELECT 1' }, signal), /Invalid/);
  await assert.rejects(routeTool(service, 'internaldb_list_columns', { connectionId: p.id, schema: 'public' }, signal), /Invalid/);
  await assert.rejects(routeTool(service, 'internaldb_list_connections', { password: 'secret' }, signal), /Invalid/);
  const response = await routeTool(service, 'internaldb_run_query', { connectionId: p.id, sql: 'SELECT 1' }, signal) as { queryId: string };
  assert.ok(response.queryId.startsWith(service.sessionId));
  service.dispose();
});

test('query limits are validated and error details never reveal driver text', () => {
  const p = profile();
  const service = new DatabaseService({ list: () => [p], password: async () => undefined }, { postgres: fakeAdapter() }, () => true);
  assert.throws(() => service.startQuery(p.id, 'SELECT 1', [], 'user', 1001));
  assert.throws(() => service.startQuery(p.id, 'SELECT 1', [], 'user', 100, NaN));
  assert.ok(!safeError(new Error('password=SUPERSECRET query contains private rows')).includes('SUPERSECRET'));
  service.dispose();
});

test('retained results expire while bounded history remains', async () => {
  const p = profile();
  const service = new DatabaseService({ list: () => [p], password: async () => undefined }, { postgres: fakeAdapter() }, () => true);
  const first = await finished(service.startQuery(p.id, 'SELECT 1'));
  for (let i = 0; i < 11; i++) await finished(service.startQuery(p.id, 'SELECT 1'));
  assert.equal(service.getResults(p.id, first.id, 'user').resultExpired, true);
  assert.equal(service.history().length, 12);
  service.dispose();
});

test('CSV preserves quoting and escapes formula-like values', () => {
  const csv = toCsv([{ name: 'a' }, { name: 'b' }], [['a,"b"\nc', '=SUM(1,2)'], [null, -42]]);
  assert.ok(csv.includes('"a,""b""\nc"'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"","-42"'));
});
