import { randomUUID } from 'node:crypto';
import { ConnectionProfile, Execution } from '../src/core/types';
export const profile = (changes: Partial<ConnectionProfile> = {}): ConnectionProfile => ({
  id: randomUUID(), revision: randomUUID(), secretId: randomUUID(), name: 'Test', engine: 'postgres',
  host: 'localhost', port: 5432, database: 'postgres', username: 'reader', tls: 'disable', agentEnabled: true, ...changes,
});
export async function finished(execution: Execution): Promise<Execution> {
  const deadline = Date.now() + 10_000;
  while (execution.status === 'running') {
    if (Date.now() > deadline) throw new Error('Query did not finish within test deadline.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return execution;
}
