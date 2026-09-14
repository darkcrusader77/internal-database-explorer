import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConnectionProfile, UserError } from './types';
import { extraFields, httpsUrl, isEngine } from './engines';

const uuid = /^[a-f0-9-]{36}$/i;
export function validateProfile(profile: ConnectionProfile): void {
  if (!uuid.test(profile.id) || !uuid.test(profile.revision) || !uuid.test(profile.secretId)) throw new UserError('Invalid profile identifier.');
  if (profile.retiredSecretIds && (!Array.isArray(profile.retiredSecretIds) || profile.retiredSecretIds.some(id => typeof id !== 'string' || !uuid.test(id)))) throw new UserError('Invalid secret references.');
  if (!isEngine(profile.engine)) throw new UserError('Choose a supported database type.');
  for (const value of [profile.name, profile.database, ...(['postgres', 'sqlserver', 'oracle'].includes(profile.engine) ? [profile.host, profile.username] : [])]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\r\n\0]/.test(value)) throw new UserError('Connection fields must contain 1–256 characters without line breaks.');
  }
  if (/[/@?=]/.test(profile.host)) throw new UserError('Enter a hostname or IP address, not a connection URL.');
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) throw new UserError('Port must be between 1 and 65535.');
  if (!['verify-full', 'disable'].includes(profile.tls) || typeof profile.agentEnabled !== 'boolean') throw new UserError('Invalid connection settings.');
  if (profile.caPath !== undefined && (typeof profile.caPath !== 'string' || profile.caPath.length > 4096)) throw new UserError('Invalid certificate path.');
  for (const key of extraFields) {
    const value = profile[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value))) throw new UserError(`Invalid ${key} setting.`);
  }
  if (profile.engine === 'oracle' && !/^[A-Za-z0-9_.-]+$/.test(profile.database)) throw new UserError('Enter an Oracle service name, not a connection descriptor.');
  if (profile.engine === 'snowflake') {
    const url = httpsUrl(profile.accountUrl ?? '');
    if (url.pathname !== '/' || url.search) throw new UserError('Enter the Snowflake account endpoint URL without a path or query.');
    if (!['authorization-code', 'token'].includes(profile.oauthMode ?? 'authorization-code')) throw new UserError('Choose a Snowflake OAuth mode.');
    if (profile.oauthMode !== 'token' && !profile.oauthClientId) throw new UserError('OAuth client ID is required for browser authorization.');
    for (const value of [profile.oauthAuthorizationUrl, profile.oauthTokenRequestUrl]) if (value) httpsUrl(value);
  }
  if (profile.engine === 'bigquery') {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(profile.database)) throw new UserError('Enter a valid Google Cloud project ID.');
    if (profile.schema && !/^[A-Za-z0-9_]+$/.test(profile.schema)) throw new UserError('Enter a valid default dataset ID.');
    if (!profile.location || !/^[A-Za-z0-9-]+$/.test(profile.location)) throw new UserError('Enter the BigQuery dataset location, such as US or us-east4.');
    if (!/^[1-9]\d{0,14}$/.test(profile.maximumBytesBilled ?? '')) throw new UserError('Enter a positive maximum bytes billed per query.');
  }
  if (['snowflake', 'bigquery'].includes(profile.engine) && profile.tls !== 'verify-full') throw new UserError('Cloud connections require verified HTTPS.');
}

/** Atomic disk snapshots, reread per operation. Never depend on a window's cached globalState.
 * A short filesystem lock plus revision checks prevents lost updates between extension hosts.
 */
export class ProfileRepository {
  readonly file: string;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, 'connections.json');
  }
  list(): ConnectionProfile[] {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error();
      parsed.forEach(validateProfile);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new UserError('Saved connection profiles could not be read. The existing file has not been changed.');
    }
  }
  async save(profile: ConnectionProfile, expectedRevision?: string): Promise<void> {
    validateProfile(profile);
    await this.mutate(profiles => {
      const previous = profiles.find(p => p.id === profile.id);
      if (previous?.revision !== expectedRevision) throw new UserError('This profile changed in another VS Code window. Reopen it before saving.');
      return [...profiles.filter(p => p.id !== profile.id), profile];
    });
  }
  async remove(id: string, expectedRevision: string): Promise<void> {
    await this.mutate(profiles => {
      if (profiles.find(p => p.id === id)?.revision !== expectedRevision) throw new UserError('This profile changed in another window. Refresh before removing it.');
      return profiles.filter(p => p.id !== id);
    });
  }
  private async mutate(update: (profiles: ConnectionProfile[]) => ConnectionProfile[]): Promise<void> {
    const lock = join(this.directory, 'connections.lock');
    for (let attempt = 0; attempt < 100; attempt++) {
      try { mkdirSync(lock, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
        continue;
      }
      const temp = join(this.directory, `connections-${randomUUID()}.tmp`);
      try {
        // No awaits while holding the lock: read/compare/write is one short critical section.
        const profiles = update(this.list());
        writeFileSync(temp, JSON.stringify(profiles, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        renameSync(temp, this.file);
        return;
      } finally {
        rmSync(temp, { force: true });
        rmSync(lock, { recursive: true, force: true });
      }
    }
    throw new UserError('Another window is updating profiles. Retry shortly. If a host crashed, close all VS Code windows before removing connections.lock from extension storage.');
  }
}
