(() => {
  const vscode = acquireVsCodeApi();
  const el = id => document.getElementById(id);
  const fields = ['name', 'engine', 'host', 'port', 'database', 'username', 'tls', 'caPath', 'schema', 'warehouse', 'role', 'accountUrl', 'oauthMode', 'oauthClientId', 'oauthAuthorizationUrl', 'oauthTokenRequestUrl', 'oauthScope', 'oracleWalletPath', 'location', 'maximumBytesBilled'];
  const defaults = { postgres: ['PostgreSQL', 5432, 'postgres'], sqlserver: ['SQL Server', 1433, 'master'], oracle: ['Oracle', 1521, 'FREEPDB1'], snowflake: ['Snowflake', 443, ''], bigquery: ['BigQuery', 443, ''] };
  let previousEngine = 'postgres';
  let editing = false;
  let initialized = false;
  let busy = false;
  let requestId = 0;
  function feedback(message, state = '') {
    el('feedback').textContent = message;
    el('feedback').className = `feedback ${state}`;
  }
  function syncOptions() {
    const engine = el('engine').value;
    document.body.dataset.engine = engine;
    const cloud = ['snowflake', 'bigquery'].includes(engine);
    const token = el('oauthMode').value === 'token';
    const show = (name, visible) => { el(`${name}-field`).hidden = !visible; };
    for (const name of ['host', 'port', 'username', 'tls']) show(name, !cloud);
    show('password', engine !== 'bigquery');
    show('caPath', ['postgres', 'sqlserver'].includes(engine));
    el('authentication-section').hidden = engine === 'bigquery';
    el('engine-settings').hidden = ['postgres', 'sqlserver'].includes(engine);
    for (const name of ['accountUrl', 'warehouse', 'role', 'oauthMode']) show(name, engine === 'snowflake');
    for (const name of ['oauthClientId', 'oauthAuthorizationUrl', 'oauthTokenRequestUrl', 'oauthScope']) show(name, engine === 'snowflake' && !token);
    show('schema', cloud);
    for (const name of ['location', 'maximumBytesBilled']) show(name, engine === 'bigquery');
    show('oracleWalletPath', engine === 'oracle' && el('tls').value !== 'disable');
    el('database-label').textContent = engine === 'bigquery' ? 'Google Cloud project ID' : engine === 'oracle' ? 'Service name' : 'Database';
    el('engine-badge').textContent = defaults[engine][0];
    el('engine-settings-title').textContent = `${defaults[engine][0]} settings`;
    el('password-label').textContent = engine === 'snowflake' ? token ? 'OAuth access token' : 'OAuth client secret (optional for public clients)' : 'Password (optional)';
    el('auth-help').textContent = engine === 'bigquery'
      ? 'Uses Google Application Default Credentials. Run gcloud auth application-default login on the extension host, or configure GOOGLE_APPLICATION_CREDENTIALS. The byte limit caps query billing; the result grid also has separate row and memory limits.'
      : engine === 'snowflake' ? 'Use your account endpoint URL, not the app.snowflake.com worksheet URL. Browser OAuth needs your company’s client registration. Authorization and token URLs can target your identity provider. Each window uses its own session and an available local callback port.'
      : 'Uses the Oracle Thin driver and a service name. Verified TLS can use an Oracle PEM wallet. No Instant Client installation is required.';
    el('caPath').disabled = el('tls').value === 'disable';
    el('caPath-help').textContent = el('tls').value === 'disable' ? 'Not used while TLS is disabled.' : 'Leave blank to use system defaults.';
    el('password').disabled = el('clear-password').checked;
    el('show-password').disabled = el('clear-password').checked;
  }
  function setBusy(action) {
    busy = !!action;
    el('fields').disabled = busy || !initialized;
    for (const id of ['test', 'save', 'close']) el(id).disabled = busy || !initialized;
    el('test').textContent = action === 'test' ? 'Testing…' : 'Test Connection';
    el('save').textContent = action === 'save' ? 'Saving…' : 'Save Connection';
    el('cancel-test').hidden = action !== 'test';
    el('cancel-test').disabled = false;
    el('connection-form').setAttribute('aria-busy', String(busy));
  }
  function clearErrors() {
    for (const error of document.querySelectorAll('.error')) error.textContent = '';
    for (const field of document.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
  }
  function showErrors(errors) {
    let first;
    for (const [name, message] of Object.entries(errors)) {
      const field = el(name), error = el(`${name}-error`);
      if (field && error) { error.textContent = message; field.setAttribute('aria-invalid', 'true'); first ??= field; }
    }
    first?.focus();
  }
  function values() {
    return { ...Object.fromEntries(fields.map(name => [name, el(name).value])), password: el('password').value,
      passwordAction: el('clear-password').checked ? 'clear' : editing && !el('password').value ? 'keep' : 'replace',
      agentEnabled: el('agentEnabled').checked };
  }
  function submit(action) {
    if (busy || !initialized) return;
    clearErrors();
    const errors = {};
    for (const name of ['name', 'database', ...(['snowflake', 'bigquery'].includes(el('engine').value) ? [] : ['host', 'username'])]) if (!el(name).value.trim()) errors[name] = 'This field is required.';
    if (!/^\d+$/.test(el('port').value) || Number(el('port').value) < 1 || Number(el('port').value) > 65535) errors.port = 'Enter a port between 1 and 65535.';
    if (Object.keys(errors).length) { showErrors(errors); feedback('Check the highlighted fields.', 'failure'); return; }
    const input = values();
    setBusy(action);
    feedback(action === 'test' ? `Connecting to ${defaults[input.engine][0]} / ${input.database}…` : 'Saving connection…', 'pending');
    vscode.postMessage({ type: action, requestId: ++requestId, values: input });
  }
  el('test').addEventListener('click', () => submit('test'));
  el('connection-form').addEventListener('submit', event => { event.preventDefault(); submit('save'); });
  el('close').addEventListener('click', () => vscode.postMessage({ type: 'close' }));
  el('cancel-test').addEventListener('click', () => {
    el('cancel-test').disabled = true;
    feedback('Cancelling connection test…', 'pending');
    vscode.postMessage({ type: 'cancelTest' });
  });
  el('show-password').addEventListener('click', () => {
    const showing = el('password').type === 'password';
    el('password').type = showing ? 'text' : 'password';
    el('show-password').textContent = showing ? 'Hide' : 'Show';
    el('show-password').setAttribute('aria-pressed', String(showing));
    el('show-password').setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
  });
  el('engine').addEventListener('change', () => {
    const engine = el('engine').value;
    if (el('name').value === defaults[previousEngine][0]) el('name').value = defaults[engine][0];
    el('port').value = String(defaults[engine][1]);
    el('database').value = defaults[engine][2];
    el('database').placeholder = engine === 'bigquery' ? 'my-project-id' : engine === 'snowflake' ? 'DATABASE_NAME' : defaults[engine][2];
    el('password').value = ''; el('clear-password').checked = false;
    if (['snowflake', 'bigquery'].includes(engine)) el('tls').value = 'verify-full';
    previousEngine = engine;
  });
  for (const event of ['input', 'change']) el('fields').addEventListener(event, () => {
    if (busy) return;
    syncOptions();
    clearErrors();
    feedback('Settings changed. Test again to verify this connection.');
  });
  window.addEventListener('message', ({ data }) => {
    if (data?.type === 'initialize') {
      if (initialized) return;
      editing = data.values.editing;
      previousEngine = data.values.engine || 'postgres';
      for (const field of fields) el(field).value = String(data.values[field] ?? '');
      el('agentEnabled').checked = data.values.agentEnabled;
      el('clear-password-row').hidden = !editing;
      el('title').textContent = editing ? 'Edit connection' : 'New connection';
      el('save').textContent = 'Save Connection';
      if (editing) {
        el('password').placeholder = 'Leave blank to keep saved password';
        el('password-help').textContent = 'Leave blank to keep the saved password, or enter a replacement.';
      }
      initialized = true;
      syncOptions(); setBusy(null); el('name').focus();
      return;
    }
    if (!['success', 'error'].includes(data?.type) || data.requestId !== requestId) return;
    setBusy(null); syncOptions();
    feedback(data.message, data.type === 'success' ? 'success' : 'failure');
    if (data.fields) showErrors(data.fields);
  });
  // Do not persist passwords through setState or browser storage.
  vscode.postMessage({ type: 'ready' });
})();
