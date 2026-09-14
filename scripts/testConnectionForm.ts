import { _electron as electron, expect, Frame, Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, symlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function main() {
  const sample = JSON.parse(readFileSync('.local-postgres/connection.json', 'utf8'));
  const directory = mkdtempSync(join(tmpdir(), 'db-form-ui-'));
  const user = join(directory, 'user');
  mkdirSync(join(directory, 'extensions'));
  symlinkSync(resolve('.'), join(directory, 'extensions/internal-tools.internal-database-explorer-0.3.0'), 'dir');
  mkdirSync(join(user, 'User'), { recursive: true });
  writeFileSync(join(user, 'User/settings.json'), JSON.stringify({ 'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off', 'window.commandCenter': false, 'chat.disableAIFeatures': true }));
  const executable = process.env.VSCODE_EXECUTABLE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: executable, env,
    args: [`--extensionDevelopmentPath=${resolve('.')}`, '--user-data-dir', user, '--extensions-dir', join(directory, 'extensions'),
      '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox'], timeout: 30_000 });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 30_000 });
    async function command(page: Page, name: string) {
      await page.bringToFront();
      await page.keyboard.press('F1');
      const input = page.locator('.quick-input-widget input');
      await input.fill(`>${name}`);
      await page.getByRole('option', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().waitFor({ timeout: 15_000 });
      await input.press('Enter');
    }
    async function form(): Promise<Frame> {
      let found: Frame | undefined;
      await expect.poll(async () => {
        for (const frame of window.frames()) if (await frame.locator('#connection-form').count()) { found = frame; return true; }
        return false;
      }, { timeout: 20_000 }).toBe(true);
      return found!;
    }
    await command(window, 'Database Explorer: Add Connection');
    let editor = await form();
    await expect(editor.locator('#test')).toBeEnabled();
    // Each database type exposes its relevant settings in one form.
    await editor.locator('#engine').selectOption('sqlserver');
    await expect(editor.locator('#port')).toHaveValue('1433');
    await expect(editor.locator('#username')).toBeVisible();
    await expect(editor.locator('#password')).toBeVisible();
    await editor.locator('#engine').selectOption('oracle');
    await expect(editor.locator('#port')).toHaveValue('1521');
    await expect(editor.locator('#database-label')).toHaveText('Service name');
    await expect(editor.locator('#oracleWalletPath')).toBeVisible();
    await editor.locator('#engine').selectOption('snowflake');
    for (const id of ['accountUrl', 'oauthMode', 'oauthClientId', 'oauthAuthorizationUrl', 'oauthTokenRequestUrl', 'warehouse', 'role']) await expect(editor.locator(`#${id}`)).toBeVisible();
    await expect(editor.locator('#host')).toBeHidden();
    mkdirSync('artifacts', { recursive: true });
    await window.screenshot({ path: 'artifacts/snowflake-connection.png' });
    await editor.locator('#oauthMode').selectOption('token');
    await expect(editor.locator('#password-label')).toHaveText('OAuth access token');
    await expect(editor.locator('#oauthClientId')).toBeHidden();
    await editor.locator('#engine').selectOption('bigquery');
    for (const id of ['location', 'maximumBytesBilled', 'schema']) await expect(editor.locator(`#${id}`)).toBeVisible();
    await expect(editor.locator('#password')).toBeHidden();
    await expect(editor.locator('#username')).toBeHidden();
    await expect(editor.locator('#auth-help')).toContainText('gcloud auth application-default login');
    await window.screenshot({ path: 'artifacts/bigquery-connection.png' });
    await editor.locator('#engine').selectOption('postgres');

    for (const id of ['name', 'engine', 'host', 'port', 'database', 'username', 'password', 'tls', 'caPath', 'agentEnabled', 'test', 'save']) await expect(editor.locator(`#${id}`)).toBeVisible();
    await editor.locator('#test').click();
    await expect(editor.locator('#username-error')).toHaveText('This field is required.');
    await editor.locator('#name').fill('Sample form test');
    await editor.locator('#host').fill(sample.host);
    await editor.locator('#port').fill(String(sample.port));
    await editor.locator('#database').fill(sample.database);
    await editor.locator('#username').fill(sample.username);
    await editor.locator('#password').fill('intentionally-wrong');
    await editor.locator('#tls').selectOption('disable');
    await expect(editor.locator('#caPath')).toBeDisabled();
    await editor.locator('#agentEnabled').check();
    await editor.locator('#test').click();
    await expect(editor.locator('#feedback')).toContainText('Authentication failed', { timeout: 15_000 });
    await expect(editor.locator('#host')).toHaveValue(sample.host);
    await editor.locator('#password').fill(sample.password);
    await editor.locator('#test').click();
    await expect(editor.locator('#feedback')).toContainText('Connection successful', { timeout: 15_000 });
    const profiles = join(user, 'User/globalStorage/internal-tools.internal-database-explorer/connections.json');
    expect(existsSync(profiles)).toBe(false);
    mkdirSync('artifacts', { recursive: true });
    await editor.locator('#title').scrollIntoViewIfNeeded();
    await window.screenshot({ path: 'artifacts/connection-form.png' });
    // Editing after a successful test must not leave a misleading success indicator.
    await editor.locator('#name').fill('Sample form test saved');
    await expect(editor.locator('#feedback')).toContainText('Settings changed');
    await editor.locator('#save').click();
    await expect.poll(() => existsSync(profiles)).toBe(true);
    const saved = JSON.parse(readFileSync(profiles, 'utf8'));
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Sample form test saved');
    expect(saved[0].tls).toBe('disable');
    expect(saved[0].agentEnabled).toBe(true);
    expect(readFileSync(profiles, 'utf8')).not.toContain(sample.password);
    await command(window, 'Database Explorer: Edit Connection');
    const pick = window.locator('.quick-input-widget input');
    await expect(pick).toBeVisible();
    await pick.fill('Sample form test saved');
    await pick.press('Enter');
    editor = await form();
    await expect(editor.locator('#name')).toHaveValue('Sample form test saved');
    await expect(editor.locator('#tls')).toHaveValue('disable');
    await expect(editor.locator('#agentEnabled')).toBeChecked();
    await expect(editor.locator('#password')).toHaveValue('');
    await editor.locator('#test').click();
    await expect(editor.locator('#feedback')).toContainText('Connection successful', { timeout: 15_000 });
    await editor.locator('#close').click();
    await command(window, 'Database Explorer: New SQL Query');
    const runSql = window.locator('.codelens-decoration a').filter({ hasText: 'Database Explorer: Run SQL · Sample form test saved' });
    await expect(runSql).toBeVisible();
    await runSql.click();
    let resultFrame: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of window.frames()) if (await frame.locator('#status').filter({ hasText: 'COMPLETED' }).count()) { resultFrame = frame; return true; }
      return false;
    }, { timeout: 15_000 }).toBe(true);
    await expect(resultFrame!.locator('#body')).toContainText(sample.database);
    await expect(resultFrame!.locator('#body')).toContainText(sample.username);
    const bottomPanel = window.locator('.part.panel');
    await expect(bottomPanel).toBeVisible();
    await expect(bottomPanel.getByRole('tab', { name: 'Database Results', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(runSql).toBeVisible(); // SQL remains in the editor above the results.
    await command(window, 'View: Toggle Output');
    await command(window, 'Database Results: Focus on Database Results View');
    await expect(resultFrame!.locator('#body')).toContainText(sample.database);
    await window.screenshot({ path: 'artifacts/query-results.png' });
    // Both windows share saved profiles, but must keep different active selections.
    const secondProfile = { ...saved[0], id: randomUUID(), name: 'Window two connection' };
    writeFileSync(profiles, JSON.stringify([...saved, secondProfile]));
    const nextWindow = app.waitForEvent('window', { timeout: 20_000 }).catch(error => { return error as Error; });
    await command(window, 'New Window');
    const otherWindow = await nextWindow;
    if (otherWindow instanceof Error) throw otherWindow;
    await otherWindow.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 30_000 });
    await command(otherWindow, 'Database Explorer: New SQL Query');
    const otherPick = otherWindow.locator('.quick-input-widget input');
    await expect(otherPick).toBeVisible(); // A new window has no inherited active connection.
    await otherPick.fill(secondProfile.name);
    await otherPick.press('Enter');
    await expect(otherWindow.getByText(`Database Explorer: Run SQL · ${secondProfile.name}`, { exact: true })).toBeVisible();
    await window.bringToFront();
    await expect(runSql).toBeVisible();
    await expect(window.getByText('DB Explorer: Sample form test saved / explorer_sample', { exact: true })).toBeVisible();
    await expect(resultFrame!.locator('#body')).toContainText(sample.database);
    process.stdout.write('PASS: separate active connections in two VS Code windows sharing saved profiles.\n');
    process.stdout.write('PASS: real VS Code connection form, secure credentials, labeled SQL run control, and bottom-panel query results retained across panel switches.\n');
  } catch (error) {
    mkdirSync('artifacts', { recursive: true });
    const page = app.windows()[0];
    if (page) await page.screenshot({ path: 'artifacts/connection-form-failure.png' }).catch(() => undefined);
    if (existsSync(join(user, 'logs'))) cpSync(join(user, 'logs'), 'artifacts/ui-test-logs', { recursive: true });
    throw error;
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
