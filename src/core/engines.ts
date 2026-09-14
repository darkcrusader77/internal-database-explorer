import { ConnectionProfile, Engine, UserError } from './types';

export const engines: Record<Engine, { label: string; port: number; database: string }> = {
  postgres: { label: 'PostgreSQL', port: 5432, database: 'postgres' },
  sqlserver: { label: 'SQL Server', port: 1433, database: 'master' },
  oracle: { label: 'Oracle', port: 1521, database: 'FREEPDB1' },
  snowflake: { label: 'Snowflake', port: 443, database: '' },
  bigquery: { label: 'BigQuery', port: 443, database: '' },
};
export function isEngine(value: unknown): value is Engine { return typeof value === 'string' && Object.hasOwn(engines, value); }
export const extraFields = ['schema', 'warehouse', 'role', 'accountUrl', 'oauthClientId', 'oauthAuthorizationUrl', 'oauthTokenRequestUrl', 'oauthScope', 'oracleWalletPath', 'location', 'maximumBytesBilled'] as const;
export function httpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new UserError('Enter a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new UserError('Use an HTTPS URL without embedded credentials or a fragment.');
  return url;
}
export function starterQuery(profile: ConnectionProfile) {
  switch (profile.engine) {
    case 'postgres': return 'SELECT current_database(), current_user;\n';
    case 'sqlserver': return 'SELECT DB_NAME() AS database_name, USER_NAME() AS user_name;\n';
    case 'oracle': return "SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS database_name, USER AS user_name FROM dual;\n";
    case 'snowflake': return 'SELECT CURRENT_DATABASE(), CURRENT_USER(), CURRENT_WAREHOUSE();\n';
    case 'bigquery': return 'SELECT SESSION_USER() AS user_name, CURRENT_TIMESTAMP() AS query_time;\n';
  }
}
