# ISF · Startup Jathara 2026 — Registration & Book Your Stall

Registration portal, team-leader sign-in and stall booking for **ISF · Startup Jathara @ Dandakaranya 2026** (18–20 December 2026, GIET University, Gunupur, Odisha).

> **Status:** `main` is the live registration site. This branch (`feature/book-your-stall`) adds stall booking and a security rebuild and is **not live yet**: it needs the launch steps in [`docs/release/LAUNCH_EVIDENCE.md`](docs/release/LAUNCH_EVIDENCE.md) first. Registration is **paused by default** (see below).

---

## What it does

- **Registration** for two tracks, Startup Leaders and Student Innovators, with teams of 1–5 members, photo upload (ImageKit), and an email confirmation code before anything is stored.
- **Leader sign-in** by one-time email code (`/login`).
- **Book Your Stall** (`/book-your-stall`): a live venue map; holds and bookings are atomic in the database, so two teams can never get the same stall. It's hidden unless `FEATURE_BOOKING_UI=true`.
- **Admin** (`/admin`): operations for organisers (role-granted, see `docs/runbooks/admin-grants.md`).
- **Safety:** same-origin checks, rate limits, bot filters, optional Cloudflare Turnstile, row-level security on every public table, a least-privilege database role (`isf_app`), and TLS-verified database and SMTP connections.

## Registration pause switch

Registration is open **only** when `REGISTRATION_OPEN=true`. If it's unset or has any other value, the form shows a "Registration is paused" notice, and email codes and submissions are refused with `503`. Sign-in, booking and admin are unaffected. See [`docs/runbooks/pause-registration.md`](docs/runbooks/pause-registration.md).

---

## Repository layout

```
database/
  migrations/0001–0009_*.sql   Ordered schema migrations (applied with scripts/migrate.mts)
  roles/isf_app_grants.sql     Least-privilege application role
  verify/                      Post-migration checks (schema, RLS, grants)
docs/
  release/LAUNCH_EVIDENCE.md   Go-live gates, audit findings and test evidence
  runbooks/                    Step-by-step operations (see below)
  inventory/                   Stall inventory process (provisional until organiser approval)
frontend-web/                  Next.js 16 app (UI + API under app/v1)
  app/                         register, login, book-your-stall, admin, v1 API routes
  lib/                         config, db, mail, auth, booking, registration, safety
  scripts/                     preflight, mail-check, migrate, inventory CLI, test DB
  tests/                       unit, db, integration and concurrency suites (Vitest)
  e2e/                         Browser tests (Playwright)
```

---

## Getting started

Requires **Node 22+**.

```bash
cd frontend-web
npm ci
cp .env.example .env.local      # fill in values; never commit real ones
npm run dev                     # http://localhost:3000
```

Every variable is explained in [`frontend-web/.env.example`](frontend-web/.env.example). The app checks its settings at startup and refuses to run with missing or unsafe ones. For a deployed environment, run the preflight first:

```bash
npm run preflight               # prints variable names and problems, never values
npm run mail:check -- --dns     # SMTP login + SPF/DKIM/DMARC for the sender domain
```

## Tests

```bash
npm run typecheck
npm run test:unit
npm run test-db:start           # isolated local PostgreSQL on localhost:54329
npm run test:db                 # needs TEST_DATABASE_URL, see frontend-web/tests/README.md
npm run test:e2e                # Playwright browser tests
npm run build
```

Tests never connect to the production database: its project ID is on a deny-list.

## Database migrations

Migrations are applied with `frontend-web/scripts/migrate.mts` (`status`, `baseline`, `apply --dry-run`, `apply`, `verify`). Follow [`docs/runbooks/deploy-migrations.md`](docs/runbooks/deploy-migrations.md) and always do a dry run first.

## Stall inventory

The stall list is **provisional** until the organisers formally approve the layout and positions. Unapproved stalls can't be booked; the database enforces this. See [`docs/inventory/README.md`](docs/inventory/README.md).

---

## Runbooks

| Runbook | Purpose |
|---|---|
| [pause-registration](docs/runbooks/pause-registration.md) | Pause or reopen registration |
| [credential-rotation](docs/runbooks/credential-rotation.md) | Rotate database, SMTP and ImageKit credentials |
| [email-provider](docs/runbooks/email-provider.md) | Set up the sending provider and sender DNS |
| [deploy-migrations](docs/runbooks/deploy-migrations.md) | Apply database migrations safely |
| [admin-grants](docs/runbooks/admin-grants.md) | Grant or revoke organiser admin access |
| [team-ambiguity](docs/runbooks/team-ambiguity.md) | Resolve duplicate or unclear team records |
| [wrong-email-recovery](docs/runbooks/wrong-email-recovery.md) | Fix a registration made with the wrong email |

## Security

- Never commit `.env*` files (other than `.env.example`), `.mcp.json`, or database dumps; they're gitignored.
- Secret scanning uses gitleaks with the project's `.gitleaks.toml`.
- Credentials that were committed in the past must be rotated; see the credential-rotation runbook.
