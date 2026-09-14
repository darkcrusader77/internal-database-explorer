/** Keep exact numeric strings from drivers; serialize rich values without losing precision. */
export function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
}

export function displayCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? serialize(value) : String(value);
}

export function toCsv(columns: { name: string }[], rows: unknown[][]): string {
  const cell = (value: unknown) => {
    let text = displayCell(value);
    // Prevent spreadsheet formula evaluation when exporting database-controlled text.
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [columns.map(c => cell(c.name)).join(','), ...rows.map(row => row.map(cell).join(','))].join('\r\n') + '\r\n';
}

export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected an integer between ${min} and ${max}.`);
  }
  return value;
}
