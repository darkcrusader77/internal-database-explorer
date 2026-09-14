/** Profile values arrive as data after load, never interpolated into markup. */
export function connectionFormHtml(cspSource: string, nonce: string, style: string, script: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none';">
<link rel="stylesheet" href="${style}"><title>Database Connection</title></head>
<body><main class="page">
  <header><span class="eyebrow">DATABASE EXPLORER</span><div class="title-row"><h1 id="title">New connection</h1><span class="badge" id="engine-badge">PostgreSQL</span></div>
  <p class="subtitle">Enter your database details, test the connection, and save when you’re ready.</p></header>
  <form id="connection-form" novalidate autocomplete="off">
    <fieldset id="fields" disabled><legend class="sr-only">Connection settings</legend>
      <section class="section"><div class="section-heading"><h2>Connection</h2><span>Required unless marked optional.</span></div>
        <div class="grid">
          <div class="field"><label for="name">Connection name</label><input id="name" name="name" maxlength="256" required placeholder="e.g. Local Sample PostgreSQL" aria-describedby="name-error"><span class="error" id="name-error"></span></div>
          <div class="field"><label for="engine">Database type</label><select id="engine" aria-describedby="engine-error"><option value="postgres">PostgreSQL</option><option value="sqlserver">SQL Server</option><option value="oracle">Oracle</option><option value="snowflake">Snowflake</option><option value="bigquery">BigQuery</option></select><span class="error" id="engine-error"></span></div>
          <div class="field" id="host-field"><label for="host">Host</label><input id="host" name="host" maxlength="256" required spellcheck="false" placeholder="localhost" aria-describedby="host-error"><span class="error" id="host-error"></span></div>
          <div class="field" id="port-field"><label for="port">Port</label><input id="port" name="port" type="number" min="1" max="65535" step="1" required inputmode="numeric" aria-describedby="port-error"><span class="error" id="port-error"></span></div>
          <div class="field full"><label for="database" id="database-label">Database</label><input id="database" name="database" maxlength="256" required spellcheck="false" placeholder="postgres" aria-describedby="database-error"><span class="error" id="database-error"></span></div>
        </div>
      </section>
      <section class="section" id="engine-settings" hidden><h2 id="engine-settings-title">Database settings</h2><div class="grid">
        <div class="field" id="oauthMode-field"><label for="oauthMode">Snowflake OAuth method</label><select id="oauthMode"><option value="authorization-code">Browser authorization code</option><option value="token">Existing OAuth access token</option></select><span class="error" id="oauthMode-error"></span></div>
        <div class="field" id="accountUrl-field"><label for="accountUrl">Snowflake account URL</label><input id="accountUrl" maxlength="4096" spellcheck="false" placeholder="https://organization-account.snowflakecomputing.com" aria-describedby="accountUrl-error"><span class="error" id="accountUrl-error"></span></div>
        <div class="field" id="schema-field"><label for="schema">Default schema / dataset (optional)</label><input id="schema" maxlength="4096" spellcheck="false" placeholder="" aria-describedby="schema-error"><span class="error" id="schema-error"></span></div>
        <div class="field" id="warehouse-field"><label for="warehouse">Warehouse (optional)</label><input id="warehouse" maxlength="4096" spellcheck="false" placeholder="" aria-describedby="warehouse-error"><span class="error" id="warehouse-error"></span></div>
        <div class="field" id="role-field"><label for="role">Role (optional)</label><input id="role" maxlength="4096" spellcheck="false" placeholder="" aria-describedby="role-error"><span class="error" id="role-error"></span></div>
        <div class="field" id="oauthClientId-field"><label for="oauthClientId">OAuth client ID</label><input id="oauthClientId" maxlength="4096" spellcheck="false" placeholder="" aria-describedby="oauthClientId-error"><span class="error" id="oauthClientId-error"></span></div>
        <div class="field" id="oauthAuthorizationUrl-field"><label for="oauthAuthorizationUrl">Authorization URL (optional)</label><input id="oauthAuthorizationUrl" maxlength="4096" spellcheck="false" placeholder="Defaults to the Snowflake account" aria-describedby="oauthAuthorizationUrl-error"><span class="error" id="oauthAuthorizationUrl-error"></span></div>
        <div class="field" id="oauthTokenRequestUrl-field"><label for="oauthTokenRequestUrl">Token URL (optional)</label><input id="oauthTokenRequestUrl" maxlength="4096" spellcheck="false" placeholder="Defaults to the Snowflake account" aria-describedby="oauthTokenRequestUrl-error"><span class="error" id="oauthTokenRequestUrl-error"></span></div>
        <div class="field" id="oauthScope-field"><label for="oauthScope">OAuth scope (optional)</label><input id="oauthScope" maxlength="4096" spellcheck="false" placeholder="Defaults to the selected role" aria-describedby="oauthScope-error"><span class="error" id="oauthScope-error"></span></div>
        <div class="field" id="oracleWalletPath-field"><label for="oracleWalletPath">Oracle wallet directory (optional)</label><input id="oracleWalletPath" maxlength="4096" spellcheck="false" placeholder="Directory containing ewallet.pem" aria-describedby="oracleWalletPath-error"><span class="error" id="oracleWalletPath-error"></span></div>
        <div class="field" id="location-field"><label for="location">BigQuery location</label><input id="location" maxlength="4096" spellcheck="false" placeholder="US or us-east4" aria-describedby="location-error"><span class="error" id="location-error"></span></div>
        <div class="field" id="maximumBytesBilled-field"><label for="maximumBytesBilled">Maximum bytes billed per query</label><input id="maximumBytesBilled" maxlength="4096" spellcheck="false" placeholder="1073741824 (1 GiB)" aria-describedby="maximumBytesBilled-error"><span class="error" id="maximumBytesBilled-error"></span></div>
        <p class="help full" id="auth-help"></p>
      </div></section>
      <section class="section" id="authentication-section"><h2>Authentication</h2><div class="grid">
        <div class="field" id="username-field"><label for="username">Username</label><input id="username" name="username" maxlength="256" required spellcheck="false" autocomplete="off" aria-describedby="username-error"><span class="error" id="username-error"></span></div>
        <div class="field" id="password-field"><label for="password" id="password-label">Password <span class="optional">optional</span></label><div class="password-wrap"><input id="password" name="password" type="password" maxlength="16384" autocomplete="new-password" aria-describedby="password-help password-error"><button type="button" id="show-password" class="reveal" aria-label="Show password" aria-pressed="false">Show</button></div><span class="help" id="password-help">Stored securely in VS Code when you save.</span><span class="error" id="password-error"></span>
        <label class="check clear-password" id="clear-password-row" hidden><input type="checkbox" id="clear-password">Clear saved password</label></div>
      </div></section>
      <section class="section"><h2>Security &amp; access</h2><div class="grid">
        <div class="field" id="tls-field"><label for="tls">TLS / SSL</label><select id="tls" aria-describedby="tls-error"><option value="verify-full">Verify server certificate</option><option value="disable">Disable TLS (local development)</option></select><span class="error" id="tls-error"></span></div>
        <div class="field" id="caPath-field"><label for="caPath">CA certificate path <span class="optional">optional</span></label><input id="caPath" name="caPath" maxlength="4096" spellcheck="false" placeholder="Use system certificate authorities" aria-describedby="caPath-help caPath-error"><span class="help" id="caPath-help">Leave blank to use system defaults.</span><span class="error" id="caPath-error"></span></div>
        <div class="full access"><label class="check"><input type="checkbox" id="agentEnabled" aria-describedby="agent-help agentEnabled-error"><span>Allow Copilot to use this connection</span></label><p class="help" id="agent-help">Copilot can inspect metadata and receive bounded query results.</p><span class="error" id="agentEnabled-error"></span></div>
      </div></section>
    </fieldset>
    <div class="actions"><div id="feedback" class="feedback" role="status" aria-live="polite">Ready to test your connection.</div>
      <div class="buttons"><button type="button" id="test" class="secondary" disabled>Test Connection</button><button type="button" id="cancel-test" class="secondary" hidden>Cancel Test</button><span class="spacer"></span><button type="button" id="close" class="quiet">Cancel</button><button type="submit" id="save" class="primary" disabled>Save Connection</button></div>
    </div>
  </form>
</main><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
