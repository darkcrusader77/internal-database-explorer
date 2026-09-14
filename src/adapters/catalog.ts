import { Adapter, CatalogInput, CatalogOperation, ConnectionProfile, QueryOptions, QueryResult, UserError } from '../core/types';
import { boundedInteger } from '../core/format';
import { bracket, googleIdentifier, quote, rowsAsObjects } from './common';

type Plan = { sql: string; parameters: unknown[] };
/** All names are quoted; user filters and object names in predicates are bound parameters. */
export function catalogPlan(p: ConnectionProfile, operation: CatalogOperation | 'constraints' | 'indexes' | 'comment', input: CatalogInput): Plan {
  const parameters: unknown[] = [];
  const bind = (value: unknown) => { parameters.push(value); return `__dbparam_${parameters.length}__`; };
  const filter = bind(input.filter ?? '');
  const contains = (column: string) => p.engine === 'sqlserver' ? `CHARINDEX(LOWER(${filter}),LOWER(${column})) > 0` : p.engine === 'oracle' ? `(${filter} IS NULL OR INSTR(LOWER(${column}),LOWER(${filter})) > 0)` : p.engine === 'snowflake' ? `POSITION(LOWER(${filter}),LOWER(${column})) > 0` : `STRPOS(LOWER(${column}),LOWER(${filter})) > 0`;
  const schema = () => bind(input.schema);
  const table = () => bind(input.table);
  let sql: string;
  if (p.engine === 'sqlserver') {
    switch (operation) {
      case 'list_databases': sql = `SELECT name FROM sys.databases WHERE HAS_DBACCESS(name)=1 AND ${contains('name')}`; break;
      case 'list_schemas': sql = `SELECT name FROM sys.schemas WHERE schema_id < 16384 AND ${contains('name')}`; break;
      case 'list_tables': case 'search_objects': sql = `SELECT s.name AS [schema], o.name, CASE o.type WHEN 'V' THEN 'view' ELSE 'table' END AS kind FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id WHERE o.type IN ('U','V') AND ${contains('o.name')}${input.schema ? ` AND s.name=${schema()}` : ''}`; break;
      case 'list_columns': case 'describe_table': sql = `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, CASE IS_NULLABLE WHEN 'YES' THEN 1 ELSE 0 END AS nullable, COLUMN_DEFAULT AS [default], ORDINAL_POSITION AS position FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=${schema()} AND TABLE_NAME=${table()} AND ${contains('COLUMN_NAME')}`; break;
      case 'constraints': sql = `SELECT tc.CONSTRAINT_NAME AS name, tc.CONSTRAINT_TYPE AS kind FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc WHERE tc.TABLE_SCHEMA=${schema()} AND tc.TABLE_NAME=${table()} AND ${contains('tc.CONSTRAINT_NAME')}`; break;
      case 'indexes': sql = `SELECT i.name, i.is_unique AS [unique], i.type_desc AS kind FROM sys.indexes i JOIN sys.objects o ON o.object_id=i.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id WHERE i.name IS NOT NULL AND s.name=${schema()} AND o.name=${table()} AND ${contains('i.name')}`; break;
      default: sql = `SELECT CAST(ep.value AS nvarchar(4000)) AS comment FROM sys.extended_properties ep JOIN sys.objects o ON ep.major_id=o.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id WHERE ep.minor_id=0 AND ep.class=1 AND ep.name='MS_Description' AND s.name=${schema()} AND o.name=${table()} AND ${contains('o.name')}`;
    }
  } else if (p.engine === 'oracle') {
    switch (operation) {
      case 'list_databases': sql = `SELECT ${bind(p.database)} AS name FROM dual WHERE ${filter} IS NULL OR INSTR(LOWER(${bind(p.database)}), LOWER(${filter}))>0`; break;
      case 'list_schemas': sql = `SELECT DISTINCT owner AS name FROM all_objects WHERE object_type IN ('TABLE','VIEW') AND ${contains('owner')}`; break;
      case 'list_tables': case 'search_objects': sql = `SELECT owner AS "schema", object_name AS name, LOWER(object_type) AS kind FROM all_objects WHERE object_type IN ('TABLE','VIEW') AND ${contains('object_name')}${input.schema ? ` AND owner=${schema()}` : ''}`; break;
      case 'list_columns': case 'describe_table': sql = `SELECT column_name AS name, data_type AS type, CASE nullable WHEN 'Y' THEN 1 ELSE 0 END AS nullable, column_id AS position FROM all_tab_columns WHERE owner=${schema()} AND table_name=${table()} AND ${contains('column_name')}`; break;
      case 'constraints': sql = `SELECT constraint_name AS name, constraint_type AS kind, status, r_owner AS referenced_schema, r_constraint_name AS referenced_constraint FROM all_constraints WHERE owner=${schema()} AND table_name=${table()} AND ${contains('constraint_name')}`; break;
      case 'indexes': sql = `SELECT index_name AS name, uniqueness AS kind FROM all_indexes WHERE table_owner=${schema()} AND table_name=${table()} AND ${contains('index_name')}`; break;
      default: sql = `SELECT comments AS "comment" FROM all_tab_comments WHERE owner=${schema()} AND table_name=${table()} AND ${contains('table_name')}`;
    }
  } else {
    const info = p.engine === 'snowflake' ? `${quote(p.database)}.INFORMATION_SCHEMA.` : `${googleIdentifier(`${p.database}.${input.schema ?? `region-${p.location!.toLowerCase()}`}.INFORMATION_SCHEMA`)}.`;
    const view = (name: string) => p.engine === 'snowflake' ? info + name : googleIdentifier(`${p.database}.${input.schema ?? `region-${p.location!.toLowerCase()}`}.INFORMATION_SCHEMA.${name}`);
    switch (operation) {
      case 'list_databases': sql = p.engine === 'snowflake' ? `SELECT DATABASE_NAME AS name FROM ${info}DATABASES WHERE ${contains('DATABASE_NAME')}` : `SELECT name FROM (SELECT ${bind(p.database)} AS name) WHERE ${contains('name')}`; break;
      case 'list_schemas': sql = `SELECT SCHEMA_NAME AS name FROM ${view('SCHEMATA')} WHERE ${contains('SCHEMA_NAME')}`; break;
      case 'list_tables': case 'search_objects': sql = `SELECT TABLE_SCHEMA AS ${p.engine === 'bigquery' ? '`schema`' : '"schema"'}, TABLE_NAME AS name, CASE TABLE_TYPE WHEN 'VIEW' THEN 'view' WHEN 'MATERIALIZED VIEW' THEN 'view' ELSE 'table' END AS kind FROM ${view('TABLES')} WHERE ${contains('TABLE_NAME')}${input.schema ? ` AND TABLE_SCHEMA=${schema()}` : ''}`; break;
      case 'list_columns': case 'describe_table': sql = `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE='YES' AS nullable, ORDINAL_POSITION AS position FROM ${view('COLUMNS')} WHERE TABLE_SCHEMA=${schema()} AND TABLE_NAME=${table()} AND ${contains('COLUMN_NAME')}`; break;
      case 'constraints': sql = `SELECT CONSTRAINT_NAME AS name, CONSTRAINT_TYPE AS kind FROM ${view('TABLE_CONSTRAINTS')} WHERE TABLE_SCHEMA=${schema()} AND TABLE_NAME=${table()} AND ${contains('CONSTRAINT_NAME')}`; break;
      default: sql = p.engine === 'snowflake' ? `SELECT COMMENT AS "comment" FROM ${view('TABLES')} WHERE TABLE_SCHEMA=${schema()} AND TABLE_NAME=${table()} AND ${contains('TABLE_NAME')}` : `SELECT option_value AS comment FROM ${view('TABLE_OPTIONS')} WHERE TABLE_SCHEMA=${schema()} AND TABLE_NAME=${table()} AND option_name='description' AND ${contains('TABLE_NAME')}`;
    }
  }
  const order = ['list_columns', 'describe_table'].includes(operation) ? 'position' : operation === 'comment' ? '1' : ['list_tables', 'search_objects'].includes(operation) ? (p.engine === 'sqlserver' ? '[schema], name' : p.engine === 'bigquery' ? '`schema`, name' : '"schema", name') : 'name';
  const limit = boundedInteger(input.limit, 100, 1, 200) + 1;
  const offset = boundedInteger(input.offset, 0, 0, 1_000_000);
  sql += ` ORDER BY ${order}`;
  sql += ['sqlserver', 'oracle'].includes(p.engine) ? ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY` : ` LIMIT ${limit} OFFSET ${offset}`;
  const ordered: unknown[] = [];
  sql = sql.replace(/__dbparam_(\d+)__/g, (_match, index) => {
    ordered.push(parameters[Number(index) - 1]);
    return p.engine === 'sqlserver' ? `@p${ordered.length}` : p.engine === 'oracle' ? `:${ordered.length}` : '?';
  });
  return { sql, parameters: ordered };
}

export abstract class CatalogAdapter implements Adapter {
  abstract query(profile: ConnectionProfile, password: string | undefined, options: QueryOptions): Promise<QueryResult>;
  abstract preview(schema: string, table: string): string;
  async test(p: ConnectionProfile, password: string | undefined, signal: AbortSignal) {
    await this.query(p, password, { sql: p.engine === 'oracle' ? 'SELECT 1 FROM dual' : 'SELECT 1', maxRows: 1, timeoutMs: p.engine === 'snowflake' ? 120_000 : 15_000, signal });
  }
  async catalog(p: ConnectionProfile, password: string | undefined, operation: CatalogOperation, input: CatalogInput, signal: AbortSignal): Promise<unknown> {
    if (input.database && input.database !== p.database) throw new UserError('This connection uses its configured database/project. Create a separate connection for another.');
    if (['list_tables', 'list_columns', 'describe_table'].includes(operation) && !input.schema) throw new UserError('schema is required (a dataset ID in BigQuery).');
    if (['list_columns', 'describe_table'].includes(operation) && !input.table) throw new UserError('table is required.');
    const select = async (op: Parameters<typeof catalogPlan>[1], args = input) => {
      const plan = catalogPlan(p, op, args);
      const limit = boundedInteger(args.limit, 100, 1, 200);
      const result = await this.query(p, password, { ...plan, maxRows: limit, timeoutMs: 30_000, signal });
      return { items: rowsAsObjects(result), truncated: result.truncated || result.cellsTruncated };
    };
    if (operation === 'describe_table') {
      const args = { ...input, filter: '', offset: 0, limit: 200 };
      const columns = await select('list_columns', args);
      const constraints = await select('constraints', args);
      const indexes = ['sqlserver', 'oracle'].includes(p.engine) ? await select('indexes', args) : { items: [], truncated: false, supported: false };
      const comment = await select('comment', args);
      return { connectionId: p.id, database: p.database, schema: input.schema, table: input.table, columns, constraints, indexes, comment: comment.items[0]?.comment ?? null,
        note: 'Metadata reflects the authenticated role. Empty metadata can mean missing privileges or a missing object.' };
    }
    const result = await select(operation);
    const offset = input.offset ?? 0;
    return { connectionId: p.id, database: p.database, ...result, offset, nextOffset: result.truncated ? offset + result.items.length : null,
      ...(operation === 'list_databases' && ['bigquery', 'oracle'].includes(p.engine) ? { note: 'Only the configured project/service is listed.' } : {}) };
  }
}
