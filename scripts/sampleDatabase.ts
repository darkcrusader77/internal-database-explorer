import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PostgresAdapter } from '../src/adapters/postgres';
import { validateReadQuery } from '../src/core/readOnly';
import { ConnectionProfile } from '../src/core/types';

const directory = resolve('.local-postgres');
const cluster = join(directory, 'data');
const socket = join(directory, 'socket');
const settingsFile = join(directory, 'connection.json');
interface Settings { host: string; port: number; database: string; username: string; password: string }
const running = () => spawnSync('pg_ctl', ['-D', cluster, 'status'], { stdio: 'pipe' }).status === 0;

async function availablePort(preferred: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && preferred) void availablePort(0).then(resolvePort, reject);
      else reject(error);
    });
    server.listen(preferred, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolvePort(port));
    });
  });
}

async function main() {
  const action = process.argv[2] ?? 'start';
  if (!['start','stop','info'].includes(action)) throw new Error('Use start, stop, or info.');
  if (action === 'stop') {
    if (existsSync(cluster) && running()) execFileSync('pg_ctl', ['-D', cluster, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
    process.stdout.write('Sample PostgreSQL stopped. Data is preserved.\n');
    return;
  }
  if (action === 'info') {
    if (!existsSync(settingsFile)) throw new Error('Run npm run sample:start first.');
    process.stdout.write(`${readFileSync(settingsFile,'utf8')}Running: ${running()}\nTLS: disable\n`);
    return;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(socket, { recursive: true, mode: 0o700 });
  let settings: Settings;
  if (existsSync(settingsFile)) settings = JSON.parse(readFileSync(settingsFile,'utf8'));
  else {
    settings = { host: '127.0.0.1', port: await availablePort(55432), database: 'explorer_sample', username: 'explorer_reader', password: randomBytes(15).toString('base64url') };
    writeFileSync(settingsFile, JSON.stringify(settings,null,2)+'\n', { mode: 0o600, flag: 'wx' });
  }
  if (!existsSync(join(cluster,'PG_VERSION'))) {
    execFileSync('initdb', ['-D',cluster,'-U','sample_admin','--auth-local=trust','--auth-host=scram-sha-256','--no-locale','-E','UTF8'], { stdio: 'pipe' });
    const configPath = socket.replaceAll("'", "''");
    appendFileSync(join(cluster,'postgresql.conf'), `\n# Local Database Explorer sample\nlisten_addresses='127.0.0.1'\nport=${settings.port}\nunix_socket_directories='${configPath}'\nssl=off\npassword_encryption='scram-sha-256'\n`);
  }
  if (!running()) execFileSync('pg_ctl', ['-D',cluster,'-l',join(directory,'server.log'),'-w','start'], { stdio: 'pipe' });
  const admin = new Client({ host: socket, port: settings.port, database: 'postgres', user: 'sample_admin' });
  await admin.connect();
  try {
    const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[settings.username]);
    if (!role.rowCount) {
      const literal = settings.password.replaceAll("'","''");
      await admin.query(`CREATE ROLE explorer_reader LOGIN PASSWORD '${literal}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        ALTER ROLE explorer_reader SET default_transaction_read_only=on;`);
    }
    const database = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[settings.database]);
    if (!database.rowCount) {
      await admin.query('CREATE DATABASE explorer_sample OWNER sample_admin');
      await admin.query('REVOKE ALL ON DATABASE explorer_sample FROM PUBLIC');
      await admin.query('GRANT CONNECT ON DATABASE explorer_sample TO explorer_reader');
    }
  } finally { await admin.end(); }
  const seed = new Client({ host: socket, port: settings.port, database: settings.database, user:'sample_admin' });
  await seed.connect();
  try {
    const exists = await seed.query("SELECT to_regclass('crm.customers') AS table_name");
    if (!exists.rows[0].table_name) await seed.query(readFileSync(resolve('scripts/sample-data.sql'),'utf8'));
  } finally { await seed.end(); }
  const adapter = new PostgresAdapter();
  const connection: ConnectionProfile = { id:randomUUID(),revision:randomUUID(),secretId:randomUUID(),
    host:settings.host,port:settings.port,database:settings.database,username:settings.username,
    engine:'postgres',name:'Local Sample PostgreSQL',tls:'disable',agentEnabled:true };
  const sql = 'SELECT * FROM analytics.monthly_sales ORDER BY month, region';
  validateReadQuery(sql);
  const result = await adapter.query(connection, settings.password, { sql, maxRows:100,timeoutMs:10_000,signal:new AbortController().signal });
  process.stdout.write(`Sample PostgreSQL is running. Verified ${result.rows.length} monthly sales rows through the extension adapter.\n${JSON.stringify(settings,null,2)}\nTLS: disable\n`);
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode=1; });
