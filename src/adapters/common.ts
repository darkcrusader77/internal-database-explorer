import { serialize } from '../core/format';
import { QueryResult, UserError } from '../core/types';

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_CELL = 16_384;
/** Drivers feed bounded batches/streams into this collector, never a full result array. */
export class ResultCollector {
  readonly result: QueryResult = { columns: [], rows: [], truncated: false, cellsTruncated: false };
  private bytes = 2;
  constructor(readonly maxRows: number) {}
  add(row: unknown[]): boolean {
    if (this.result.rows.length >= this.maxRows) { this.result.truncated = true; return false; }
    const normalized = row.map(value => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'bigint') value = String(value);
      if (value instanceof Date) value = value.toISOString();
      if (Buffer.isBuffer(value)) { if (value.length > MAX_CELL / 2) this.result.cellsTruncated = true; value = value.subarray(0, MAX_CELL / 2).toString('hex') + (value.length > MAX_CELL / 2 ? '… [truncated binary]' : ''); }
      const encoded = typeof value === 'string' ? value : serialize(value);
      if (encoded.length > MAX_CELL) { this.result.cellsTruncated = true; return encoded.slice(0, MAX_CELL) + '… [truncated]'; }
      return value;
    });
    const bytes = Buffer.byteLength(serialize(normalized)) + 1;
    if (this.bytes + bytes > MAX_BYTES) { this.result.truncated = true; return false; }
    this.bytes += bytes;
    this.result.rows.push(normalized);
    return true;
  }
}

/** One deadline and cancellation callback per operation. No global connection state. */
export function deadline(signal: AbortSignal, timeoutMs: number, stop: () => void) {
  signal.throwIfAborted();
  let expired = false;
  let rejectStop!: (error: unknown) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  void stopped.catch(() => {});
  const abort = () => {
    try { stop(); } catch { /* Cleanup is best effort. */ }
    rejectStop(expired ? new UserError('Query exceeded its time limit.') : new UserError('Operation cancelled in this window.'));
  };
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { expired = true; abort(); }, timeoutMs);
  return {
    check() { signal.throwIfAborted(); if (expired) throw new UserError('Query exceeded its time limit.'); },
    wait<T>(work: PromiseLike<T>): Promise<T> { return Promise.race([work, stopped]); },
    finish() { clearTimeout(timer); signal.removeEventListener('abort', abort); },
  };
}
export const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
export const bracket = (value: string) => '[' + value.replaceAll(']', ']]') + ']';
export function googleIdentifier(value: string) {
  if (/[`\\\r\n\0]/.test(value)) throw new UserError('Unsupported BigQuery identifier.');
  return '`' + value + '`';
}
export function rowsAsObjects(result: QueryResult) {
  return result.rows.map(row => Object.fromEntries(result.columns.map((column, index) => [column.name.toLowerCase(), column.name.toLowerCase() === 'nullable' ? [true, 1, '1', 'YES', 'Y', 'true'].includes(row[index] as string) : row[index]])));
}
