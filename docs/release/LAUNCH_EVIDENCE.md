| LG-07 | Inventory approved and signed | **Open** | [ORG] | Validated 2026-10-29: 107 stalls, 0 approved/bookable; 98 with draft positions, 9 without (BB-B26–B28, AG ×6). `activate` now refuses DRAFT positions and unresolved count conflicts. Approval requirements: `docs/inventory/README.md`. Open: BB-B 25 vs 28, AG used?, on-site positions. || LG-06 | Email provider live (SPF/DKIM/DMARC) | **Partly** | [ORG] + [INFRA] | Code complete and tested against a local SMTP server (sign-in, delivery and headers, allowlist, one retry on 4xx only, password redaction). STARTTLS is now required on 587/2525 in staging/production, other ports are refused, TLS ≥ 1.2. `mail:check -- --dns` checks SPF/DMARC/DKIM. Still needed: provider and domain chosen (B-06), DNS records, credentials in Vercel, staging test. || LG-04 | Data API cannot reach registration data | **Partly** | [INFRA] | Live check of `ddrremsyzozutyxbxigf` (read-only, 2026-10-29): RLS on for all 10 tables, **but `anon`/`authenticated` still hold SELECT/INSERT/UPDATE/DELETE on all of them**, and `public.rls_auto_enable()` (SECURITY DEFINER) is executable by `anon`. No migration applied (no `schema_migrations`, no `app_auth`/`booking`). `public` matches 0001 exactly, so baseline 0001 is safe. New **0009** revokes function EXECUTE (tested; event-trigger case proven by hand with a superuser in a scratch DB). [INFRA]: grant report, baseline 0001, apply 0002–0009, verify. || LG-01 | Leaked credentials rotated | **Open** | [INFRA] | Re-scanned 2026-10-29 (all branches, all commits): **5 secrets**: 1 Supabase DB password (used with `ddrremsyzozutyxbxigf` **and a second project `wdes…`**), 2 Gmail app passwords, 2 ImageKit private keys, all on `origin/main`. Fingerprints, order and "old credential rejected" checks: `docs/runbooks/credential-rotation.md`. Needs the signed rotation note. |# Launch evidence: Book Your Stall

Status of every launch gate in `docs/STALL_BOOKING_FINAL_SPEC.md` §9.9. **Booking must not open until every gate is "Met" with evidence attached.**
Branch `feature/book-your-stall`; local checkpoints `42a8d58` (P6), and earlier `f433484` (P1–P3), `477b469` (P4), `201e622` (P5); P6 uncommitted at the time of writing.

Legend: **Met** = evidence attached · **Partly** = done locally, staging or human step outstanding · **Open** = not started or blocked.

| Gate | Requirement | Status | Owner | Evidence / what is missing |
|---|---|---|---|---|
| LG-01 | Leaked credentials rotated | **Open** | [INFRA] | Database password, Gmail app password and ImageKit key exposed in public git history (spec §8.1). Needs a signed note with dates and the "old credential rejected" checks. |
| LG-02 | No secrets in the tree; scanning in CI; push protection | **Partly** | [DEV] / [INFRA] | Working tree and every commit's staged content scanned clean with gitleaks 8.21.2 and project rules (rules proven to find all 7 historical leaks). CI job added but **not yet run**; GitHub push protection to be enabled by [INFRA]. |
| LG-03 | Production runs as least-privilege `isf_app` | **Partly** | [INFRA] then [DEV] | `database/roles/isf_app_grants.sql` written and **proven locally** (2026-10-29): the built app ran as a non-owner `isf_app` against a throwaway database with stand-in roles. The whole flow passed (16/16: registration with email code, hold, confirm, ticket, code sign-in, admin approve/disable/enable/cancel/audit) with 0 permission errors. As `isf_app`: deleting registrations, creating or granting admins, changing settings or stall approval, editing the audit log, DDL and TRUNCATE were all refused. Remaining: [INFRA] creates the role in production, runs the script, and switches `DATABASE_URL`. |
| LG-04 | Data API cannot reach registration data | **Partly** | [INFRA] | Migration `0006_public_tables_rls.sql` (RLS on every `public` table; revokes PUBLIC/anon/authenticated) is written and tested locally (`tests/db/public-rls.test.ts`), and `database/verify/002_registration_data_exposure.sql` now also checks RLS on every table. **Not applied to production.** [INFRA] must capture the current grants (B-03), apply 0006 with the runbook, and attach the verify output. |
| LG-05 | Registration fixes deployed | **Partly** | [DEV] | R-01..R-07, R-09..R-14 implemented and tested (REG suite). R-08 (remove runtime DDL) waits for the production schema dump (B-04). Not deployed. |
| LG-06 | Email provider live (SPF/DKIM/DMARC) | **Open** | [ORG] + [INFRA] | Provider and domain not chosen (B-06). Ready: `docs/runbooks/email-provider.md` and `npm run mail:check` (signs in to SMTP without sending; optional single test email; never prints the password). |
| LG-07 | Inventory approved and signed | **Open** | [ORG] | 107 stalls provisional. Ready for the organisers: `docs/inventory/DRAFT_venue_layout_from_pdf.csv` (draft positions from the PDF, nothing approved), previews, and `docs/inventory/README.md`. `cli.mjs activate` turns their approved file into a migration (tested: empty DB, staging upgrade, re-run, refusals). Open decisions: Basketball Ground 25 vs 28, Agricultural Gate area. |
| LG-08 | Decision register approved | **Open** | [ORG] | D-01..D-26 have provisional defaults only. |
| LG-09 | All automated suites green on the release commit | **Partly** | [DEV] | Locally: typecheck, build, unit + database + race tests, browser tests all pass (counts below). CI not yet run on GitHub. |
| LG-10 | Load criteria met **on staging** | **Partly** | [INFRA] + [DEV] | Scenarios LD-01..05 implemented and run **locally** (results below). Staging (B-02) needed for Supavisor/PgBouncer, real network and Vercel. |
| LG-11 | Manual acceptance (desktop, Android, iOS, admin) | **Open** | [ORG] | Screenshots reviewed during development only. |
| LG-12 | Backups/PITR confirmed | **Open** | [INFRA] | B-05. |
| LG-13 | Runbooks | **Met** | [DEV] | `docs/runbooks/`: admin-grants, team-ambiguity, wrong-email-recovery, deploy-migrations (now with the pre-migration grant report and migrations 0006-0008), email-provider; kill switch in spec §9.8. |
| LG-14 | Monitoring and alerts | **Partly** | [INFRA] | `GET /v1/health` (200 ok / 503 unavailable, no details) for an uptime monitor. Still needed: alerts on 5xx rate, `[BOOKING]`/`[UNHANDLED ERROR]`/`[HEALTH]` log lines and DB connections. |
| — | nodemailer advisory (GHSA-8c8m-p3m8-cjg8 and related) | **Partly** | [DEV] | Mitigated in code: only plain single addresses reach the mailer, and registration rejects others. Upgrade to nodemailer ≥ 10.2.1 once that release is two weeks old (on or after 2026-11-05). |

## Local evidence (2026-10-28, Windows dev machine, PostgreSQL 16, Node 22.23)

**Not staging evidence:** everything ran on one machine, with no connection pooler and no network latency.

**Automated suites** (isolated test cluster):
- 222 unit, database, integration and race tests pass (21 files, two consecutive runs). This includes the 12 migration-runner tests, among them the refusal cases.
- 19 Playwright browser tests pass (installed Edge; CI uses bundled Chromium).

**Load: three separate `next start` instances, round-robin, guarded `isf_test_load` database:**

| Scenario | Result |
|---|---|
| LD-02 same stall (100 leaders × 10 rounds) | 5 consecutive runs: **exactly one hold in all 50 rounds**, 0 unexpected responses, 0 5xx, hold p95 346–379 ms; invariants hold |
| LD-03 sell-out (150 teams, 40 stalls) | 40/40 sold, never oversold, 0 server errors in 2,281 requests, hold p95 294 ms, confirm p95 281 ms; invariants hold |
| LD-01 polling (100 leaders, 2 min) | 4,728 requests, 0 errors, p95 106 ms, p99 150 ms |
| LD-04 mixed (100 polling + 50 booking + 2 admins, 2 min) | all thresholds pass, 0 server errors, snapshot p95 58 ms, hold p95 187 ms; invariants hold |
| LD-05 sign-in burst (100 requests in 60 s) | p95 29 ms; exactly 20 accepted, 81 rate-limited, no other status |

**Issues found and fixed during these runs (all in test scripts, not the app):**
- **LD-02** reported 1–2 unexpected `200` responses in some runs. Diagnosis: k6 reuses VU ids across scenarios, so two requests in one round could use the same leader, who then correctly got their own hold back (idempotent 200). Fixed by mapping leaders by in-scenario iteration; 5 subsequent runs were clean.
- **LD-04** showed 144 non-200 polls of 4,800. Same cause: VUs sharing a leader exceeded that session's per-instance polling limit. Fixed by giving every VU its own leader; the rerun had all polls return 200.

## Not yet covered (needs staging, B-02 / B-12)

- RACE-01 and LD runs through Supavisor/PgBouncer transaction pooling with real latency.
- Toxiproxy network faults (RACE-10 variant).
- LD-01 at the full 15 minutes; LD-04 at 5 minutes.
- Connection-pool headroom against the actual Supabase plan.

## Go-live tooling added (2026-10-29)

- `npm run preflight`: checks a target environment's settings against every startup rule plus go-live warnings; prints variable names only.
- `npm run mail:check`: verifies SMTP sign-in without sending; optional single test email.
- `database/reports/pre_migration_grants.sql`: read-only record of who can reach registration data before migrating.
- `database/roles/isf_app_grants.sql`: least-privilege runtime role (proven locally, see LG-03).
- `GET /v1/health`: uptime check.
- Optional Cloudflare Turnstile on registration (`TURNSTILE_SECRET_KEY` + `TURNSTILE_SITE_KEY`, read at runtime); off until both are set; fails closed if Cloudflare is unreachable.
- Registration no longer runs runtime DDL on a database managed by the migration runner (R-08 partial).


## Go-live blocker pass (2026-10-29, uncommitted on top of `42a8d58`)

- Typecheck clean; **324 unit, database, integration and race tests pass** (34 files, one full run, including the new mail, DNS, 0009 and inventory-activation tests); **21/21 Playwright** (installed Edge, desktop + mobile); `next build` OK; committed seed up to date.
- gitleaks 8.21.2 (checksum-verified): working tree clean apart from git-ignored `.next/` build keys and `node_modules` docs; history findings unchanged (credential-rotation runbook).
- Supabase checks were read-only through MCP (`read_only=true`); nothing was applied to the remote project.
