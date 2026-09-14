import * as vscode from 'vscode';
import { watch } from 'node:fs';
import { ProfileRepository } from './core/profileRepository';
import { DatabaseService, safeError } from './core/service';
import { ConnectionProfile, UserError } from './core/types';
import { PostgresAdapter } from './adapters/postgres';
import { SqlServerAdapter } from './adapters/sqlserver';
import { OracleAdapter } from './adapters/oracle';
import { SnowflakeAdapter } from './adapters/snowflake';
import { BigQueryAdapter } from './adapters/bigquery';
import { engines, starterQuery } from './core/engines';
import { ConnectionEditors, secretKey } from './ui/connections';
import { DatabaseNode, Explorer } from './ui/explorer';
import { ResultsView } from './ui/results';
import { registerTools } from './tools';
import { toolDefinitions } from './core/toolRouter';

export function activate(context: vscode.ExtensionContext) {
  const repository = new ProfileRepository(context.globalStorageUri.fsPath);
  const service = new DatabaseService({ list: () => repository.list(), password: async id => context.secrets.get(secretKey(id)) },
    { postgres: new PostgresAdapter(), sqlserver: new SqlServerAdapter(), oracle: new OracleAdapter(), snowflake: new SnowflakeAdapter(), bigquery: new BigQueryAdapter() }, () => vscode.workspace.isTrusted);
  const explorer = new Explorer(service);
  const tree = vscode.window.createTreeView('internalDatabase.connections', { treeDataProvider: explorer });
  const results = new ResultsView(context, service);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('internalDatabase.results', results, {
    webviewOptions: { retainContextWhenHidden: true },
  }));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.command = 'internalDatabase.selectConnection';
  status.name = 'Database Explorer connection';
  const runStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 19);
  runStatus.name = 'Database Explorer Run SQL';
  runStatus.text = '$(play) Run SQL';
  runStatus.command = 'internalDatabase.runQuery';
  const lensesChanged = new vscode.EventEmitter<void>();
  let selectedId: string | undefined; // Deliberately window-local; never store in globalState.
  const documentConnections = new Map<string, string>();
  let previousLensState = '';

  const updateStatus = () => {
    const profiles = repository.list();
    const editorId = vscode.window.activeTextEditor && documentConnections.get(vscode.window.activeTextEditor.document.uri.toString());
    const selected = profiles.find(p => p.id === (editorId ?? selectedId));
    status.text = selected ? `$(database) DB Explorer: ${selected.name} / ${selected.database}` : '$(database) DB Explorer: Select connection';
    status.tooltip = 'Database Explorer: select a connection for this SQL editor. Other database extensions use separate connections.';
    status.show();
    runStatus.tooltip = selected ? `Database Explorer: Run SQL on ${selected.name} / ${selected.database}` : 'Database Explorer: Select a connection and run SQL';
    if (vscode.window.activeTextEditor?.document.languageId === 'sql') runStatus.show(); else runStatus.hide();
    const lensState = JSON.stringify([selectedId, [...documentConnections], profiles.map(p => [p.id, p.name, p.database])]);
    // Replacing an unchanged lens on editor focus can interrupt its mouse click.
    if (lensState !== previousLensState) { previousLensState = lensState; lensesChanged.fire(); }
  };
  const sqlEditor = (resource?: vscode.Uri) => resource instanceof vscode.Uri
    ? vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === resource.toString())
    : vscode.window.activeTextEditor;
  const lenses = vscode.languages.registerCodeLensProvider({ language: 'sql' }, {
    onDidChangeCodeLenses: lensesChanged.event,
    provideCodeLenses(document) {
      const id = documentConnections.get(document.uri.toString()) ?? selectedId;
      const profile = repository.list().find(p => p.id === id);
      const range = new vscode.Range(0, 0, 0, 0);
      return [new vscode.CodeLens(range, {
        title: profile ? `Database Explorer: Run SQL · ${profile.name}` : 'Database Explorer: Run SQL (choose connection)',
        command: 'internalDatabase.runQuery', arguments: [document.uri],
      }), new vscode.CodeLens(range, {
        title: profile ? `Change connection · ${profile.database}` : 'Select connection',
        command: 'internalDatabase.selectConnection', arguments: [document.uri],
      })];
    },
  });
  const refresh = () => { explorer.refresh(); updateStatus(); };
  const guard = (action: (...args: any[]) => unknown) => async (...args: any[]) => {
    try {
      if (!vscode.workspace.isTrusted) throw new UserError('Trust this workspace before accessing databases.');
      return await action(...args);
    } catch (error) { void vscode.window.showErrorMessage(safeError(error)); }
  };
  const command = (name: string, action: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(`internalDatabase.${name}`, guard(action)));
  async function choose(node?: DatabaseNode, preferSelected = false): Promise<ConnectionProfile | undefined> {
    const profiles = repository.list();
    const id = node?.connectionId ?? (preferSelected ? selectedId : undefined);
    if (id) {
      const profile = profiles.find(p => p.id === id);
      if (profile) return profile;
    }
    if (!profiles.length) { void vscode.window.showInformationMessage('Add a database connection to get started.'); return undefined; }
    const pick = await vscode.window.showQuickPick(profiles.map(p => ({ label: p.name, description: [engines[p.engine].label, p.database, p.engine === 'bigquery' ? p.location : p.engine === 'snowflake' ? p.accountUrl : `${p.host}:${p.port}`].filter(Boolean).join(' · '), profile: p })), { title: 'Select connection for this window', ignoreFocusOut: true });
    return pick?.profile;
  }
  async function openSql(profile: ConnectionProfile, content: string) {
    const document = await vscode.workspace.openTextDocument({ language: 'sql', content });
    documentConnections.set(document.uri.toString(), profile.id);
    selectedId = profile.id;
    updateStatus();
    await vscode.window.showTextDocument(document);
  }
  const connectionEditors = new ConnectionEditors(context, repository, service, (profile, editing) => {
    if (editing) service.disconnect(profile.id);
    selectedId = profile.id;
    refresh();
  });
  command('addConnection', () => connectionEditors.open());
  command('editConnection', async (node?: DatabaseNode) => {
    const previous = await choose(node);
    if (previous) connectionEditors.open(previous);
  });
  command('removeConnection', async (node?: DatabaseNode) => {
    const profile = await choose(node);
    if (!profile) return;
    const confirmation = await vscode.window.showWarningMessage(`Remove “${profile.name}” from this OS user’s saved connections? Other VS Code windows will also lose this profile.`, { modal: true }, 'Remove');
    if (confirmation !== 'Remove') return;
    await repository.remove(profile.id, profile.revision);
    service.disconnect(profile.id);
    for (const [uri, id] of documentConnections) if (id === profile.id) documentConnections.delete(uri);
    for (const id of [profile.secretId, ...(profile.retiredSecretIds ?? [])]) await context.secrets.delete(secretKey(id));
    if (selectedId === profile.id) selectedId = undefined;
    refresh();
  });
  command('connect', async (node?: DatabaseNode) => {
    const profile = await choose(node);
    if (!profile) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Connecting to ${profile.name}`, cancellable: true }, async (_progress, token) => {
      const controller = new AbortController();
      const listener = token.onCancellationRequested(() => controller.abort());
      try { await service.testConnection(profile.id, controller.signal); } finally { listener.dispose(); }
    });
    selectedId = profile.id;
    refresh();
    void vscode.window.showInformationMessage(`Connected to ${profile.name}. Queries and results are isolated to this window.`);
  });
  command('disconnect', async (node?: DatabaseNode) => {
    const profile = await choose(node, true);
    if (profile) { service.disconnect(profile.id); if (selectedId === profile.id) selectedId = undefined; refresh(); }
  });
  command('selectConnection', async (target?: DatabaseNode | vscode.Uri) => {
    const editor = sqlEditor(target instanceof vscode.Uri ? target : undefined);
    const profile = await choose(target instanceof vscode.Uri ? undefined : target);
    if (profile) {
      selectedId = profile.id;
      if (editor?.document.languageId === 'sql') documentConnections.set(editor.document.uri.toString(), profile.id);
      updateStatus();
    }
  });
  command('refresh', refresh);
  command('newQuery', async (node?: DatabaseNode) => {
    const profile = await choose(node, true);
    if (profile) await openSql(profile, starterQuery(profile));
  });
  command('previewTable', async (node?: DatabaseNode) => {
    if (!node?.schema || !node.table) return;
    const profile = await choose(node);
    if (profile) await openSql(profile, service.preview(profile.id, node.schema, node.table));
  });
  command('runQuery', async (resource?: vscode.Uri) => {
    const editor = sqlEditor(resource);
    if (!editor || editor.document.languageId !== 'sql') throw new UserError('Open a SQL document to run a query.');
    const id = documentConnections.get(editor.document.uri.toString()) ?? selectedId;
    const profile = repository.list().find(p => p.id === id) ?? await choose();
    if (!profile) return;
    documentConnections.set(editor.document.uri.toString(), profile.id);
    selectedId = profile.id;
    updateStatus();
    const sql = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
    const query = service.startQuery(profile.id, sql);
    results.show(profile.id, query.id);
  });
  command('showHistory', async () => {
    const pick = await vscode.window.showQuickPick(service.history().map(q => ({ label: `${q.status} · ${q.connectionName}`, description: q.startedAt,
      detail: q.sql.slice(0, 200), query: q })), { title: 'Query history — this window only', matchOnDetail: true });
    if (!pick) return;
    const profile = repository.list().find(p => p.id === pick.query.connectionId);
    if (!profile) throw new UserError('This connection profile was removed.');
    await openSql(profile, pick.query.sql);
    if (pick.query.result || pick.query.status === 'running') results.show(profile.id, pick.query.id);
  });
  command('clearHistory', () => service.clearHistory());
  service.on('change', (id?: string) => {
    if (id) {
      const q = service.history().find(q => q.id === id);
      if (q?.source === 'agent' && q.status === 'running') results.show(q.connectionId, q.id);
    }
  });
  let debounce: NodeJS.Timeout | undefined;
  const watcher = watch(repository.directory, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { try { refresh(); } catch { /* Commands report corrupt profile errors. */ } }, 100);
  });
  watcher.on('error', () => { /* Refresh also runs whenever the window regains focus. */ });
  registerTools(context, service);
  context.subscriptions.push(tree, explorer, results, status, runStatus, lenses, lensesChanged, connectionEditors, { dispose: () => service.dispose() },
    { dispose: () => { clearTimeout(debounce); watcher.close(); } },
    vscode.window.onDidChangeWindowState(state => { if (state.focused) { try { refresh(); } catch { /* See commands. */ } } }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      const id = editor && documentConnections.get(editor.document.uri.toString());
      if (id && repository.list().some(p => p.id === id)) selectedId = id;
      try { updateStatus(); } catch { /* See commands. */ }
    }),
    vscode.workspace.onDidCloseTextDocument(document => documentConnections.delete(document.uri.toString())));
  updateStatus();
  return { sessionId: service.sessionId, toolNames: toolDefinitions.map(t => t.name) };
}
