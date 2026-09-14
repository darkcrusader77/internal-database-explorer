# Stage 2 — Agentic data engineering

**Status:** Deferred until [Stage 1](STAGE_1_PLAN.md) is complete. These are planned next-stage candidates, not current implementation requirements. Priorities and exact contracts will be finalized after the core extension is usable.

## Objective

Extend the working database client so Copilot can understand transformations, investigate data problems, validate changes, and support development workflows across the five supported engines.

## Proposed next features

| Capability | Proposed tools | Intended behavior |
| --- | --- | --- |
| Object definitions | `get_object_definition` | Retrieve source SQL for views, procedures, and functions when available and permitted. |
| Data profiling | `profile_table`, `profile_columns` | Return null rates, distinct counts, ranges, duplicates, and distributions, with explicit sample scope and approximation details. |
| Data quality | `run_data_checks` | Check uniqueness, required fields, accepted values, referential integrity, and freshness; return structured failures and bounded examples. |
| Schema comparison | `compare_schemas` | Compare environments or saved metadata snapshots for added, removed, or changed fields and constraints. |
| Data reconciliation | `compare_datasets` | Compare source and target counts, aggregates, and key-based differences after loads or refactors. |
| Dependencies and lineage | `get_dependencies`, `get_dependents` | Trace upstream inputs and downstream consumers for impact analysis; identify the source and completeness of dependency evidence. |
| SQL validation | `validate_query` | Validate SQL using available parser or engine facilities, distinguishing syntax checks from successful execution. |
| Plans and cost estimates | `explain_query`, `estimate_query` | Return supported plans, dry-run information, or estimates without implying equivalent capabilities across engines. Any analysis mode that executes SQL must be explicit. |
| Query diagnostics | `get_query_status`, `get_query_history`, `get_query_plan` | Investigate server-side failures, long runtimes, blocking, and execution behavior beyond the local history provided in Stage 1. |
| Business context | `get_object_context`, `search_examples` | Retrieve business definitions, table grain, approved joins, ownership, and vetted SQL examples. |
| Development workspaces | `create_scratch_schema`, `preview_change` | Prepare an isolated development area and review proposed transformations before applying them elsewhere. |

The tool names are proposals. The first priority within Stage 2 is profiling, quality checks, and reconciliation, followed by broader context and integrations.

## Example workflow

Request: “The Oracle-to-Snowflake customer load is missing records. Find where the discrepancy starts.”

1. Inspect the source and destination schemas and transformation definitions.
2. Compare counts by load date or partition.
3. Check key uniqueness and required fields.
4. Compare missing keys within the affected scope.
5. Identify the transformation or load behavior responsible for the difference.
6. Report supporting query IDs, comparisons, and limitations; propose a correction and checks to verify it.

For large tables, start with bounded partitions and aggregates. Comparisons across engines require explicit key mappings and normalization of types, timestamps, nulls, and numeric precision. Do not assume arbitrary engines can execute a direct cross-database join.

## Agent workflow improvements

- **Capability discovery:** expose detailed per-connection support for validation, estimates, transactions, object definitions, and other advanced operations.
- **Result evidence:** include query IDs, connection/environment, timing, sampling, truncation, approximation, and metadata freshness as appropriate.
- **Long-running jobs:** add a consistent job interface for profiling, checks, and comparisons that agents can poll and cancel. Preserve Stage 1 query cancellation and paging.
- **Explicit sessions:** introduce handles for temporary tables and multi-step transactions, with defined ownership, expiry, cleanup, and failure behavior.
- **Reviewable changes:** separate proposed SQL and expected impact from application. Use engine-specific transaction behavior; do not promise universal DDL rollback.
- **Data as context:** database comments, documentation, and returned cell values remain data rather than instructions that authorize further operations.

## Additional client features

- Richer schema-aware SQL autocomplete.
- Editable result grids with explicit key selection and write review.
- Transaction controls where supported.
- Rich execution-plan views.
- Reusable checks, saved metadata snapshots, and comparison reports.

## Optional integrations

### MCP

Expose the shared service through MCP if other agent clients or remote deployment are needed. Evaluate local standard input/output versus Streamable HTTP based on the deployment target. A VS Code extension can register an MCP server definition with `vscode.lm.registerMcpServerDefinitionProvider(...)`.

Native Copilot tools remain the Stage 1 integration. Sharing service code does not automatically share live credentials or sessions with another process; MCP authentication and connection ownership need an explicit design.

### dbt

If the team uses dbt, connect project metadata and supported compile, run, test, and build operations to the workflow. Prefer integrating the existing project tooling over rebuilding a transformation framework.

### Metadata catalogs

If an approved catalog such as DataHub is available, use it for richer ownership, glossary, lineage, and downstream impact context. Database catalog dependencies alone cannot establish complete lineage through external jobs and dashboards.

## Existing products informing this stage

These references are design research, not dependencies or commitments to adopt external services.

| Reference | Relevant pattern |
| --- | --- |
| [dbt MCP](https://github.com/dbt-labs/dbt-mcp) and [dbt overview](https://www.getdbt.com/blog/mcp) | Give agents project context and a compile/run/test feedback loop. |
| [DataHub MCP](https://github.com/datahub-project/datahub/blob/master/docs/features/feature-guides/mcp.md) | Discover metadata and traverse lineage to understand change impact. |
| [Snowflake managed MCP](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp) | Combine semantic context, search, SQL execution, and approved custom operations. |
| [BigQuery MCP](https://docs.cloud.google.com/bigquery/docs/use-bigquery-mcp) | Expose resource discovery, metadata, and execution as agent tools. |
| [SQLMesh table comparisons](https://sqlmesh.readthedocs.io/en/stable/guides/tablediff/) and [change plans](https://sqlmesh.readthedocs.io/en/stable/concepts/plans/) | Validate changes with schema/data differences and reviewable plans, including affected models and backfill scope. |
| [VS Code MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp) | Add portable agent tool access alongside native extension tools. |

## Entry criteria

- Stage 1 works across the agreed authentication environments for all five engines.
- The core Copilot discovery/query workflow is verified.
- Real usage has identified which advanced workflows save the most effort.
- Each selected feature has defined permissions, cost/output limits, and engine support before implementation.
