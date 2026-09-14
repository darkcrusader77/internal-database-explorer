import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { DatabaseService, safeError } from '../core/service';
import { toCsv } from '../core/format';

export class ResultsView implements vscode.Disposable, vscode.WebviewViewProvider {
  private panel?: vscode.WebviewView;
  private viewSubscriptions: vscode.Disposable[] = [];
  private current?: { connectionId: string; queryId: string };
  private offset = 0;
  private change = (queryId?: string) => {
    if (queryId && queryId === this.current?.queryId) void this.update();
    else if (!queryId) void this.update();
  };
  constructor(private readonly context: vscode.ExtensionContext, private readonly service: DatabaseService) { service.on('change', this.change); }
  show(connectionId: string, queryId: string) {
    this.current = { connectionId, queryId };
    this.offset = 0;
    if (this.panel) {
      this.panel.show(true);
      void this.update();
      return;
    }
    // Opening the contributed container also resolves the view on first use.
    void vscode.commands.executeCommand('workbench.view.extension.internalDatabaseResults').then(
      () => { this.panel?.show(true); return this.update(); }, error => { void vscode.window.showErrorMessage(safeError(error)); },
    );
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.viewSubscriptions.forEach(subscription => subscription.dispose());
    this.panel = view;
    view.webview.options = {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    const disposed = view.onDidDispose(() => {
      if (this.panel === view) this.panel = undefined;
    });
    const visibility = view.onDidChangeVisibility(() => { if (view.visible) void this.update(); });
    const messages = view.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== 'object' || !this.current) return;
      const type = (message as { type?: unknown }).type;
      try {
        switch (type) {
          case 'ready': await this.update(); break;
          case 'next': this.offset = Math.min(900, this.offset + 100); await this.update(); break;
          case 'previous': this.offset = Math.max(0, this.offset - 100); await this.update(); break;
          case 'cancel': this.service.cancel(this.current.connectionId, this.current.queryId); break;
          case 'export': await this.export(); break;
        }
      } catch (error) { void vscode.window.showErrorMessage(safeError(error)); }
    });
    this.viewSubscriptions = [disposed, visibility, messages];
    view.webview.html = this.html(view.webview);
  }
  private async update() {
    if (!this.current || !this.panel) return;
    try {
      const q = this.service.getExecution(this.current.connectionId, this.current.queryId);
      await this.panel.webview.postMessage({ type: 'results', connectionName: q.connectionName, source: q.source,
        ...this.service.getResults(this.current.connectionId, this.current.queryId, 'user', this.offset, 100) });
    } catch {
      await this.panel.webview.postMessage({ type: 'unavailable', message: 'This query is no longer available in this window. Its profile or history may have been removed.' });
    }
  }
  private async export() {
    if (!this.current) return;
    const query = this.service.getExecution(this.current.connectionId, this.current.queryId);
    if (!query.result) return;
    const uri = await vscode.window.showSaveDialog({ title: `Export ${query.result.rows.length} retained rows${query.result.truncated ? ' (partial result)' : ''}`, filters: { CSV: ['csv'] }, defaultUri: vscode.Uri.file('query-results.csv') });
    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(toCsv(query.result.columns, query.result.rows)));
      void vscode.window.showInformationMessage(`Exported ${query.result.rows.length} retained rows${query.result.truncated || query.result.cellsTruncated ? ' with truncation' : ''}. Spreadsheet formula-like text is escaped.`);
    }
  }
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(24).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'results.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'results.css'));
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
      <link rel="stylesheet" href="${style}"><title>Database Results</title></head><body>
      <header><h1 id="connection">Query results</h1><p id="status" role="status">Run a query to see results here.</p></header>
      <nav aria-label="Result actions"><button id="previous" disabled>Previous</button><span id="page"></span><button id="next" disabled>Next</button><span class="spacer"></span><button id="cancel" disabled>Cancel query</button><button id="export" disabled>Export retained rows</button></nav>
      <p id="notice" role="status"></p><main tabindex="0" aria-label="Scrollable query results"><table><thead id="head"></thead><tbody id="body"></tbody></table></main>
      <footer>Results and query handles belong to this VS Code window. Maximum 1,000 retained rows · read-only preview.</footer>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
  dispose() {
    this.service.off('change', this.change);
    this.viewSubscriptions.forEach(subscription => subscription.dispose());
    this.panel = undefined;
  }
}
