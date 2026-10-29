# Load tests (k6)

Scenarios from `docs/STALL_BOOKING_FINAL_SPEC.md` §9.7. Each file encodes its pass criteria as k6 thresholds, so a run exits non-zero when a criterion is missed.

| File | Scenario | Pass criteria |
|---|---|---|
| `ld01-polling.js` | 100 leaders polling live status every 2.5 s (default 15 min) | p95 < 300 ms, p99 < 800 ms, errors < 0.1 % |
| `ld02-same-stall.js` | 100 leaders request the **same** stall at once, 10 rounds | exactly one hold per round, every other response a 409, no 5xx, p95 < 1.5 s |
| `ld03-sellout.js` | more teams than stalls race to hold and confirm until sold out | bookings ≤ stalls, ≥ 90 % sold, 5xx < 0.5 %, then invariants |
| `ld04-mixed.js` | 100 polling + 50 booking + 2 admins (default 5 min) | LD-01 thresholds, writes p95 < 1.5 s, no 5xx, then invariants |
| `ld05-otp.js` | 100 sign-in code requests in 60 s from one address (no accounts, so no email is sent) | p95 < 500 ms, only 202/429, the per-address limit engages |

**Never run these against production.** The fixture seeder and invariant checker refuse `APP_ENV=production` and any database on `PRODUCTION_DB_DENYLIST`.

## 1. Prepare the target

**Staging** (a separate Supabase project with Vercel Preview or staging; [INFRA]):

1. Apply migrations with `scripts/migrate.mts` (see `docs/runbooks/deploy-migrations.md`).
2. Create the staging marker once:
   ```sql
   create schema isf_staging_guard;
   create table isf_staging_guard.marker (key text primary key, value text not null);
   insert into isf_staging_guard.marker values ('isf-staging-db', 'ISF-STAGING-DATABASE-v1');
   ```
3. Set `MAIL_TRANSPORT=log` on the staging deployment for LD-05, or use addresses with no account (the default).

**Local** (indicative only; everything shares one machine):

1. Create a guarded `isf_test_*` database with the marker and run `node scripts/migrate.mts apply --target test` against it.
2. `npm run build`, then start one or more `next start` instances with `APP_ENV=test`, `NODE_ENV=test`, `TEST_DATABASE_URL=<that database>` and the usual test settings.

## 2. Seed fixtures (synthetic `@example.test` leaders, approved teams, sessions, an `LD` stall zone)

```bash
export APP_ENV=staging              # or test
export LOAD_DATABASE_URL='postgresql://...'      # never DATABASE_URL
export LOAD_CA_CERT="$(cat ca.crt)"              # staging only
export PRODUCTION_DB_DENYLIST='<production project ref>'
node scripts/load/seed-fixtures.mts --leaders 160 --stalls 40 --admins 2 --out .load/fixtures.json
```

`.load/` is gitignored; the file contains session tokens. Seed **at least as many leaders as virtual users**; every VU gets its own leader. On `APP_ENV=test` the seeder clears booking state first; on staging it never deletes anything.

## 3. Run

```bash
export FIXTURES=.load/fixtures.json
export BASE_URLS=https://<staging-host>        # comma-separated for several instances
export ORIGIN=https://<staging-host>           # must equal APP_ORIGIN (or an APP_EXTRA_ORIGINS entry)
k6 run load/ld02-same-stall.js
node scripts/load/check-invariants.mts         # after every booking scenario
```

Reseed before each booking scenario (holds from one run block the next). Keep the k6 summary output (`--summary-export=<file>.json`) as launch evidence (LG-10).

## Interpreting results

- k6's `http_req_failed` counts **expected** 409 responses (stall already taken) as failures in the contention scenarios. Judge those runs by the custom metrics and thresholds (`holds_created`, `bookings`, `server_errors`), not by `http_req_failed`.
- Watch database connections during staging runs: `select count(*) from pg_stat_activity where usename = 'isf_app'`.
