# Development and verification

## Development

Use Node.js 22 or newer for tooling and VS Code 1.101 or newer. The bundle targets Node.js 22 syntax for the extension runtime. Development has been verified on macOS arm64 with Node.js 23, VS Code 1.137, and PostgreSQL 14.

```sh
npm ci
npm run build
npm test
```

Press F5 in this repository to launch the extension in an Extension Development Host. The provided launch task builds first.

## Checks

| Command | Coverage |
| --- | --- |
| `npm run check` | Strict TypeScript checking. |
| `npm test` | Query restrictions, tool validation, trust/opt-in, result isolation, independent-process profile writes, conflict detection, retained history, and CSV handling. |
| `npm run test:integration` | Creates a disposable local PostgreSQL cluster and verifies all metadata tools, exact numeric values, parameters, million-row and byte-limit truncation, read-only enforcement, cancellation, timeout, and tool routing. |
| `npm run test:host` | Launches an isolated VS Code test host and checks activation, commands, native language-model tool registration, and explorer refresh. |
| `npm run test:form` | Uses Playwright to exercise connection forms, SQL run controls, bottom-panel results, and per-window selection against the local sample database; records screenshots in `artifacts/`. Requires `npm run sample:start` first. |
| `npm run package` | Builds and produces `internal-database-explorer-0.3.0.vsix`. |

Integration tests require `initdb` and `pg_ctl` on PATH and a non-root account. They initialize their own temporary cluster, bind to loopback on an ephemeral port, and stop/remove it in cleanup. They do not connect to an existing database or use work credentials. A forcibly killed test process can require manual cleanup of its own `internal-db-integration-*` temporary directory and server.

The host test uses an installed macOS VS Code app if available; otherwise the VS Code test runner downloads a test runtime. It uses temporary user-data and extension directories so your regular VS Code profiles are not changed. It verifies tool registration, not a paid/authenticated Copilot conversation.

The form test defaults to the installed macOS VS Code executable; set `VSCODE_EXECUTABLE` to use another compatible local VS Code executable. It tests missing-field validation, incorrect-password feedback, successful tests without saving, saving a profile, and reopening it with the saved password kept private. Its profiles and credentials are created in a temporary VS Code user-data directory. It does not modify the sample records or regular VS Code profiles.

The opt-in `npx tsx scripts/testBigQueryLive.ts PROJECT LOCATION` creates a uniquely named temporary dataset and sample table, checks live BigQuery metadata/query limits, then deletes and verifies deletion in a finally block. Run only against a project explicitly authorized for a cloud test. The recorded taskpath run passed; `artifacts/bigquery-live-test.json` records the result.

## Source layout

- `src/core/`: contracts, query/session service, profile repository, tool router, SQL restrictions, and formatting.
- `src/adapters/postgres.ts`: PostgreSQL driver and catalog queries.
- `src/ui/`: connection form, explorer tree, and results webview.
- `src/core/connectionDraft.ts`: validation, unsaved connection testing, and explicit credential/profile saves.
- `src/tools.ts`: native VS Code language-model tool registration and invocation messages.
- `src/extension.ts`: command registration and window lifecycle.
- `media/`: webview assets. Database values use `textContent`, with a restrictive content security policy.
- `test/` and `scripts/`: unit, process-isolation, database integration, and extension-host checks.

## Behavior and remaining validation

The release accepts single SELECT queries and read-only CTEs in the selected engine’s supported syntax. See [connection setup and validation limits](CONNECTIONS.md). A parser rejects unsupported or mutating statement forms; PostgreSQL and Oracle read-only transactions add server-side enforcement. SQL Server and Snowflake need a least-privilege role; BigQuery also validates SELECT with a dry run. Use a least-privilege database role: SQL parsing and read-only transactions are not a sandbox for arbitrary privileged functions or external side effects.

UI and Copilot use the same service. Parameter arrays use PostgreSQL `$1`, `$2`, etc. through the Copilot tool; a dedicated manual parameter-entry UI remains to be built. Query parameters are not saved in session history.

Result paging navigates retained rows; it does not keep a server cursor open indefinitely or fetch beyond the configured query cap. PostgreSQL, Oracle and Snowflake exact numeric values stay as strings. BigQuery retains REST numeric strings. SQL Server decimal/money conversion can lose precision and adds a result warning; CAST to varchar in SQL for exact values. Database error details are mapped to fixed user-facing messages because raw error text may contain query literals or sensitive data.

The preview's profile storage and query state are described in [SESSION_MODEL.md](SESSION_MODEL.md). It has no telemetry or query HTTP service of its own. Snowflake browser OAuth temporarily opens a driver-managed loopback callback; driver telemetry and authentication behavior follow the vendor SDKs. Copilot tool results are intentionally shared with the configured Copilot model when the user enables access for a connection.

Before internal rollout, validate actual authentication/SSO needs, TLS certificates, supported OS/remote hosts, minimum VS Code version, and a live Copilot discovery/query workflow. Review and set the internal publisher identity. The source is MIT licensed. The npm `private` flag prevents accidental npm publication; it does not restrict use or modification. The build does not publish to a marketplace.

Production drivers remain external to the extension bundle so their runtime assets are preserved. VSCE packages the production dependency graph; dev dependencies and local sample credentials are excluded. `THIRD_PARTY_NOTICES.txt` covers packaged production dependencies.
