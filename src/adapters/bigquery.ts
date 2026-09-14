import type { BigQuery, Job, Query } from '@google-cloud/bigquery';
import { randomUUID } from 'node:crypto';
import { ConnectionProfile, QueryOptions, UserError } from '../core/types';
import { CatalogAdapter } from './catalog';
import { deadline, googleIdentifier, ResultCollector } from './common';

export function bigQueryConfig(p: ConnectionProfile, options: QueryOptions): Query {
  if (options.parameters?.some(value => value === null)) throw new UserError('BigQuery null parameters require explicit types. Use NULL or CAST(NULL AS type) in SQL for now.');
  return { query: options.sql, useLegacySql: false, location: p.location,
    maximumBytesBilled: p.maximumBytesBilled ?? '1073741824', jobTimeoutMs: options.timeoutMs,
    ...(p.schema ? { defaultDataset: { projectId: p.database, datasetId: p.schema } } : {}),
    ...(options.parameters?.length ? { params: options.parameters } : {}),
  };
}
export class BigQueryAdapter extends CatalogAdapter {
  constructor(private readonly loadDriver: () => { BigQuery: typeof BigQuery } = () => require('@google-cloud/bigquery')) { super(); }
  preview(schema: string, table: string) { return `SELECT * FROM ${googleIdentifier(`${schema}.${table}`)} LIMIT 100;`; }
  async query(p: ConnectionProfile, _password: string | undefined, options: QueryOptions) {
    const { BigQuery: Client } = this.loadDriver();
    // ADC resolves gcloud application-default credentials, GOOGLE_APPLICATION_CREDENTIALS,
    // or an attached workload identity. Credentials are never copied into profiles.
    const client = new Client({ projectId: p.database, location: p.location, autoRetry: false, maxRetries: 0 });
    const jobId = `internal_db_${randomUUID().replaceAll('-', '_')}`;
    const job: Job = client.job(jobId, { location: p.location });
    let submitted = false;
    let ended = false;
    const cancel = () => { if (submitted) void job.cancel().catch(() => {}); };
    const timer = deadline(options.signal, options.timeoutMs, cancel);
    try {
      const config = bigQueryConfig(p, options);
      // BigQuery's own parser verifies SELECT before any billable query is submitted.
      const [dry] = await timer.wait(client.createQueryJob({ ...config, dryRun: true })); timer.check();
      if (dry.metadata.statistics?.query?.statementType !== 'SELECT') throw new UserError('BigQuery accepts only SELECT queries in this release.');
      submitted = true;
      await timer.wait(client.createQueryJob({ ...config, jobId }).then(result => { if (ended || options.signal.aborted) cancel(); return result; }));
      timer.check();
      const collector = new ResultCollector(options.maxRows);
      let pageToken: string | undefined;
      while (true) {
        timer.check();
        // Disable the SDK's default auto-pagination. Fetch at most one small page per call.
        const [rows, next, response] = await timer.wait(job.getQueryResults({ autoPaginate: false, maxResults: Math.min(100, options.maxRows + 1 - collector.result.rows.length),
          skipParsing: true, ...(pageToken ? { pageToken } : {}) }));
        timer.check();
        const fields = response?.schema?.fields;
        if (fields) collector.result.columns = fields.map(field => ({ name: field.name ?? '', type: field.type ?? 'unknown' }));
        let full = false;
        for (const row of rows as { f?: { v?: unknown }[] }[]) {
          // Raw REST scalars preserve INTEGER/NUMERIC precision; structs/arrays remain JSON.
          if (!collector.add((row.f ?? []).map(cell => cell.v ?? null))) { full = true; break; }
        }
        if (full) break;
        if (!next) break;
        pageToken = next.pageToken;
      }
      return collector.result;
    } catch (error) { timer.check(); throw error; }
    finally { ended = true; timer.finish(); cancel(); }
  }
}
