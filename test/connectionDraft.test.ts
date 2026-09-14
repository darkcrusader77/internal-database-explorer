import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConnectionDraft, FormError, secretKey, SecretStore } from '../src/core/connectionDraft';
import { ProfileRepository } from '../src/core/profileRepository';
import { profile } from './helpers';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'db-draft-test-'));
  const repository = new ProfileRepository(dir);
  const entries = new Map<string, string>();
  const secrets: SecretStore = { get: async key => entries.get(key), store: async (key, value) => { entries.set(key, value); }, delete: async key => { entries.delete(key); } };
  const values = { name: 'Sample', host: 'localhost', port: '5432', database: 'postgres', username: 'reader', password: 'test-secret', passwordAction: 'replace', tls: 'disable', caPath: '', agentEnabled: false };
  return { repository, entries, secrets, values, close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('testing unsaved settings uses entered credentials and writes nothing', async () => {
  const f = fixture();
  try {
    let tested = false;
    const draft = new ConnectionDraft(f.repository, f.secrets, async (p, password) => {
      assert.equal(p.host, 'localhost'); assert.equal(p.port, 5432); assert.equal(password, 'test-secret'); tested = true;
    }, () => true);
    await draft.test(f.values);
    assert.equal(tested, true);
    assert.deepEqual(f.repository.list(), []);
    assert.equal(f.entries.size, 0);
    const saved = await draft.save(f.values);
    assert.equal(f.repository.list().length, 1);
    assert.equal(f.entries.get(secretKey(saved.secretId)), 'test-secret');
    assert.ok(!JSON.stringify(f.repository.list()).includes('test-secret'));
  } finally { f.close(); }
});

test('editing initializes all options without exposing the saved password, and can keep or clear it', async () => {
  const f = fixture();
  try {
    const previous = profile({ tls: 'disable', agentEnabled: true });
    await f.repository.save(previous);
    f.entries.set(secretKey(previous.secretId), 'saved-secret');
    let received: string | undefined;
    const draft = new ConnectionDraft(f.repository, f.secrets, async (_p, password) => { received = password; }, () => true, previous);
    assert.equal(draft.initialValues().tls, 'disable');
    assert.equal(draft.initialValues().agentEnabled, true);
    assert.ok(!('password' in draft.initialValues()));
    await draft.test({ ...f.values, password: '', passwordAction: 'keep' });
    assert.equal(received, 'saved-secret');
    const saved = await draft.save({ ...f.values, password: '', passwordAction: 'clear' });
    assert.equal(f.entries.get(secretKey(saved.secretId)), '');
    assert.equal(f.entries.get(secretKey(previous.secretId)), 'saved-secret');
  } finally { f.close(); }
});

test('form validates fields on the host and rejects injected profile IDs', async () => {
  const f = fixture();
  try {
    const draft = new ConnectionDraft(f.repository, f.secrets, async () => { throw new Error('Should not connect'); }, () => true);
    await assert.rejects(draft.test({ ...f.values, host: 'postgres://host', port: '1e3' }), error => error instanceof FormError && !!error.fields.host && !!error.fields.port);
    const fakeId = randomUUID();
    await assert.rejects(draft.save({ ...f.values, engine: 'other' }), /highlighted/);
    const saved = await draft.save({ ...f.values, id: fakeId, secretId: fakeId });
    assert.notEqual(saved.id, fakeId);
    assert.notEqual(saved.secretId, fakeId);
    assert.equal(saved.engine, 'postgres');
  } finally { f.close(); }
});

test('stale form save keeps original profile and removes the unused new secret', async () => {
  const f = fixture();
  try {
    const previous = profile();
    await f.repository.save(previous);
    f.entries.set(secretKey(previous.secretId), 'original');
    const draft = new ConnectionDraft(f.repository, f.secrets, async () => undefined, () => true, previous);
    await f.repository.save({ ...previous, name: 'Other window', revision: randomUUID() }, previous.revision);
    await assert.rejects(draft.save(f.values), /another VS Code window/);
    assert.equal(f.repository.list()[0].name, 'Other window');
    assert.equal(f.entries.size, 1);
  } finally { f.close(); }
});

test('closing one form cancels only its own connection test', async () => {
  const f = fixture();
  try {
    const signals: AbortSignal[] = [];
    const tester = async (_p: unknown, _password: unknown, signal: AbortSignal) => {
      signals.push(signal);
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    };
    const a = new ConnectionDraft(f.repository, f.secrets, tester, () => true);
    const b = new ConnectionDraft(f.repository, f.secrets, tester, () => true);
    const qa = a.test(f.values), qb = b.test(f.values);
    const doneA = assert.rejects(qa, /cancelled/), doneB = assert.rejects(qb, /cancelled/);
    await new Promise(resolve => setImmediate(resolve));
    a.dispose();
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);
    b.dispose();
    await Promise.all([doneA, doneB]);
  } finally { f.close(); }
});

test('all database forms save engine settings and keep OAuth credentials outside profiles', async () => {
  const f = fixture();
  try {
    for (const engine of ['sqlserver', 'oracle', 'snowflake', 'bigquery'] as const) {
      const draft = new ConnectionDraft(f.repository, f.secrets, async () => undefined, () => true);
      const saved = await draft.save({ ...f.values, engine, tls: 'verify-full',
        database: engine === 'bigquery' ? 'my-project' : engine === 'oracle' ? 'FREEPDB1' : 'sample',
        accountUrl: 'https://org-account.snowflakecomputing.com', oauthMode: 'authorization-code', oauthClientId: 'client-id',
        oauthAuthorizationUrl: 'https://login.example.test/authorize', oauthTokenRequestUrl: 'https://login.example.test/token',
        location: 'US', maximumBytesBilled: '1073741824',
      });
      assert.equal(saved.engine, engine);
      assert.ok(!JSON.stringify(saved).includes('test-secret'));
      assert.equal(f.entries.get(secretKey(saved.secretId)), engine === 'bigquery' ? '' : 'test-secret');
      if (engine !== 'snowflake') assert.equal(saved.oauthClientId, undefined);
      if (engine === 'bigquery') { assert.equal(saved.host, ''); assert.equal(saved.username, ''); }
    }
    assert.equal(f.repository.list().length, 4);
  } finally { f.close(); }
});
