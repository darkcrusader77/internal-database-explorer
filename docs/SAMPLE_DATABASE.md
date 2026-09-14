# Local PostgreSQL sample

Run `npm run sample:start` from this repository to create/start the persistent sample database. It uses the locally installed PostgreSQL binaries (`initdb` and `pg_ctl`). Repeating the command preserves existing data.

The server listens only on `127.0.0.1`, normally on port `55432`. On first creation, an occupied port causes selection of another free port, which is saved for subsequent starts. This is a dedicated cluster under `.local-postgres/`; it does not modify an existing PostgreSQL installation's databases.

## Connection

- Name: `Local Sample PostgreSQL`
- Host: `127.0.0.1`
- Port: shown by `npm run sample:info`
- Database: `explorer_sample`
- Username: `explorer_reader`
- Password: shown by `npm run sample:info`
- TLS: **Disable TLS**
- CA path: leave blank
- Copilot: choose **Allow Copilot** to test the tools against this synthetic data.

The generated password is stored in `.local-postgres/connection.json`, which is ignored by Git and excluded from the VSIX. The role has SELECT privileges on the sample schemas and defaults to read-only transactions. It cannot create objects or write to sample tables.

## Data

| Schema | Objects |
| --- | --- |
| `crm` | `regions` (4 rows), `customers` (200 rows) |
| `sales` | `products` (30 rows), `orders` (1,500 rows), `order_items` (4,500 rows), `payments` (1,200 rows) |
| `analytics` | `order_summary`, `monthly_sales`, and `customer_summary` views |

The fixtures include foreign keys, indexes, comments, nulls, booleans, exact decimal amounts, JSON, and multiline text. All records are synthetic, with customer email addresses under `example.test`.

Open [sample-queries.sql](../examples/sample-queries.sql) and run one selected statement at a time. To test Copilot, ask: “List schemas and tables in Local Sample PostgreSQL, then show monthly revenue by region.”

For multiple-window testing, use the same details in both VS Code windows, start a slow query in each, and cancel one. Each window should keep its own history and results.

## Lifecycle

```sh
npm run sample:start
npm run sample:info
npm run sample:stop
```

The server continues running after the setup command exits. It is not registered as a startup service; run `sample:start` again after a reboot. `sample:stop` preserves all data.
