import { randomUUID } from 'node:crypto';
import { ProfileRepository, validateProfile } from './profileRepository';
import { ConnectionProfile, UserError } from './types';
import { engines, extraFields, isEngine } from './engines';

export const secretKey = (id: string) => `internalDatabase.password.${id}`;
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
export class FormError extends UserError {
  constructor(readonly fields: Record<string, string>) { super('Check the highlighted fields.'); }
}
type Tester = (profile: ConnectionProfile, password: string | undefined, signal: AbortSignal) => Promise<void>;

/** Each editor owns a draft and test controller; no passwords or test state go to shared storage. */
export class ConnectionDraft {
  private controller?: AbortController;
  private busy = false;
  private disposed = false;
  constructor(private readonly repository: ProfileRepository, private readonly secrets: SecretStore,
    private readonly tester: Tester, private readonly trusted: () => boolean, readonly previous?: ConnectionProfile) {}
  initialValues() {
    const p = this.previous;
    return { editing: !!p, engine: p?.engine ?? 'postgres', name: p?.name ?? 'PostgreSQL', host: p?.host ?? 'localhost', port: p?.port ?? 5432,
      database: p?.database ?? 'postgres', username: p?.username ?? '', tls: p?.tls ?? 'verify-full',
      caPath: p?.caPath ?? '', agentEnabled: p?.agentEnabled ?? false, oauthMode: p?.oauthMode ?? 'authorization-code',
      ...Object.fromEntries(extraFields.map(key => [key, p?.[key] ?? (key === 'location' ? 'US' : key === 'maximumBytesBilled' ? '1073741824' : '')])) };
  }
  private check() {
    if (this.disposed) throw new UserError('This connection editor is closed.');
    if (!this.trusted()) throw new UserError('Trust this workspace before testing or saving connections.');
  }
  private parse(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UserError('Invalid connection form.');
    const data = input as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const engine = data.engine ?? this.previous?.engine ?? 'postgres';
    if (!isEngine(engine)) throw new FormError({ engine: 'Choose a supported database type.' });
    const cloud = engine === 'snowflake' || engine === 'bigquery';
    const text = (key: string, required = true, max = 256) => {
      const value = typeof data[key] === 'string' ? data[key].trim() : '';
      if ((required && !value) || value.length > max || /[\r\n\0]/.test(value)) errors[key] = required ? `Enter a value of 1–${max} characters without line breaks.` : `Use at most ${max} characters without line breaks.`;
      return value;
    };
    const name = text('name'), host = cloud ? '' : text('host'), database = text('database'), username = cloud ? '' : text('username');
    if (/[/@?=]/.test(host)) errors.host = 'Enter a hostname or IP address, not a connection URL.';
    const portText = String(cloud ? 443 : data.port ?? engines[engine].port);
    const port = Number(portText);
    if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) errors.port = 'Enter a port between 1 and 65535.';
    if (!['verify-full', 'disable'].includes(String(data.tls))) errors.tls = 'Choose a TLS setting.';
    const caPath = cloud || engine === 'oracle' || data.tls === 'disable' ? '' : text('caPath', false, 4096);
    if (typeof data.agentEnabled !== 'boolean') errors.agentEnabled = 'Choose whether to allow Copilot access.';
    const action = data.passwordAction;
    if (!['keep', 'replace', 'clear'].includes(String(action)) || (action === 'keep' && !this.previous)) errors.password = 'Enter a password or leave it blank for passwordless authentication.';
    const password = typeof data.password === 'string' ? data.password : '';
    if (password.length > 16384 || password.includes('\0') || typeof data.password !== 'string') errors.password = 'Use a credential of at most 16384 characters without null characters.';
    if (action === 'keep' && this.previous && (engine !== this.previous.engine || (engine === 'snowflake' && data.oauthMode !== (this.previous.oauthMode ?? 'authorization-code')))) errors.password = 'Enter a new credential when changing the database type or authentication method.';
    const extras: Partial<ConnectionProfile> = {};
    const keys = engine === 'snowflake' ? ['schema', 'warehouse', 'role', 'accountUrl', 'oauthClientId', 'oauthAuthorizationUrl', 'oauthTokenRequestUrl', 'oauthScope'] as const
      : engine === 'bigquery' ? ['schema', 'location', 'maximumBytesBilled'] as const : engine === 'oracle' ? ['oracleWalletPath'] as const : [];
    for (const key of keys) extras[key] = text(key, false, 4096) || undefined;
    if (engine === 'snowflake') {
      extras.oauthMode = data.oauthMode as ConnectionProfile['oauthMode'];
      if (extras.oauthMode === 'token') for (const key of ['oauthClientId', 'oauthAuthorizationUrl', 'oauthTokenRequestUrl', 'oauthScope'] as const) delete extras[key];
      if (!extras.accountUrl) errors.accountUrl = 'Enter the Snowflake account HTTPS URL.';
      if (extras.oauthMode !== 'token' && !extras.oauthClientId) errors.oauthClientId = 'Enter your OAuth integration client ID.';
      if (extras.oauthMode === 'token' && action !== 'keep' && !password) errors.password = 'Enter an OAuth access token.';
    }
    if (engine === 'oracle' && data.tls === 'disable') delete extras.oracleWalletPath;
    if (engine === 'bigquery') {
      if (!extras.location) errors.location = 'Enter the dataset location.';
      if (!/^[1-9]\d{0,14}$/.test(extras.maximumBytesBilled ?? '')) errors.maximumBytesBilled = 'Enter a positive byte limit.';
    }
    if (Object.keys(errors).length) throw new FormError(errors);
    const profile: ConnectionProfile = { id: this.previous?.id ?? randomUUID(), revision: randomUUID(), secretId: randomUUID(),
      name, host, database, username, port, engine, tls: cloud ? 'verify-full' : data.tls as ConnectionProfile['tls'], ...extras,
      caPath: caPath || undefined, agentEnabled: data.agentEnabled as boolean,
      retiredSecretIds: this.previous ? [...(this.previous.retiredSecretIds ?? []), this.previous.secretId] : [] };
    validateProfile(profile);
    return { profile, action: engine === 'bigquery' ? 'clear' : action, password };
  }
  private async password(data: ReturnType<ConnectionDraft['parse']>): Promise<string> {
    if (data.action === 'keep') {
      const password = await this.secrets.get(secretKey(this.previous!.secretId));
      if (password === undefined) throw new FormError({ password: 'Saved password is unavailable. Enter it again, or select “Clear saved password”.' });
      return password;
    }
    return data.action === 'clear' ? '' : data.password;
  }
  private begin() {
    this.check();
    if (this.busy) throw new UserError('Wait for the current connection operation to finish.');
    this.busy = true;
  }
  async test(input: unknown): Promise<{ durationMs: number }> {
    this.begin();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const started = Date.now();
    try {
      const data = this.parse(input);
      const password = await this.password(data);
      this.check();
      signal.throwIfAborted();
      await this.tester(data.profile, password, signal);
      signal.throwIfAborted();
      return { durationMs: Date.now() - started };
    } catch (error) {
      if (signal.aborted) throw new UserError('Connection test cancelled.');
      throw error;
    } finally { this.controller = undefined; this.busy = false; }
  }
  async save(input: unknown): Promise<ConnectionProfile> {
    this.begin();
    try {
      const data = this.parse(input);
      const password = await this.password(data);
      this.check();
      await this.secrets.store(secretKey(data.profile.secretId), password);
      try {
        this.check();
        await this.repository.save(data.profile, this.previous?.revision);
      } catch (error) { await this.secrets.delete(secretKey(data.profile.secretId)); throw error; }
      return data.profile;
    } finally { this.busy = false; }
  }
  cancelTest() { this.controller?.abort(); }
  dispose() { this.disposed = true; this.cancelTest(); }
}
