import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BigQuery } from '@google-cloud/bigquery';
import { BigQueryAdapter } from '../src/adapters/bigquery';
import { DatabaseService } from '../src/core/service';
import { ConnectionProfile } from '../src/core/types';
import { Execution } from '../src/core/types';
async function finished(execution: Execution) {
  const deadline = Date.now() + 45_000;
  while (execution.status === 'running') {
    if (Date.now() > deadline) throw new Error('Live query did not finish before the test deadline.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return execution;
}

async function main() {
  const project = process.argv[2];
  if (!project) throw new Error('Pass the explicitly authorized Google Cloud project ID.');
  const location = process.argv[3] ?? 'US';
  const datasetId = `internal_db_explorer_test_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const client = new BigQuery({ projectId: project, location, autoRetry: false, maxRetries: 0 });
  const dataset = client.dataset(datasetId);
  const report: Record<string, unknown> = { project, location, datasetId, startedAt: new Date().toISOString(), checks: [] as string[], deleted: false };
  const check = (name: string) => { (report.checks as string[]).push(name); process.stdout.write(`PASS: ${name}\n`); };
  let created = false;
  const p: ConnectionProfile = { id: randomUUID(), revision: randomUUID(), secretId: randomUUID(), name: 'Disposable BigQuery test', engine: 'bigquery',
    host: '', port: 443, database: project, username: '', tls: 'verify-full', agentEnabled: true, location, schema: datasetId, maximumBytesBilled: '1073741824' };
  const adapter = new BigQueryAdapter();
  const service = new DatabaseService({ list: () => [p], password: async () => undefined }, { bigquery: adapter }, () => true);
  try {
    await client.createDataset(datasetId, { location, defaultTableExpirationMs: '3600000', labels: { purpose: 'internal-db-explorer-test' } });
    created = true; process.stdout.write(`Created temporary dataset ${project}.${datasetId}\n`);
    const [setup] = await client.createQueryJob({ query: `CREATE TABLE \`${project}.${datasetId}.sample_orders\` AS SELECT * FROM UNNEST([STRUCT(1 AS id, 'Test customer A' AS customer, NUMERIC '12.34' AS amount), STRUCT(2 AS id, 'Test customer B' AS customer, NUMERIC '56.78' AS amount), STRUCT(3 AS id, 'Test customer C' AS customer, NUMERIC '90.12' AS amount)])`, location, useLegacySql: false, maximumBytesBilled: '1073741824', jobTimeoutMs: 30_000 });
    await setup.getQueryResults({ autoPaginate: false, maxResults: 1 });
    await service.testConnection(p.id); check('BigQuery adapter authenticates with local Google ADC');
    for (const op of ['list_databases', 'list_schemas', 'list_tables', 'list_columns', 'describe_table', 'search_objects'] as const) {
      const input = op === 'list_schemas' ? { filter: datasetId } : op === 'list_databases' ? {} : { schema: datasetId, table: 'sample_orders', filter: op === 'search_objects' ? 'sample_orders' : '' };
      const result = await service.catalog(p.id, op, input, 'agent') as any;
      assert.ok(op === 'describe_table' ? result.columns.items.length === 3 : result.items.length > 0, op);
      check(`Live ${op}`);
    }
    const query = await finished(service.startQuery(p.id, `SELECT id, customer, amount FROM \`${project}.${datasetId}.sample_orders\` WHERE id >= ? ORDER BY id`, [2], 'agent'));
    assert.equal(query.status, 'completed', query.error); assert.equal(query.result!.rows.length, 2); assert.equal(query.result!.rows[0][2], '56.78');
    check('Parameterized query returns the expected rows and exact NUMERIC strings');
    const bounded = await finished(service.startQuery(p.id, 'SELECT x FROM UNNEST(GENERATE_ARRAY(1, 10000)) AS x', [], 'agent'));
    assert.equal(bounded.status, 'completed', bounded.error); assert.equal(bounded.result!.rows.length, 1000); assert.equal(bounded.result!.truncated, true);
    check('10,000-row query retains only 1,000 rows and reports truncation');
    report.success = true;
  } catch (error) {
    report.success = false; report.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    service.dispose();
    try {
      if (created) {
        await dataset.delete({ force: true });
        const [exists] = await dataset.exists(); assert.equal(exists, false);
        report.deleted = true; check('Temporary dataset and sample table deleted; deletion verified');
      }
    } finally {
      report.finishedAt = new Date().toISOString();
      mkdirSync('artifacts', { recursive: true });
      writeFileSync('artifacts/bigquery-live-test.json', JSON.stringify(report, null, 2) + '\n');
    }
  }
}
main().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
