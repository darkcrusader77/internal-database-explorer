import * as vscode from 'vscode';
import { DatabaseService } from '../core/service';
import { CatalogInput, CatalogOperation } from '../core/types';

export class DatabaseNode extends vscode.TreeItem {
  constructor(label: string, readonly kind: 'connection' | 'schema' | 'table' | 'column' | 'more',
    readonly connectionId: string, readonly schema?: string, readonly table?: string,
    readonly offset = 0, readonly operation?: CatalogOperation) {
    super(label, ['connection', 'schema', 'table', 'more'].includes(kind) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.contextValue = kind;
    this.iconPath = new vscode.ThemeIcon({ connection: 'database', schema: 'symbol-namespace', table: 'table', column: 'symbol-field', more: 'ellipsis' }[kind]);
  }
}
interface CatalogPage { items: Record<string, unknown>[]; nextOffset: number | null }

export class Explorer implements vscode.TreeDataProvider<DatabaseNode>, vscode.Disposable {
  private changed = new vscode.EventEmitter<DatabaseNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private readonly service: DatabaseService) {}
  refresh() { this.changed.fire(undefined); }
  getTreeItem(node: DatabaseNode) { return node; }
  async getChildren(node?: DatabaseNode): Promise<DatabaseNode[]> {
    if (!node) return this.service.listConnections().map(p => {
      const item = new DatabaseNode(p.name, 'connection', p.id);
      item.description = p.database;
      item.tooltip = `${p.engine} · ${p.database}\n${p.status}\nCopilot ${p.agentEnabled ? 'enabled' : 'disabled'}`;
      return item;
    });
    if (node.kind === 'column') return [];
    const operation: CatalogOperation = node.operation ?? (node.kind === 'connection' ? 'list_schemas' : node.kind === 'schema' ? 'list_tables' : 'list_columns');
    const input: CatalogInput = { schema: node.schema, table: node.table, offset: node.offset, limit: 100 };
    const result = await this.service.catalog(node.connectionId, operation, input, 'user') as CatalogPage;
    const items = result.items.map(row => {
      if (operation === 'list_schemas') return new DatabaseNode(String(row.name), 'schema', node.connectionId, String(row.name));
      if (operation === 'list_tables') {
        const item = new DatabaseNode(String(row.name), 'table', node.connectionId, node.schema, String(row.name));
        item.description = String(row.kind);
        return item;
      }
      const item = new DatabaseNode(String(row.name), 'column', node.connectionId, node.schema, node.table);
      item.description = `${row.type}${row.nullable ? '' : ' · required'}`;
      return item;
    });
    if (result.nextOffset !== null) items.push(new DatabaseNode('Load next 100…', 'more', node.connectionId, node.schema, node.table, result.nextOffset, operation));
    return items;
  }
  dispose() { this.changed.dispose(); }
}
