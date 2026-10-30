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
| 0010 | Aadhaar/PAN consent columns; admin `password_hash` with a format check |
| 0011 | Catch-up for a database built from `schema.sql`/`reset_database.sql` (the live project): `teams_guard`, seven 0001 indexes, the 0009 and 0006 lockdowns (including default privileges), the 0010 check. Idempotent: a no-op on a database built from the migrations |
| 0012 | Deletes the reset script's 15 starter/test stalls (`source_ref = 'starter'`, inserted as `approved`) and returns its `master` zones to `provisional` unless they hold a really approved stall. Refuses if any starter stall has a reservation or audit entry. No-op elsewhere |

No stall becomes bookable from these. Venue stalls are activated later by a separate, organiser-approved migration (`docs/inventory/README.md`), and booking opens only when an operator sets `booking_enabled`, `opens_at`, `closes_at` and `eligible_tracks`.

## State of the connected project `ddrremsyzozutyxbxigf` (read-only check, 2026-10-30)

Supersedes the 2026-10-29 check: on 2026-10-29 the database was **dropped and rebuilt** from the pushed `reset_database.sql` (all registrations lost). Checked read-only through the Supabase MCP server; nothing was changed.

| Migration | State | Evidence |
|---|---|---|
| 0001 | Partly | All tables exist; 7 indexes missing (added by 0011); extra unique indexes from the collaborator's code (kept) |
| 0002 | Present | Schemas exist; no `anon` usage |
| 0003 | Partly | All `app_auth` tables identical; **`booking.teams_guard` function and trigger missing** (0011) |
| 0004 | Present | Booking tables identical; guard functions identical apart from CRLF line endings |
| 0005 | Present (same effect) | Settings row written by `schema-init`; no registrations to back-fill |
| 0006 | Partly | RLS on and no API grants on all 10 tables, but **Supabase's default privileges still give `anon`/`authenticated` full rights on every new `public` table** (0011) |
| 0007, 0008 | Present | Columns, table, indexes and the approval default as in the migrations |
| 0009 | **Absent** | `public.rls_auto_enable()` (SECURITY DEFINER) executable by `anon`/`authenticated` (0011) |
| 0010 | Partly | Columns present; `password_hash` format check missing (0011; the one stored hash conforms) |

There is **no `public.schema_migrations` table**. A plain `apply` would fail at 0003 (`relation "admin_users" already exists`) after recording 0001 and 0002, so it must not be run there.

**Rehearsed locally on 2026-10-30** on a replica built from the pushed reset script (all 22 table fingerprints identical to the live project, same RLS and default-privilege state): `baseline --version 0010`, `apply` (0011 and 0012 only), `verify` passed (195 checks), a second `apply` did nothing, and the result matches a database built from the migrations apart from the kept unique indexes. A malformed stored password hash made 0011 fail and roll back completely. 0012 was rehearsed on the live booking data (stall and zone fingerprints identical): without it, a real activation "succeeds" but keeps 14 starter positions and the extra `AG-A05`; with it, activation loads the approved positions.

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
# First run on a database whose schema was created without this runner:
#   live project ddrremsyzozutyxbxigf (built from reset_database.sql): --version 0010, then apply runs 0011 and 0012
#   a database that has only the registration tables: --version 0001
node scripts/migrate.mts baseline --target staging --version 0010 --dry-run
node scripts/migrate.mts baseline --target staging --version 0010
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
