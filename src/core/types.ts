export type Engine = 'postgres' | 'sqlserver' | 'oracle' | 'snowflake' | 'bigquery';

export interface ConnectionProfile {
  id: string;
  revision: string;
  secretId: string;
  retiredSecretIds?: string[];
  name: string;
  engine: Engine;
  host: string;
  port: number;
  database: string;
  username: string;
  tls: 'verify-full' | 'disable';
  caPath?: string;
  agentEnabled: boolean;
  schema?: string;
  warehouse?: string;
  role?: string;
  accountUrl?: string;
  oauthMode?: 'authorization-code' | 'token';
  oauthClientId?: string;
  oauthAuthorizationUrl?: string;
  oauthTokenRequestUrl?: string;
  oauthScope?: string;
  oracleWalletPath?: string;
  location?: string;
  maximumBytesBilled?: string;
}

export interface ProfileStore {
  list(): ConnectionProfile[];
  password(id: string): Promise<string | undefined>;
}

export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: unknown[][];
  truncated: boolean;
  cellsTruncated: boolean;
  warnings?: string[];
}

export interface QueryOptions {
  sql: string;
  parameters?: unknown[];
  maxRows: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface CatalogInput {
  database?: string;
  schema?: string;
  table?: string;
  filter?: string;
  offset?: number;
  limit?: number;
}

export type CatalogOperation = 'list_databases' | 'list_schemas' | 'list_tables' | 'list_columns' | 'describe_table' | 'search_objects';
export interface Adapter {
  test(profile: ConnectionProfile, password: string | undefined, signal: AbortSignal): Promise<void>;
  query(profile: ConnectionProfile, password: string | undefined, options: QueryOptions): Promise<QueryResult>;
  catalog(profile: ConnectionProfile, password: string | undefined, operation: CatalogOperation, input: CatalogInput, signal: AbortSignal): Promise<unknown>;
  preview(schema: string, table: string): string;
  disconnect?(connectionId: string): void;
  dispose?(): void;
}

export type QueryStatus = 'running' | 'completed' | 'cancelled' | 'failed';
export interface Execution {
  id: string;
  connectionId: string;
  connectionName: string;
  database: string;
  source: 'user' | 'agent';
  sql: string;
  startedAt: string;
  durationMs?: number;
  status: QueryStatus;
  error?: string;
  result?: QueryResult;
}

export class UserError extends Error {}
