# Tests

| Project | Command | Needs a database |
|---|---|---|
| `unit` | `npm run test:unit` | No |
| `db` (database + integration) | `npm run test:db` | Yes: an isolated **local** test cluster |
| both | `npm test` | Yes |

## Local test database

Tests never use `DATABASE_URL`, and they abort if it is set. They connect only to a disposable cluster that passes the fail-closed guard in `lib/safety/test-database-guard.ts`:

- host `localhost` (or a single-label CI service name listed in `TEST_DB_ALLOWED_HOSTS`)
- role `isf_test`
- database `isf_test` or `isf_test_<suffix>`
- server `cluster_name = 'isf-test'`
- marker row in `isf_test_guard.marker`
- no non-`@example.test` addresses in `user_accounts`

Start the cluster. This needs PostgreSQL binaries on `PATH`, or set `PG_BIN`; Docker is not required:

```bash
npm run test-db:start          # creates <repo>/.pgdata/isf-test (gitignored), localhost:54329
```

Then run the tests with the URL it prints. It must be supplied explicitly; there is no default:

```bash
# bash
TEST_DATABASE_URL=postgresql://isf_test:isf_test@localhost:54329/isf_test npm test
```

```powershell
# PowerShell
$env:TEST_DATABASE_URL = "postgresql://isf_test:isf_test@localhost:54329/isf_test"; npm test
```

`npm run test-db:stop` stops the cluster. Delete `<repo>/.pgdata/` to reset it completely.

How a run works:
1. The global setup builds `isf_test_template` from `database/migrations/*.sql`.
2. Each test file gets a fresh clone (`isf_test_w<N>`).
3. The app's own pool connects to that clone through the same guard (`APP_ENV=test` reads only `TEST_DATABASE_URL`).

Test data must use `@example.test` email addresses.
