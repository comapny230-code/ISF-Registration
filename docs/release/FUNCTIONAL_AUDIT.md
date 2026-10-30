# Functional audit — 2026-10-30

Scope: functional behaviour of the registration, team, admin and stall-booking features on branch
`feature/book-your-stall` (after merging `origin/main` 5b42e2e). Local disposable databases only;
no production data, migrations, deploys or real emails. The dedicated security audit is a separate
phase and was not performed here.

**Not a production-readiness sign-off.** Everything below was verified locally. Launch still depends
on the manual actions at the end (and the security phase).

## Baseline and final results

| Check | Baseline (4024b5a) | Final |
|---|---|---|
| `npm run typecheck` | OK | OK |
| Vitest (`npm test`, unit + db projects) | 343 / 343 | **365 / 365** (127 unit, 238 db/integration), 0 skipped |
| `next build` (the only deployable app) | OK | OK |
| Playwright (desktop + mobile projects) | 21 / 21 | **25 / 25** |
| Lint | not configured (no ESLint in the project) | not configured |
| Secret scan (gitleaks, project rules) | clean | clean |

Baseline was green, but the collaborator's admin features had **no functional tests at all**; the
new tests below failed 10 of 15 on first run, exposing the defects in the next section.

## Defects found and fixed

| # | Sev. | Feature | Root cause | Fix | Regression test |
|---|---|---|---|---|---|
| F-01 | **High** | Admin: delete registration | Every registration has a `booking.teams` row whose FKs to the account are `ON DELETE RESTRICT`; deleting the account always failed (500) | `lib/registration/admin.ts` `deleteRegistration`: one transaction removes team, members, leader row, startup and memberships, then only accounts nothing else uses; refuses (409 `REGISTRATION_HAS_BOOKING_HISTORY`) when the team has reservations or audit entries | ADM-MGMT "deletes … completely", "keeps a member account that also leads another team", "refuses … booking history" |
| F-02 | **High** | Admin: delete registration / delete stall (UI) | Client sent `DELETE` without a body, so no JSON content type; the same-origin check rejected it (403) | `lib/booking/admin-client.ts` sends `{}` as JSON | E2E "ADM-MGMT: an organiser deletes a registration and retires a stall" |
| F-03 | **High** | Admin: delete stall | Deleted held/released/expired reservations (history; fails once audit rows reference them) and silently deleted another team's **live** hold | `retireStall` in `lib/booking/admin.ts`: same lock order as disable; 409 while booked or held; expired hold marked expired; history kept; audited `inventory_changed` | ADM-MGMT "retires a free stall, keeps reservation history …" |
| F-04 | **High** | Admin: edit registration | Phone validated as bare 10 digits while registrations store E.164 (`+91…`): **saving any real registration unchanged failed**, and edits bypassed the duplicate-phone rule | Shared `lib/registration/phone.ts` (moved from the API route); edit normalises and checks one leader per phone (409) | ADM-MGMT "edits a registration …" (incl. unchanged `+91` save), "rejects invalid edits … 409" |
| F-05 | Medium | Admin: edit registration | Only the leader row changed; account (`user_accounts`) name/team/phone and student member `team_name` went stale; no transaction; no checks on domain/city/state/length | `editRegistration` updates leader row, account, booking team and member team names in one transaction with form-equivalent validation | ADM-MGMT "edits …", "rejects invalid edits" |
| F-06 | Medium | Admin: registrations list | Student-track team members were never loaded (always empty); expired holds shown as live | Members of both tracks keyed by registration; only confirmed or unexpired holds | ADM-MGMT "lists both tracks with their members …" |
| F-07 | **High** | Admin: dashboard statistics | With no stalls loaded, the endpoint **invented 98 available stalls**; student members not counted | Real counts (zero is zero); members of both tracks; zones from data | ADM-MGMT "reports real numbers …" |
| F-08 | Medium | Admin: edit stall | Changing a code always hit the immutable-identity trigger (500); bad numbers became 500s (check constraints) | Code change → 400 `STALL_CODE_IMMUTABLE`; validated measurements; audited | ADM-MGMT "edits dimensions …" |
| F-09 | Medium | Admin: add stall | Only zones PG/BB accepted (AG exists in the inventory); invalid numbers silently became 0; position defaulted to 0,0; code prefix could differ from zone; check-then-insert race → 500 | Any existing zone; prefix must match; position required; ranges validated; `on conflict` → 409; audited | ADM-MGMT "adds a stall to any existing zone …" |
| F-10 | Medium | Admin console: add-stall form | Zone list hard-coded to PG/BB | Zones from the live snapshot | build + layout E2E (form renders) |
| F-11 | **High** | Booking page, zero-stall state | With zones but no stalls (the live state after 0012) the page showed area tabs and an empty map with "0 free" and no explanation | "The stall layout has not been published yet" whenever there are no stalls | E2E "ZERO-STALLS …" (visitor and signed-in leader) |
| F-12 | Medium | Registration | PAN format checked only in the browser; a script could store any string (and defeat PAN uniqueness with spacing) | Server strips spaces/dashes and checks `AAAAA9999A`; blank still allowed | REG-RULES "rejects a malformed PAN …", "one registration per PAN …" |
| F-13 | Low | Registration form | A dropped connection showed the browser's raw "Failed to fetch" | Clear message; details stay filled in; resubmitting works once | E2E "if the network drops on submit …" |
| F-14 | Low | Error pages | Raw `error.message` shown to visitors | Generic text plus the error reference | build |
| T-01 | (test) | Test helpers | Helpers gave every leader phone `'1'`, colliding with the new one-leader-per-phone index | Unique phones in `tests/support/booking.ts` and `e2e/support.ts`; booking-list test asserts the real phone | full suite |

## Feature coverage matrix

PASS = exercised end to end with assertions on the response **and** the database / page.

| Area | Feature | Status | Evidence |
|---|---|---|---|
| Registration | Page load, fields, client validation | PASS | E2E REG-E2E (3), layout E2E |
| Registration | Server validation (required fields, Aadhaar check digit, PAN format, team name length, categories) | PASS | registration.test, REG-RULES |
| Registration | Email code: issue, wrong, expired, attempts, bound to browser | PASS | registration-verification.test, otp-lockout.test |
| Registration | Duplicates: email (both tracks, member→leader), Aadhaar, PAN, primary phone (any format) | PASS | registration.test, registration-handoff.test, REG-RULES |
| Registration | Consent required and recorded (time, address) | PASS | REG-RULES |
| Registration | Members: required, duplicate emails, leader's own email, existing accounts unchanged | PASS | registration.test REG-02/03 |
| Registration | Atomic write / rollback on failure, sanitised errors | PASS | registration.test REG-04/05 |
| Registration | Pause switch (`REGISTRATION_OPEN`) | PASS | registration-pause.test |
| Registration | Network failure and retry; refresh mid-form | PASS / NOT SUPPORTED | E2E network drop; a refresh loses unsent form data (no draft saving; improvement) |
| Registration | Confirmation email; failure leaves one saved registration | PASS | registration.test R-10, MAIL-FAIL |
| Teams | Team created with registration, bound to leader (teams_guard) | PASS | registration.test R-09, migration 0011 rehearsal |
| Teams | Edit team details (admin) | PASS | ADM-MGMT |
| Teams | Add/remove members after registration | NOT SUPPORTED | no feature exists (organisers edit leader details only) |
| Teams | Approval / rejection | PASS | admin-api.test, admin E2E |
| Leader sign-in | Email code, sessions, logout, rotation, limits | PASS | auth.test, booking E2E-01 (public map + sign-in dialog) |
| Booking | Public map (organiser setting), list/map views, mobile list | PASS | booking-api.test, booking E2E, mobile E2E |
| Booking | Zero stalls, unapproved/disabled stalls not bookable | PASS | ZERO-STALLS E2E, booking-schema.test, BK005 trigger |
| Booking | Hold, confirm, release, expiry, one stall per team, one team per stall | PASS | booking-api.test, booking E2E-02..05 |
| Booking | Concurrency (double booking, parallel confirms, admin races) | PASS | booking-races.test, admin-races.test |
| Booking | Window open/close, eligibility, approval-required mode | PASS | booking-api.test, REG-E2E approval |
| Booking | Ticket PDF, contact popup | PASS | ticket-pdf.test, leader-only-and-ticket.test, REG-E2E |
| Admin | Sign-in by email code and by password; disabled admin refused; step-up | PASS | auth.test, ADM-MGMT, admin E2E |
| Admin | Password reset by code (uniform reply), change password | PASS | ADM-MGMT |
| Admin | Admin accounts: list, add (full admins only), CLI bootstrap | PASS | ADM-MGMT, ADMIN-CLI |
| Admin | Dashboard statistics | PASS | ADM-MGMT (after F-07) |
| Admin | Registrations list / edit / delete | PASS | ADM-MGMT, admin E2E |
| Admin | Registrations search and filter | NOT TESTED | client-side filter only (no server paging); list returns all rows |
| Admin | Stalls add / edit / retire / enable / disable | PASS | ADM-MGMT, admin-api.test, admin E2E |
| Admin | Bookings list (paged), cancel with reason | PASS | admin-api.test, admin E2E |
| Admin | Audit log | PASS | admin-api.test, admin E2E |
| Email | Templates (escaping), OTP mails, SMTP retry/TLS, delivery failure | PASS | mail-smtp.test, auth-config-and-html.test, MAIL-FAIL |
| Email | Real provider delivery and sender DNS | BLOCKED | needs the provider account and DNS (docs/runbooks/email-provider.md) |
| Uploads | ImageKit photo/report upload | BLOCKED | tests run with uploads off (data URLs); needs an ImageKit test key |
| Captcha | Turnstile | PASS (logic) / BLOCKED (live) | captcha.test; live check needs Turnstile keys |
| Platform | Health endpoint, security headers, error pages | PASS | health.test, security-headers E2E |
| Platform | Phone (390 px) and tablet (820 px) layouts, all pages | PASS | LAYOUT E2E (no horizontal scroll, no script errors) |
| Inventory | CSV validate / seed / preview / activate (refuses DRAFT/CONFLICT) | PASS | inventory.test, inventory-seed/activation tests, 0012 rehearsal |
| Database | Migrations 0001–0012, verify queries, runner | PASS | migrate-runner.test, schema tests, reset-guard, starter cleanup |
| Background | Hold expiry (lazy, on read/write); no cron jobs exist | PASS | booking-api.test expiry cases |

## Database report

Inspected from migrations 0001–0012 and the live read-only fingerprint (see `docs/runbooks/deploy-migrations.md`).

- **Schemas/tables (22):** `public` registration tables (user_accounts, role_grants, edition_access,
  startups, startup_memberships, startup_team_leaders, startup_team_members, student_innovators,
  student_team_members, event_editions); `app_auth` (admin_users, admin_grants, login_challenges,
  registration_email_challenges, sessions, rate_limits); `booking` (settings, zones, stalls,
  reservations, audit_events, teams); plus `schema_migrations`.
- **Triggers:** `reservations_guard`, `stalls_guard` (identity immutable, legal inventory
  transitions, no retire with live claim), `audit_events_append_only`, `teams_guard` (missing on the
  live project; added by 0011).
- **Key constraints:** one live claim per stall and per team (partial unique indexes); reservation
  state machine (single CHECK); generated `bookable`; restrict FKs from booking to identity rows
  (why F-01 needed a dedicated delete path).
- **Migration tests:** runner applies 0001–0012 once with checksums, is idempotent, verify passes
  (195 checks) and fails when a guard is missing; 0011/0012 rehearsed on a replica of the live schema.
- **Remaining schema uncertainty:** the live project has unique phone/PAN/Aadhaar indexes created at
  runtime by `ensureTables()` that no migration defines (test databases also get them at runtime).
  Recommended: a migration that owns them, after confirming live data has no duplicates.

## Manual actions (owner / organisers / providers)

1. **Production first (from earlier findings):** clear the published `admin@giet.edu` password and
   revoke its sessions (B-11); restore registrations from a Supabase backup if one exists (B-01);
   switch booking off until the real inventory is approved.
2. **Approved stall inventory:** organisers approve the layout (positions, BB run count conflict)
   and record it; then `scripts/inventory/cli.mjs activate` → migration.
3. **Email provider:** account, SMTP credentials and SPF/DKIM/DMARC (`npm run mail:check -- --dns`).
4. **ImageKit and Turnstile keys** for a staging check of uploads and the human check.
5. **Vercel environment** per `npm run preflight` before deploying this branch (the site refuses to
   start without the signing keys and TLS CA).
6. **Decision — registration delete under `isf_app`:** the least-privilege role has no DELETE on
   registration tables by design, so the console's delete works only as the owner role. Decide
   (security phase) whether to grant it.
7. **Decision — admin-added stalls are `approved` immediately** (collaborator design). Confirm this
   is acceptable versus requiring the inventory approval process.
8. **Decision — a team member's address cannot register as a leader** (collaborator rule).

## Remaining blockers vs improvements

**Launch blockers (outside local testing):** manual actions 1–5 above, migrations 0011–0012 on
production with approval, and the separate security phase.

**Improvements (not blockers):** save registration drafts across a refresh; server-side search and
paging for the registrations list (all rows load at once); audit entries for registration edits and
deletes (the audit action list has no registration action); a migration that owns the runtime
unique indexes; an ESLint setup.
