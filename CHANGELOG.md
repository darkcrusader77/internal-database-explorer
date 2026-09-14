# Changelog

## 0.3.0 — Five database clients

- Added SQL Server, Oracle, Snowflake and BigQuery adapters for queries, catalog browsing, previews and native Copilot tools.
- Added engine selection and connection fields: SQL Server/Oracle username/password, Snowflake OAuth and configurable account/identity-provider URLs, and BigQuery Google ADC/project/location/billing limits.
- Preserved window-local selection, results and cancellation; bounded streaming/result-set/API fetching applies to every adapter.
- Added Oracle read-only transactions and LOB omission, BigQuery SELECT dry runs and unique cancellable jobs, and Snowflake per-window OAuth sessions with no shared token cache.
- Added dialect-aware SELECT validation, parameter-style discovery, and SQL Server precision warnings.
- Packaged driver runtime dependencies and their licenses; require VS Code 1.101+ / Node 22 runtime.
- Verified automated driver contracts and real VS Code forms. BigQuery live tests in taskpath passed with verified temporary-dataset cleanup; SQL Server/Oracle/Snowflake live validation remains outstanding.

## 0.2.1 — SQL run controls and bottom-panel results

- Added a labeled Database Explorer run action above SQL documents and a Run SQL status-bar control beside the connection selector.
- Distinguished the toolbar action with a database/play icon and added a toolbar connection selector.
- Bound toolbar and inline commands to their target SQL document, and reopen connection selection if a saved profile was removed.
- Moved query results into a Database Results tab alongside Output, Debug Console, and Terminal, with a compact resizable grid and results retained when switching panel tabs.
- Verified SQL execution from the labeled inline control, bottom-panel result retention, and separate connection selections across VS Code windows.
- Verified a million-row query stops at 1,000 retained rows and wide results stop at the 2 MiB size cap.

## 0.2.0 — Connection editor

- Replaced sequential connection prompts with a single form for adding and editing connections.
- Added Test Connection and Save Connection buttons, inline validation, success/failure feedback, and cancellation of connection tests.
- Kept unsaved tests separate from stored profiles and credentials; preserved saved passwords on edit with explicit replace/clear behavior.
- Preserved per-window test isolation and optimistic profile revision checks across VS Code windows.
- Added end-to-end form checks in a real VS Code window using the local PostgreSQL sample.

## 0.1.0 — PostgreSQL preview

- Added an internal VS Code extension with PostgreSQL profiles, explorer, read-only SQL execution, bounded results, cancellation, session history, and CSV export.
- Added ten native Copilot tools for connection/object discovery and query execution/results/cancellation.
- Isolated clients, query handles, results, and selected connections per extension host.
- Added atomic profile updates with revision conflicts and immutable SecretStorage references.
- Added unit, independent-process profile, PostgreSQL integration, and VS Code extension-host checks.
- Kept SQL Server, Oracle, Snowflake, and BigQuery as remaining Stage 1 adapters. Stage 2 remains deferred.
