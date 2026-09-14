import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { ProfileRepository } from '../core/profileRepository';
import { ConnectionProfile } from '../core/types';
import { ConnectionDraft, FormError } from '../core/connectionDraft';
import { DatabaseService, safeError } from '../core/service';
import { connectionFormHtml } from './connectionFormHtml';
export { secretKey } from '../core/connectionDraft';

export class ConnectionEditors implements vscode.Disposable {
  private panels = new Map<string, vscode.WebviewPanel>();
  constructor(private readonly context: vscode.ExtensionContext, private readonly repository: ProfileRepository,
    private readonly service: DatabaseService, private readonly onSaved: (profile: ConnectionProfile, editing: boolean) => void) {}

  open(previous?: ConnectionProfile): void {
    const key = previous?.id ?? 'new';
    const existing = this.panels.get(key);
    if (existing) { existing.reveal(); return; }
    const panel = vscode.window.createWebviewPanel('internalDatabase.connection', previous ? `Edit ${previous.name}` : 'New Database Connection', vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    });
    this.panels.set(key, panel);
    const draft = new ConnectionDraft(this.repository, this.context.secrets,
      (profile, password, signal) => this.service.testDraft(profile, password, signal), () => vscode.workspace.isTrusted, previous);
    let disposed = false;
    let pending = false;
    const send = (message: unknown) => { if (!disposed) void panel.webview.postMessage(message); };
    const messages = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const { type, values, requestId } = message as { type?: string; values?: unknown; requestId?: number };
      if (type === 'ready') { send({ type: 'initialize', values: draft.initialValues() }); return; }
      if (type === 'cancelTest') { draft.cancelTest(); return; }
      if (type === 'close') { if (!pending) panel.dispose(); return; }
      if (type !== 'test' && type !== 'save') return;
      if (pending || !Number.isSafeInteger(requestId)) return;
      pending = true;
      try {
        if (type === 'test') {
          const { durationMs } = await draft.test(values);
          send({ type: 'success', action: type, requestId, message: `Connection successful · ${durationMs} ms. You can save these settings.` });
        } else {
          const profile = await draft.save(values);
          this.onSaved(profile, !!previous);
          vscode.window.setStatusBarMessage(`$(check) Connection “${profile.name}” saved.`, 5000);
          panel.dispose();
        }
      } catch (error) {
        send({ type: 'error', action: type, requestId, message: safeError(error), fields: error instanceof FormError ? error.fields : {} });
      } finally { pending = false; }
    });
    panel.onDidDispose(() => { disposed = true; draft.dispose(); messages.dispose(); this.panels.delete(key); });
    const webview = panel.webview;
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name)).toString();
    webview.html = connectionFormHtml(webview.cspSource, randomBytes(24).toString('base64'), asset('connection.css'), asset('connection.js'));
  }
  dispose() { for (const panel of [...this.panels.values()]) panel.dispose(); }
}
