/* All database-controlled content is rendered with textContent, never HTML. */
const vscode = acquireVsCodeApi();
for (const type of ['previous', 'next', 'cancel', 'export']) {
  document.getElementById(type).addEventListener('click', () => vscode.postMessage({ type }));
}
window.addEventListener('message', ({ data }) => {
  if (!data || !['results', 'unavailable'].includes(data.type)) return;
  const head = document.getElementById('head');
  const body = document.getElementById('body');
  head.replaceChildren(); body.replaceChildren();
  if (data.type === 'unavailable') {
    document.getElementById('status').textContent = data.message;
    document.getElementById('notice').textContent = '';
    document.getElementById('page').textContent = '';
    for (const id of ['previous', 'next', 'cancel', 'export']) document.getElementById(id).disabled = true;
    return;
  }
  document.getElementById('connection').textContent = `${data.connectionName} / ${data.database}`;
  document.getElementById('status').textContent = `${data.status.toUpperCase()} · ${data.source === 'agent' ? 'Copilot' : 'Manual query'}${data.durationMs !== undefined ? ` · ${data.durationMs} ms` : ''} · ${data.fetchedRows} rows retained`;
  document.getElementById('notice').textContent = data.error || (data.resultExpired ? 'Cached results expired. Reopen the SQL from query history to run it again.' : [data.truncated ? 'Partial result: row or size limit reached. Narrow the query to retrieve other rows.' : '', data.cellsTruncated ? 'Some values were shortened or omitted to fit the cell limit.' : '', ...(data.warnings ?? []), data.status === 'completed' && !data.fetchedRows ? 'The query returned no rows.' : ''].filter(Boolean).join(' '));
  document.getElementById('page').textContent = data.rows.length ? `${data.offset + 1}–${data.offset + data.rows.length} of ${data.fetchedRows} retained` : '';
  document.getElementById('previous').disabled = data.offset === 0;
  document.getElementById('next').disabled = data.nextOffset === null;
  document.getElementById('cancel').disabled = data.status !== 'running';
  document.getElementById('export').disabled = data.status !== 'completed' || data.resultExpired;
  const header = document.createElement('tr');
  for (const column of data.columns) {
    const th = document.createElement('th'); th.textContent = column.name; th.title = column.type; th.scope = 'col'; header.append(th);
  }
  head.append(header);
  for (const row of data.rows) {
    const tr = document.createElement('tr');
    for (const value of row) {
      const td = document.createElement('td');
      td.textContent = value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (value === null) td.className = 'null';
      td.title = td.textContent; tr.append(td);
    }
    body.append(tr);
  }
});
vscode.postMessage({ type: 'ready' });
