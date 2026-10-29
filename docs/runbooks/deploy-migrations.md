# Runbook: apply database migrations (staging, then production)

**Who:** an authorised infrastructure administrator ([INFRA]). Developers never hold production credentials.
**Tool:** `frontend-web/scripts/migrate.mts` (Node 22+). It never reads `DATABASE_URL`.

## Prerequisites

1. **Backups:** confirm backups or point-in-time recovery are enabled for the target project (B-05).
2. **Credentials:** use the schema-owner connection string over a **direct or session-mode** connection (port 5432), **not** the transaction pooler (6543).
3. **CA certificate:** download the project's CA certificate (Supabase dashboard → Database settings → SSL).
4. **Production schema check (first time only):** compare a read-only schema dump with `database/schema.sql` (B-04) before baselining. Done for `ddrremsyzozutyxbxigf` on 2026-10-29 (see below); repeat it if registrations' tables change before you migrate.
5. **Grant report (every first run on a project):** save the output of the read-only `database/reports/pre_migration_grants.sql`. It records who can reach the registration data now, so migration 0006's effect is visible and reversible.
6. **Email works on the target** (`docs/runbooks/email-provider.md`): from migration 0008 on, registration needs an emailed code.

## What the migrations do

| Migration | Effect |
|---|---|
| 0001 | Registration tables (production already has them: **baseline**, do not run) |
| 0002, 0003 | `app_auth` and `booking` schemas, sign-in, sessions, admin accounts (no Data API access) |
| 0004, 0005 | Booking tables and rules; settings row with **booking switched off** |
| 0006 | Row-level security on every `public` table; removes access for `anon`, `authenticated` and `PUBLIC` (closes LG-04). The app, as table owner, is unaffected |
| 0007 | Sign-in codes bound to the requesting browser |
| 0008 | Registration email codes; **organiser approval no longer required** (owner decision) |
| 0009 | Removes EXECUTE on every `public` function from `PUBLIC`/`anon`/`authenticated`, so nothing is callable at `/rest/v1/rpc/…` (the live project's `rls_auto_enable()` is). Triggers and event triggers keep firing |

No stall becomes bookable from these. Venue stalls are activated later by a separate, organiser-approved migration (`docs/inventory/README.md`), and booking opens only when an operator sets `booking_enabled`, `opens_at`, `closes_at` and `eligible_tracks`.

## State of the connected project `ddrremsyzozutyxbxigf` (read-only check, 2026-10-29)

Checked through the Supabase MCP server in **read-only** mode (`supabase_read_only_user`), PostgreSQL 17.11. Nothing was changed. **Treat this project as production**: it holds registration rows.

| Check | Result | What it means |
|---|---|---|
| Migration runner table `public.schema_migrations` | **absent**; Supabase's own migration list is empty | No migration has been applied with the runner. 0002–0009 are all pending |
| Schemas `app_auth`, `booking` | **absent** | Sign-in, sessions, admin accounts and booking do not exist yet. Book Your Stall cannot work against this project until 0002–0009 are applied |
| `public` schema vs. migration 0001 | **identical**: 184 columns/defaults, constraints and indexes match a scratch database built from 0001 (same hash) | `baseline --version 0001` is safe; this also settles B-04 for the `public` tables |
| Row-level security | **on** for all 10 `public` tables, no policies (enabled by the project's `ensure_rls` event trigger) | The Data API returns no rows today |
| Table grants | **`anon` and `authenticated` hold SELECT, INSERT, UPDATE, DELETE on all 10 tables** | Only RLS protects Aadhaar/PAN data. A single permissive policy, or RLS being switched off, would expose it. **0006 removes these grants** |
| Functions | `public.rls_auto_enable()` is SECURITY DEFINER and executable by `anon`/`authenticated` (Supabase advisor lints 0028/0029) | An event-trigger function cannot be called directly with useful effect, but **0009 closes it** |
| Role `isf_app` | **absent** | LG-03: [INFRA] creates it after the migrations |
| Supabase security advisor | 10 × "RLS enabled, no policy" (INFO, intended), 2 × the function warnings above | After 0006 + 0009, only the INFO items remain |

## Environment (set in your shell for this session only; never commit)

```bash
export APP_ENV=staging                      # or production
export MIGRATION_DATABASE_URL='postgresql://<owner>:<password>@<host>:5432/postgres?sslmode=require'
export MIGRATION_CA_CERT="$(cat prod-ca-2021.crt)"
export MIGRATION_OPERATOR='<your name>'
export PRODUCTION_DB_DENYLIST='<production project ref>'   # staging only
```

## Steps

```bash
cd frontend-web
node scripts/migrate.mts status   --target staging
# First run on a database that already has the registration tables (created before this runner existed):
node scripts/migrate.mts baseline --target staging --version 0001
node scripts/migrate.mts apply    --target staging --dry-run
node scripts/migrate.mts apply    --target staging
node scripts/migrate.mts verify   --target staging
```

For production, add `--confirm-production <database hostname>` to every command, and run only after staging passed the same steps and the launch gates in `docs/release/LAUNCH_EVIDENCE.md`.

## Rules

- **Never edit an applied migration.** The runner stops if an applied file's checksum changes; write a new migration instead.
- **`002_registration_data_exposure.sql` must pass after 0006.** It fails if any `public` table lacks row-level security or if `anon`/`authenticated` can still read or write registration data (LG-04).
- **Least-privilege runtime role (B-08):** after [INFRA] creates `isf_app`, run `database/roles/isf_app_grants.sql` as the owner, then switch the app's `DATABASE_URL` to `isf_app`. Re-run the script after any later migration that adds tables.
- **Rollback is by kill switch and redeploy, never by dropping booking data:** set `booking.settings.booking_enabled = false`, then use Vercel instant rollback (spec §2.7, §9.8).
- Record each run (who, when, target, output) in the organisers' change log.
