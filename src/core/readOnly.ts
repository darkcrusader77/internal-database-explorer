import { parse } from 'pgsql-ast-parser';
import { Engine, UserError } from './types';

/** Defense in depth. PostgreSQL and Oracle also use server-side read-only transactions.
 * Database roles must have least-privilege grants. SQL parsing is not a sandbox.
 */
export function validateReadQuery(sql: string, engine: Engine = 'postgres'): void {
  if (!sql.trim() || Buffer.byteLength(sql) > 100_000) throw new UserError('Enter a query of at most 100 KB.');
  if (engine !== 'postgres') { validateOtherDialect(sql, engine); return; }
  let statements;
  try { statements = parse(sql); }
  catch { throw new UserError('This release accepts a single parseable PostgreSQL SELECT query. This syntax is unsupported; simplify the query.'); }
  if (statements.length !== 1) throw new UserError('Run one SELECT statement at a time.');
  function inspect(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.type === 'string' && [
      'insert', 'update', 'delete', 'truncate table', 'create table', 'drop table',
      'commit', 'rollback', 'start transaction', 'set', 'do', 'copy',
    ].includes(obj.type)) throw new UserError('Only read queries are supported in this release.');
    if (obj.into) throw new UserError('SELECT INTO is not supported.');
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) value.forEach(inspect); else if (value && typeof value === 'object') inspect(value);
    }
  }
  if (!['select', 'union', 'union all', 'with', 'with recursive'].includes(statements[0].type)) {
    throw new UserError('Only SELECT queries and read-only CTEs are supported in this release.');
  }
  inspect(statements[0]);
}

function validateOtherDialect(sql: string, engine: Engine) {
  // Oracle's server validates the statement type before execution; lexical rejection also
  // prevents transaction control, DML CTEs, SELECT INTO and multiple statements.
  if (engine === 'oracle') {
    const tokens: string[] = [];
    const pattern = /\s+|--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9$#]*|[\s\S]/gy;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql))) {
      const token = match[0];
      if (/^\s|^--|^\/\*|^['"]/.test(token)) continue;
      tokens.push(token.toUpperCase());
    }
    if (tokens.at(-1) === ';') tokens.pop();
    const blocked = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'DROP', 'ALTER', 'TRUNCATE', 'COMMIT', 'ROLLBACK', 'BEGIN', 'DECLARE', 'EXECUTE', 'GRANT', 'REVOKE', 'INTO', 'CALL']);
    if (!['SELECT', 'WITH'].includes(tokens[0]) || tokens.includes(';') || tokens.some(token => blocked.has(token))) throw new UserError('Run one read-only SELECT or CTE without transaction control.');
    return;
  }
  // Load the dialect parser only when a non-PostgreSQL connection uses it.
  const { Parser } = require('node-sql-parser') as typeof import('node-sql-parser');
  let ast: unknown;
  try { ast = new Parser().astify(['snowflake', 'bigquery'].includes(engine) ? sql.replace(/\?/g, 'NULL') : sql, { database: { sqlserver: 'TransactSQL', snowflake: 'Snowflake', bigquery: 'BigQuery', postgres: 'Postgresql' }[engine] }); }
  catch { throw new UserError(`This syntax is unsupported by the ${engine} read-query validator. Use a single SELECT or read-only CTE.`); }
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1 || statements[0]?.type !== 'select') throw new UserError('Run one SELECT or read-only CTE at a time.');
  const blocked = new Set(['insert', 'update', 'delete', 'merge', 'create', 'drop', 'alter', 'truncate', 'exec', 'call', 'replace']);
  function inspect(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    if (blocked.has(String(obj.type).toLowerCase()) || (obj.into && (obj.into as { position?: unknown }).position) || obj.locking_read) throw new UserError('Only read queries are supported.');
    if (obj.into && typeof obj.into === 'object' && Object.values(obj.into).some(Boolean)) throw new UserError('SELECT INTO is not supported.');
    Object.values(obj).forEach(child => { if (Array.isArray(child)) child.forEach(inspect); else inspect(child); });
  }
  inspect(statements[0]);
}
