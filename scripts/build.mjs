import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
const result = await build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', bundle: true,
  platform: 'node', format: 'cjs', target: 'node22', external: ['vscode', 'pg-native', 'mssql', 'oracledb', 'snowflake-sdk', '@google-cloud/bigquery', 'node-sql-parser'], sourcemap: true, metafile: true });
const packages = new Map();
// Drivers stay external so their runtime assets and platform loaders work in a VSIX.
const productionPaths = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { encoding: 'utf8' }).trim().split('\n').slice(1);
for (const directory of productionPaths) {
  if (!existsSync(join(directory, 'package.json'))) continue;
  const info = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  if (packages.has(`${info.name}@${info.version}`)) continue;
  const licenses = readdirSync(directory).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  packages.set(`${info.name}@${info.version}`,  `${info.name} ${info.version}\nLicense: ${info.license ?? 'See notice below'}\n` +
    licenses.map(name => readFileSync(join(directory, name), 'utf8')).join('\n'));
}
writeFileSync('THIRD_PARTY_NOTICES.txt', 'Third-party components bundled in Internal Database Explorer\n\n' +
  [...packages.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, notice]) => notice).join('\n\n----------------------------------------\n\n'));
