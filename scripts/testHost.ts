import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function main() {
  await build({ entryPoints: ['test/host/suite.ts'], outfile: 'dist/hostTest.cjs', bundle: true, platform: 'node', external: ['vscode'] });
  const directory = mkdtempSync(join(tmpdir(), 'internal-db-host-'));
  const installed = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  try {
    await runTests({ extensionDevelopmentPath: resolve('.'), extensionTestsPath: resolve('dist/hostTest.cjs'),
      ...(existsSync(installed) ? { vscodeExecutablePath: installed } : {}),
      launchArgs: ['--user-data-dir', join(directory, 'user'), '--extensions-dir', join(directory, 'extensions'),
        '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox'] });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
