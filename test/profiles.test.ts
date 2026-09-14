import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ProfileRepository } from '../src/core/profileRepository';
import { profile } from './helpers';

test('profile edits detect stale revisions and every repository reads fresh state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-profiles-test-'));
  try {
    const a = new ProfileRepository(dir), b = new ProfileRepository(dir);
    const p = profile();
    await a.save(p);
    const modified = { ...p, name: 'Changed', revision: randomUUID() };
    await b.save(modified, p.revision);
    assert.equal(a.list()[0].name, 'Changed');
    await assert.rejects(a.save({ ...p, revision: randomUUID() }, p.revision), /another VS Code window/);
    await assert.rejects(a.remove(p.id, p.revision), /another window/);
    assert.ok(!readFileSync(a.file, 'utf8').includes('password'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('independent processes add profiles without losing each other’s updates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-profiles-process-test-'));
  try {
    const worker = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/profileWorker.ts', dir]);
      let stderr = '';
      child.stderr.on('data', data => stderr += data);
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
    });
    await Promise.all([worker(), worker(), worker()]);
    const profiles = new ProfileRepository(dir).list();
    assert.equal(profiles.length, 45);
    assert.equal(new Set(profiles.map(p => p.id)).size, 45);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
