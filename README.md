# Internal Database Explorer for VS Code

An internally maintained VS Code extension for SQL Server, Oracle, PostgreSQL, Snowflake, and BigQuery, with tools that GitHub Copilot agents can call directly.

The project will recreate the core database browsing and query workflows we need from Database Client. It will use our own implementation and approved database drivers.

**Status:** Version 0.3.0 implements adapters and connection forms for all five database types. PostgreSQL and BigQuery have live integration coverage; SQL Server, Oracle and Snowflake require validation against your work endpoints. Stage 2 remains deferred.

## Try the preview

1. Run `npm ci` and `npm run build`.
2. Open this folder in VS Code and press **F5** to launch an Extension Development Host.
3. Open **Database Explorer** in the Activity Bar and choose **Add Connection**.
4. Fill out the connection form: all fields, TLS settings, and Copilot access are shown together. Click **Test Connection** to verify the entered settings without saving. Success or failure appears on the form.
5. Click **Save Connection**, then expand the tree to browse schemas, tables, views, and columns. Use **Edit Connection** to reopen the same form; a blank password keeps the existing secret unless **Clear saved password** is selected.
6. Choose **New SQL Query**, or use **Preview Table**. Click **Database Explorer: Run SQL · connection name** above the SQL, or **Run SQL** beside **DB Explorer** in the status bar. The keyboard shortcut is **Cmd+Alt+Enter** on macOS or **Ctrl+Alt+Enter** on Windows/Linux.

If another database extension is installed, its play buttons use its own saved connections. Our commands are prefixed **Database Explorer:**, and our editor toolbar uses a database-with-play icon. Use **Change connection** above the SQL or **DB Explorer** in the status bar to select this extension's connection.

**Database Results** opens automatically in the bottom panel beside Output, Debug Console, Terminal, and Ports. Resize it by dragging the panel divider. Switching tabs preserves the current result; query history can reopen earlier results from this window.

See [connection setup](docs/CONNECTIONS.md) for Snowflake OAuth, Oracle TLS, and BigQuery `gcloud` authentication.

For Copilot, enable the extension's tools in the chat tool picker. Try: “Use the database tools to list connections, then list schemas and tables in my development database.” Queries return a query handle that Copilot can poll with `db_get_query_results`.

Need sample data? Run `npm run sample:start` to create a local database with synthetic customers, orders, payments, and reporting views. See [sample database setup](docs/SAMPLE_DATABASE.md) for connection details and lifecycle commands.

To create an installable VSIX, run `npm run package`. Install through **Extensions → … → Install from VSIX** using your organization's approved route. The placeholder publisher is `internal-tools` and should be changed to your organization's identifier before distribution.

## Implemented in this preview

- Five database adapters, engine-specific connection profiles, password/OAuth credential storage, verified TLS/custom CA configuration, connection testing, and per-connection Copilot opt-in.
- A connection editor with all fields visible together, inline validation/test feedback, cancellable tests, and separate testing and saving.
- Schema/table/view/column browsing, object search, table descriptions, and SQL previews.
- Single read-only SELECT/CTE execution with a results grid, cancellation, timeouts, bounded result pages, session history, and CSV export.
- All ten native Copilot tools from the Stage 1 plan, including schema/table/column discovery. Bound parameters are supported through `run_query`.
- Independent query sessions per VS Code window, concurrent profile update protection, and no shared query results or cancellation handles.

## Current limits

- Live endpoint validation remains for SQL Server, Oracle, and Snowflake. BigQuery passed the temporary-dataset test in taskpath. SQL Server/Oracle use username/password, Snowflake uses OAuth with configurable URLs, and BigQuery uses Google ADC. See [connection setup and authentication](docs/CONNECTIONS.md).
- No writes, editable results, multi-statement execution, explicit transaction sessions, or manual parameter-entry UI. Some PostgreSQL syntax is unsupported by the read-query parser.
- Queries retain at most 1,000 rows and approximately 2 MiB of normalized row data, shortening values beyond 16,384 characters. The size limit applies to retained results; a driver can still receive a large individual value before it is shortened.
- Each window allows four active database operations, retains results for ten completed queries, and keeps up to fifty completed history entries in memory. Closing the window clears both. Query parameters are not retained in history and must be supplied again when rerunning parameterized SQL.
- Query results sent to Copilot are additionally bounded to 64 KiB per tool response. Smaller pages or narrower queries may be required.
- Metadata browsing uses the configured database/service/project. Create a separate profile for another context. Fully qualified SQL can access other objects permitted to the database role; profiles are not a permission boundary.
- Authentication/TLS support needs verification against your actual work environment. Local PostgreSQL 14 integration and VS Code extension-host tests have passed; a live Copilot conversation against a work database has not been tested.

See [development and verification](docs/DEVELOPMENT.md) and [multiple users and windows](docs/SESSION_MODEL.md).

## Roadmap

1. [Stage 1 — Core extension and Copilot tools](docs/STAGE_1_PLAN.md): connections, database discovery, SQL execution, results, and native Copilot integration.
2. [Stage 2 — Agentic data engineering](docs/STAGE_2_PLAN.md): profiling, validation, reconciliation, lineage, diagnostics, and additional integrations after Stage 1.

Stage 1 is the planned implementation scope. Stage 2 is deferred and will be prioritized after the core extension works.

## Design direction

- TypeScript VS Code extension with a shared connection and query service.
- A database adapter for each of the five supported engines.
- The UI and Copilot tools use the same service, connections, and query lifecycle.
- Native VS Code Language Model Tools API for initial Copilot integration.
- Optional MCP support in Stage 2 for other agent clients or remote services.

Plans and implementation status recorded September 14, 2026. Open implementation questions and source references are included in the stage documents.

## License

This project is licensed under the [MIT License](LICENSE.txt), copyright 2026 Vincent Martino. You may use it commercially, modify it, and maintain a private company fork without publishing your changes. Include the copyright and license notice with copies or substantial portions of the software.

Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). Your organization's software approval process still applies.
