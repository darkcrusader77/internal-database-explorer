import * as vscode from 'vscode';
import { DatabaseService, safeError } from './core/service';
import { routeTool, toolDefinitions } from './core/toolRouter';
import { serialize } from './core/format';

export function registerTools(context: vscode.ExtensionContext, service: DatabaseService): void {
  for (const definition of toolDefinitions) {
    context.subscriptions.push(vscode.lm.registerTool(definition.name, {
      prepareInvocation(options) {
        const input = options.input as { connectionId?: string; sql?: string };
        const name = service.listConnections('agent').find(p => p.id === input.connectionId)?.name ?? input.connectionId;
        const message = new vscode.MarkdownString();
        message.appendText(`${definition.displayName}${name ? ` on ${name}` : ''}. This operation belongs to the current VS Code window. Results returned by this tool are shared with Copilot.`);
        if (input.sql) message.appendCodeblock(input.sql, 'sql');
        return { invocationMessage: `${definition.displayName}${name ? ` · ${name}` : ''}`,
          confirmationMessages: { title: `Database Explorer: ${definition.displayName}`, message } };
      },
      async invoke(options, token) {
        const controller = new AbortController();
        const listener = token.onCancellationRequested(() => controller.abort());
        if (token.isCancellationRequested) controller.abort();
        try {
          const result = await routeTool(service, definition.name, options.input, controller.signal);
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(serialize(result))]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(serialize({ error: controller.signal.aborted ? 'Tool invocation cancelled.' : safeError(error) }))]);
        } finally { listener.dispose(); }
      },
    }));
  }
}
