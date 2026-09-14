import * as vscode from 'vscode';
import assert from 'node:assert/strict';
export async function run() {
  const extension = vscode.extensions.getExtension('internal-tools.database-explorer');
  assert.ok(extension, 'Development extension should be installed in the isolated test host');
  const api = await extension.activate();
  assert.ok(api.sessionId);
  assert.equal(api.toolNames.length, 10);
  const commands = await vscode.commands.getCommands(true);
  for (const name of ['addConnection', 'runQuery', 'showHistory', 'disconnect']) assert.ok(commands.includes(`internalDatabase.${name}`), name);
  for (const name of api.toolNames) assert.ok(vscode.lm.tools.some(t => t.name === name), `Tool registered: ${name}`);
  await vscode.commands.executeCommand('internalDatabase.refresh');
  await vscode.commands.executeCommand('internalDatabase.addConnection');
  await vscode.commands.executeCommand('internalDatabase.addConnection');
  const findForms = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.label === 'New Database Connection');
  // Editor tabs arrive asynchronously from the workbench after the command returns.
  for (let attempt = 0; !findForms().length && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  const formTabs = findForms();
  assert.equal(formTabs.length, 1, 'Repeated Add should reveal one connection form');
  await vscode.window.tabGroups.close(formTabs[0]);
  const sql = await vscode.workspace.openTextDocument({ language: 'sql', content: 'SELECT 1;' });
  await vscode.window.showTextDocument(sql);
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', sql.uri);
  const run = lenses?.find(lens => lens.command?.command === 'internalDatabase.runQuery');
  assert.ok(run?.command?.title.startsWith('Database Explorer: Run SQL'));
  assert.equal(run?.command?.arguments?.[0].toString(), sql.uri.toString(), 'Run action must target its own SQL document');
  process.stdout.write('PASS: VS Code extension activation, commands, native Copilot tool registration, and empty explorer refresh.\n');
}
