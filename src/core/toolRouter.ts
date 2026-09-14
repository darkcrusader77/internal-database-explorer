import Ajv from 'ajv';
import { contributes } from '../../package.json';
import { DatabaseService } from './service';
import { CatalogInput, CatalogOperation, UserError } from './types';
import { serialize } from './format';

export const toolDefinitions = contributes.languageModelTools;
const ajv = new Ajv({ strict: false });
const validators = new Map(toolDefinitions.map(def => [def.name, ajv.compile(def.inputSchema)]));

/** Validate here as well as in VS Code so future frontends cannot bypass the tool contract. */
export async function routeTool(service: DatabaseService, name: string, input: unknown, signal: AbortSignal): Promise<unknown> {
  const validate = validators.get(name);
  if (!validate || !validate(input)) throw new UserError('Invalid database tool arguments. Check the tool schema.');
  signal.throwIfAborted();
  const p = input as unknown as CatalogInput & { connectionId: string; queryId: string; sql: string; parameters?: unknown[]; maxRows?: number; timeoutMs?: number };
  const operation = name.replace(/^internaldb_/, '');
  let output;
  switch (operation) {
    case 'list_connections': output = { sessionId: service.sessionId, connections: service.listConnections('agent') }; break;
    case 'run_query': {
      const q = service.startQuery(p.connectionId, p.sql, p.parameters, 'agent', p.maxRows, p.timeoutMs);
      output = { queryId: q.id, connectionId: q.connectionId, status: q.status, next: 'Poll get_query_results with this connectionId and queryId. Do not rerun the query to check status.' };
      break;
    }
    case 'get_query_results': output = service.getResults(p.connectionId, p.queryId, 'agent', p.offset, p.limit); break;
    case 'cancel_query': output = service.cancel(p.connectionId, p.queryId, 'agent'); break;
    default: output = await service.catalog(p.connectionId, operation as CatalogOperation, p, 'agent', signal);
  }
  if (Buffer.byteLength(serialize(output)) > 64 * 1024) {
    // Return valid, small structured output rather than cutting JSON in the middle of a value.
    return { connectionId: p.connectionId, queryId: p.queryId, outputTooLarge: true,
      message: 'This response exceeds the 64 KiB agent output limit. Request a smaller page or narrower columns/values. The full retained result is available in the window’s results grid.' };
  }
  return output;
}
