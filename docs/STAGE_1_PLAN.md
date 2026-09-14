# Stage 1 — Core extension and Copilot tools

**Status:** In progress. Version 0.3.0 implements the shared foundation and all five adapters; Stage 1 is not complete.

## Implementation progress

- [x] Extension scaffold, shared service, profile storage, and explorer.
- [x] PostgreSQL metadata, read-only queries, bounded results, cancellation, history, and CSV export.
- [x] Ten native Copilot tools and structured input validation.
- [x] Window-local query state, scoped handles, and concurrent profile revision checks.
- [x] Local PostgreSQL integration tests and VS Code extension-host registration checks.
- [ ] Validate authentication, TLS, and live Copilot interaction in the work environment.
- [x] Implement SQL Server, Oracle, Snowflake, and BigQuery adapters with automated driver-contract tests.
- [x] Verify BigQuery live in taskpath with temporary data and confirmed cleanup.
- [ ] Verify SQL Server, Oracle and Snowflake against live endpoints.
- [ ] Complete remaining Stage 1 behavior, including manual parameter entry and decisions about manual writes/multiple result sets.
- [ ] Validate supported operating systems/remote environments and finalize internal deployment identity.

See [README](../README.md) for the runnable preview and its limits, [development notes](DEVELOPMENT.md) for verification, and [session model](SESSION_MODEL.md) for the multiple-window design.

## Objective

Build an internal VS Code database extension that supports everyday database exploration and querying across SQL Server, Oracle, PostgreSQL, Snowflake, and BigQuery. GitHub Copilot agents in VS Code must be able to discover database objects and execute queries through the extension.

This stage covers the core database client workflow. The advanced agentic data engineering features are deferred to [Stage 2](STAGE_2_PLAN.md).

## Supported databases

| Engine | Proposed driver | Implementation considerations |
| --- | --- | --- |
| SQL Server | `mssql` | Select the underlying driver and authentication support based on the work environment. |
| Oracle | `oracledb` | Prefer Thin mode where compatible; assess whether required authentication or database features need Thick mode and Oracle Client libraries. |
| PostgreSQL | `pg` | Support the required connection, TLS, and authentication configuration. |
| Snowflake | `snowflake-sdk` | Model account, role, warehouse, database, and schema; confirm the required SSO, OAuth, or other authentication flow. |
| BigQuery | `@google-cloud/bigquery` | Model project, dataset, location, and query jobs; confirm the approved Google authentication flow. |

Driver choices are proposed, subject to compatibility and internal dependency requirements. All five engines are Stage 1 targets, implemented incrementally through one shared adapter contract.

## User-facing features

### Connections

- Create, edit, test, connect, disconnect, and remove saved connection profiles.
- Show the selected connection and database context clearly in the editor and results.
- Keep connection metadata separate from credentials; use VS Code SecretStorage for extension-managed secrets.
- Support each engine's required TLS and authentication settings without placing credentials in source-controlled configuration.

### Database explorer

- Browse accessible databases or projects, schemas or datasets, tables, and views.
- Inspect columns, data types, nullability, and defaults.
- Show primary keys, foreign keys, indexes, and comments when available through the adapter and current permissions.
- Search objects by name and refresh metadata.
- Load large catalogs incrementally with filtering and pagination.
- Generate a dialect-appropriate table preview query and open it in a SQL editor.

### SQL execution and results

- Run selected SQL or the current SQL document against an explicit connection.
- Support parameter binding appropriate to each engine.
- Display results in a paginated grid with column metadata, execution status, timing, and row counts where known.
- Handle multiple result sets where supported and distinguish rows fetched from total rows when the total is unknown.
- Support cancellation, timeouts, and bounded result retrieval.
- Keep query history and allow queries to be reopened and rerun; keep saved SQL in ordinary files.
- Export results as CSV, making the exported scope clear when only part of a result has been fetched.
- Surface actionable, credential-free errors in the UI.

## Copilot integration

Use VS Code's native Language Model Tools API first. These are callable tool interfaces, not HTTP endpoints. A separate web server is not required for Copilot agents running inside VS Code.

Implementation will declare tools under `contributes.languageModelTools` in `package.json`, including descriptions and JSON input schemas, then register handlers with `vscode.lm.registerTool(...)`. Tool implementations will use `prepareInvocation` for clear invocation/confirmation messages and `invoke` to call the shared service and return results.

The initial integration targets Copilot agents inside VS Code. A GitHub-hosted agent or another external client would require its own integration and connectivity; that is not provided automatically by registering native tools.

### Planned tools

Names below are proposed operation names; registered names may receive an extension-specific prefix.

| Tool | Purpose |
| --- | --- |
| `list_connections` | List configured connections, engine types, status, and permitted basic operations without credentials. |
| `list_databases` | List accessible databases or projects where that hierarchy applies. |
| `list_schemas` | List schemas within a database, or datasets within a BigQuery project. |
| `list_tables` | List tables and views within the selected scope. |
| `list_columns` | Return column names, types, nullability, and defaults without the full table description. |
| `describe_table` | Return columns plus available keys, indexes, relationships, and comments. |
| `search_objects` | Find objects matching a name within a permitted connection and scope. |
| `run_query` | Execute SQL with optional bound parameters against an explicit connection. |
| `get_query_results` | Retrieve a bounded page of results for an existing execution. |
| `cancel_query` | Request cancellation of an active execution. |

Except for `list_connections`, tools take an explicit `connectionId`, plus the relevant object identifiers or query handle. Catalog operations support filtering and pagination where needed. Results identify their connection and object scope and report truncation or unsupported metadata explicitly.

`list_columns` intentionally overlaps with `describe_table`: the smaller operation avoids unnecessary context when the agent only needs field information.

Example workflow: **list connections → list schemas → list tables → describe table → run query → retrieve results**.

Queries started by Copilot should appear in the extension's results view and history just like manually initiated queries. The connection service manages credentials; credentials are never tool arguments or tool outputs.

## Architecture

```text
Explorer / SQL editor / Results grid     Copilot native tools
                  \                       /
                   Shared application service
                  Connections / Metadata / Queries
                                |
                         Database adapters
          SQL Server / Oracle / PostgreSQL / Snowflake / BigQuery
```

- Keep UI code, Copilot handlers, and database drivers separate.
- Share execution behavior and restrictions between UI commands and agent tools.
- Let adapters handle identifier quoting, parameter binding, metadata discovery, result paging, and cancellation differences.
- Preserve engine-specific information instead of implying all engines have identical semantics.
- Keep the shared service independent enough to support a later MCP interface without duplicating database logic.

## Execution boundaries

- Default agent database access to read-only permissions. Database privileges are the enforcement boundary; checking for a leading `SELECT` is insufficient.
- Treat agent writes as a separately enabled capability, with clear target and SQL review. Broader mutation workflows belong to Stage 2.
- Apply timeouts, row/output limits, and engine-specific controls. BigQuery query limits should include maximum bytes billed where applicable; a returned-row limit does not cap scanned data.
- Bound the result data returned to Copilot and keep credentials out of errors, logs, and history. Define history retention and result-sharing settings during implementation.
- Respect VS Code workspace trust and the organization's extension and Copilot policies.

## Implementation sequence

1. Establish the extension scaffold, adapter contract, profile storage, and basic explorer.
2. Implement one complete workflow using the primary work database: actual authentication, browse metadata, run SQL, display results, and invoke the same operations through Copilot.
3. Add the remaining four adapters and verify their engine-specific behavior.
4. Complete history, CSV export, pagination, cancellation, error handling, and internal packaging.

PostgreSQL is the first implemented engine because a local server was available for integration testing. The primary work database and authentication method still need to be confirmed.

## Completion criteria

- Each of the five engines can connect using an agreed authentication method and expose its accessible catalog.
- Users can execute SQL, inspect bounded results, and export the intended result scope.
- Copilot can discover schemas, tables, and columns and execute a query without being given credentials.
- UI and Copilot executions share connection selection, query history, results, and execution restrictions.
- Cancellation, errors, and unsupported operations are reported accurately.
- Relevant adapter and tool contract checks pass, along with end-to-end checks against authorized test databases. Untested authentication modes or environments are documented.
- An internally distributable VSIX and setup instructions are available through the organization's approved installation route.

## Questions to resolve during implementation

- Which database should be implemented first, and which server versions are in use?
- What authentication methods, certificates, proxies, and network routes are required for each engine?
- Is the work environment Windows, macOS, remote SSH, WSL, or a development container?
- What VS Code versions, internal extensions, and database driver dependencies are permitted?
- Should the first release allow manual writes, and what agent write policy is required?
- What schemas and result data may be exposed to Copilot?

## Deferred scope

Stage 2 holds profiling, data checks, schema/data comparisons, lineage, object source definitions, advanced SQL validation and execution plans, business context, scratch environments, explicit session/transaction workflows, editable results, richer SQL autocomplete, and optional MCP or dbt/catalog integrations.

## References

- [VS Code Language Model Tools API](https://code.visualstudio.com/api/extension-guides/ai/tools)
- [VS Code AI extensibility options](https://code.visualstudio.com/api/extension-guides/ai/ai-extensibility-overview)
- [Enterprise extension management](https://code.visualstudio.com/docs/enterprise/extensions)
- [SQL Server driver](https://github.com/tediousjs/node-mssql)
- [Oracle driver initialization](https://node-oracledb.readthedocs.io/en/latest/user_guide/initialization.html)
- [PostgreSQL parameterized queries](https://node-postgres.com/features/queries)
- [Snowflake authentication](https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-authenticate)
- [BigQuery cost controls](https://docs.cloud.google.com/bigquery/docs/best-practices-costs)
