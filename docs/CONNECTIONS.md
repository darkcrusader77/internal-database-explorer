# Connecting to the five database types

Use **Database Explorer: Add Connection** and choose the database type. The same form shows the relevant fields, Test Connection, and Save Connection. Tests use the entered values without saving. Passwords, Snowflake client secrets, and access tokens go into VS Code SecretStorage only when saved.

| Database | Authentication | Required connection settings |
| --- | --- | --- |
| PostgreSQL | Username/password | Host, port (5432), database, username |
| SQL Server | SQL username/password | Host, TCP port (1433), database, username |
| Oracle | Username/password, Thin driver | Host, port (1521), service name, username |
| Snowflake | OAuth browser authorization code or an existing OAuth access token | Account HTTPS endpoint, database; browser OAuth also needs your client ID |
| BigQuery | Google Application Default Credentials (ADC) | Google Cloud project ID, dataset location, maximum bytes billed |

The active connection, query history, results and cancellation handles belong to the current VS Code window. Saved profiles are shared by windows using the same OS user and VS Code profile. Credentials for BigQuery come from the host's Google authentication environment; the extension does not store a Google username or password.

## SQL Server

Use SQL authentication, not Windows integrated authentication. Enter the server hostname and actual TCP port; named instances need their resolved port. TLS certificate verification is on by default. Supply a CA certificate path for a private certificate authority, or disable TLS only for a development server configured without it.

Use a database login with SELECT-only permissions. `readOnlyIntent` is a routing hint, not a permission boundary. This release rejects non-SELECT statements in the application, but SQL parsing cannot sandbox privileged functions or external side effects.

Decimal, numeric and money values use the driver's JavaScript number conversion, which can lose precision. The grid and Copilot results display a warning for these columns. Select `CAST(amount AS varchar(100)) AS amount` when exact values are required.

## Oracle

Enter a **service name**, such as `FREEPDB1`, rather than a SID, TNS alias or full connect descriptor. This release uses the Oracle Thin driver and does not require Instant Client. Verified TLS uses TCPS and hostname/certificate checks; an optional wallet directory can contain `ewallet.pem`. Encrypted-wallet passwords, Thick mode and integrated authentication are not implemented.

Oracle validates statement type before execution and runs SELECTs in a read-only transaction. Large objects and nested cursors are closed without loading their contents; select a bounded scalar expression such as `DBMS_LOB.SUBSTR(...)` to preview a LOB. NUMBER values are fetched as strings to preserve precision.

## Snowflake OAuth

Enter your Snowflake account endpoint, for example `https://organization-account.snowflakecomputing.com`. A configured private endpoint is also accepted. The `https://app.snowflake.com/...` worksheet URL is not a database endpoint. Warehouse, default schema and role are optional fields; use the correct read-only role and a warehouse you can use.

**Browser authorization code:** enter the OAuth client ID from your company's integration, and its client secret if required. The authorization URL, token URL and scopes can be supplied for an external identity provider; leaving the URLs blank uses the account's Snowflake OAuth endpoints. A compatible client registration is required. The SDK uses an available loopback callback port, avoiding a fixed port shared by VS Code windows. In remote development, the browser and callback need to reach the extension host.

**Existing OAuth access token:** select this method and paste the token into the credential field. Update it when it expires. The token is not written to the profile JSON or sent to Copilot.

Authentication uses the [Snowflake Node.js OAuth support](https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-authenticate). Authenticated query sessions are reused only within their owning extension host, one operation per session; up to four idle sessions are retained. Disconnect closes that window's sessions. Draft tests create and close their own session. Shared SDK credential caching is disabled, so another window does not inherit the active Snowflake session. A query can require browser authentication again after testing or disconnecting.

## BigQuery and gcloud

On the machine running the extension host, run:

```sh
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

`gcloud auth login` alone does not create the Application Default Credentials used by client libraries. Existing ADC from `GOOGLE_APPLICATION_CREDENTIALS` or an attached workload identity is also supported. See [Google's BigQuery authentication guide](https://docs.cloud.google.com/bigquery/docs/authentication).

Enter your project ID and the location of the datasets you want to query, such as `US`, `EU`, or `us-east4`. The explorer treats datasets as schemas and scopes discovery to that location. A default dataset is optional. Use separate profiles for projects or locations you work with independently. You need permission to create query jobs in the project and read the selected datasets.

The form defaults **maximum bytes billed per query** to 1,073,741,824 bytes (1 GiB). This bounds scan billing separately from the result-memory limit. A dry run verifies SELECT before job submission. Each query gets a unique job ID; polling disables automatic pagination, and cancellation addresses only that job. Cloud-side cancellation is best effort and work already performed can still incur charges.

## Query and metadata behavior

All five adapters support schema/dataset discovery, tables/views, columns, table descriptions, search, preview SQL, query results and cancellation through the same UI and native Copilot tools. Descriptions include columns and available constraints; SQL Server and Oracle also list indexes. Snowflake/BigQuery report index metadata as unsupported. Oracle database discovery lists the configured service; BigQuery lists the configured project.

Metadata visibility follows the authenticated principal's privileges. Snowflake/SQL Server/BigQuery use their native metadata views, and Oracle uses the `ALL_*` dictionary views. Some catalog operations can require additional metadata privileges. SQL Server requires a version supporting OFFSET/FETCH; Oracle requires Thin-compatible Oracle Database 12.1 or newer.

| Engine | Positional parameter syntax |
| --- | --- |
| PostgreSQL | `$1`, `$2` |
| SQL Server | `@p1`, `@p2` |
| Oracle | `:1`, `:2` |
| Snowflake / BigQuery | `?`, `?` |

Parameters are available through the Copilot query tool. BigQuery null parameters need explicit types, which this first form of the tool does not expose; use `NULL` or `CAST(NULL AS type)` in SQL. Advanced dialect syntax can be rejected by the SELECT validator; unsupported syntax is not automatically allowed through.

The 1,000-row cap, approximately 2 MiB retained-data cap, cell limit, query deadlines and per-window four-operation limit remain in place. The grid renders 100 retained rows per page. SQL Server streams rows, Oracle uses a result set, Snowflake uses streaming with a bounded range, and BigQuery fetches one small API page at a time. These are retained-data limits, not a hard process-memory sandbox: SDK buffers and unusually large individual rows can temporarily use more memory.

## Validation status

PostgreSQL has live local integration coverage. BigQuery was tested live in the authorized `taskpath` project using ADC: connection, all six catalog operations, bound parameters, exact NUMERIC values, and truncation of a 10,000-row query at 1,000 retained rows passed. Temporary datasets/tables were deleted and deletion verified. The new adapters have automated driver-contract tests for configuration, metadata plans, result limits, resource cleanup and cancellation, plus real VS Code form and window-isolation tests. Their SDKs load from the packaged runtime. Live authentication, actual catalog SQL and queries against SQL Server, Oracle and Snowflake endpoints still need environment validation; no credentials or endpoints for those three services were provided.
