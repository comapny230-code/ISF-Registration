# Startup Jathara 2026 — Book Your Stall: Final Pre-Implementation Specification

| | |
|---|---|
| Status | **Draft for review.** Implementation is not authorised. |
| Date | 2026-10-28 |
| Repository state inspected | Local `main` at `39f6bb9`, **3 commits behind** `origin/main` (`2a8f73c`). Those commits change only `frontend-web/app/register/page.tsx` (+9 lines, printing contact). Untracked: `docs/` only. |
| Companion documents | [`STALL_INVENTORY_PROVISIONAL.md`](STALL_INVENTORY_PROVISIONAL.md), [`stall_inventory_provisional.csv`](stall_inventory_provisional.csv) |
| Conventions | "MUST" means a launch requirement. **[ORG]** = event-organiser decision. **[INFRA]** = authorised infrastructure administrator action. **[DEV]** = developer. "Provisional default" = a technical default used until an [ORG] decision is recorded. It is never treated as approved. |

---

## 0. Resolution log: issues in the previous plan and how they are fixed

| # | Issue in the previous plan | Resolution in this spec | Section |
|---|---|---|---|
| I-01 | The `(edition_id, team_id)` partial unique index referenced a column that `stall_reservations` didn't have | `booking.reservations.edition_id NOT NULL`, with **composite foreign keys** `(stall_id, edition_id)` → stalls and `(team_id, edition_id)` → teams, so a reservation can't mix editions. The live-claim indexes are on `stall_id` and `team_id` (both already edition-scoped). | §2.4 |
| I-02 | The circular `stalls.booking_id` ↔ `stall_bookings.stall_id` design | Replaced by one append-only `booking.reservations` table. Confirmation is a single-row `held→confirmed` update; there's no second table, no FK ordering and no partial commit. | §2.4, §4 |
| I-03 | Admins granted through the `role_grants` CHECK. Registration upserts `user_accounts` by email, so registering with an admin's email would have changed that account. | Admins live in **`app_auth.admin_users`**, separate from registration. Grants are in `app_auth.admin_grants`, which the runtime role can only SELECT. | §2.3, §3.6 |
| I-04 | A hold retry rotated the hold token, invalidating a valid token on another device | The token is **derived deterministically** (HMAC of hold ID, team ID and expiry) and can be recovered from any device of the same leader via `GET /v1/booking/me`. Retries return the same token. | §4.6 |
| I-05 | `now()` / `statement_timestamp()` are fixed before lock waits | Every operation reads `clock_timestamp()` **after** acquiring all locks (`decided_at`). A **DB trigger backstop** also rejects `held→confirmed` when `clock_timestamp() ≥ expires_at`. | §4.2, §2.4 |
| I-06 | Admin disable locked the stall before the team, breaking the global lock order | Read the live claim without a lock, lock team → stall → reservation, re-validate, and retry if the claim changed. | §4.3, §4.8 |
| I-07 | The ETag was based on audit-log ID, but expiries produce no writes | No ETag in v1. Responses are `private, no-store` with a full computed snapshot, plus `asOf` so clients can order responses. Any future ETag MUST hash the post-expiry body. | §4.10 |
| I-08 | I claimed Vercel can't serve WebSockets | **Wrong.** Vercel WebSockets are GA on all plans (they need Fluid compute; Next.js needs `upgradeWebSocket()` from `@vercel/functions` ≥ 3.10.0). Re-evaluated. | §4.10 |
| I-09 | The test guard required empty tables before writes | Replaced with an explicit test credential, a host allowlist, a `cluster_name` marker, a sentinel table, and a fixture-email-domain check. Works with a populated test DB. | §9.4 |
| I-10 | Unknown COMMIT outcome was undefined | Commit-phase failures are detected, the idempotent operation is re-run once, and if the outcome is still unknown the response is `503 OUTCOME_UNKNOWN` with recovery via `GET /v1/booking/me`. | §4.4 |
| I-11 | Approval required teams to exist before leaders log in | `booking.teams` rows are created by a backfill migration, at registration, and lazily at resolution, all with `INSERT … ON CONFLICT DO NOTHING`. | §2.3, §6 |
| I-12 | Polling rate limits written to the DB on every poll | DB-backed limits only for OTP and admin. Polling uses a Vercel WAF rule (if available on the plan) plus an in-instance soft limit. | §5.9 |
| I-13 | Migrations through the transaction pooler | The runner uses a **session-mode or direct** connection (session advisory lock). The runtime uses the transaction pooler. | §2.7 |
| I-14 | Test cleanup via TRUNCATE conflicts with append-only triggers | One database per test worker, cloned from a migrated template. Nothing is truncated. | §9.4 |
| I-15 | `bookable` was undefined relative to approval and disable | `bookable` is a generated column: `inventory_status='approved' AND admin_status='active'`. | §2.4 |
| I-16 | Delete policy undefined | All booking FKs are `ON DELETE RESTRICT`. Reservations and audit events can't be deleted (trigger). `user_accounts` rows referenced by bookings can't be deleted. | §2.5 |
| I-17 | Whether confirmation re-checks the window, approval and kill switch was ambiguous | Defined: confirm re-checks `booking_enabled`, team approval and stall bookability, but **not** `closes_at`. A hold taken before close can be confirmed until it expires. | §4.6 |
| I-18 | Re-holding the same stall after it expired was undefined | Per-(team, stall) cooldown plus a per-team hourly cap on new holds, both enforced under the team lock using DB time. | §4.5 |
| I-19 | Session expiring during a hold | The hold belongs to the team, not the session. The UI requires at least 15 minutes of session left before holding, and re-login keeps the hold. | §3.4, §5 |
| I-20 | Migration ownership and RLS: the app as table owner bypasses RLS | The runtime switches to a non-owner `isf_app` role with explicit grants and RLS policies. Migrations run as the owner. | §2.6 |
| I-21 | Same-team ON CONFLICT team insert waits before the "first" lock | Allowed: it waits only on the *same* team's key, which is consistent with team-first ordering. | §4.3 |
| I-22 | The project-specific `resolveDatabaseUrl()` rewriting (`route.ts:11-43`) | Removed. `DATABASE_URL` must be correct as given and is validated at startup. | §8 |
| I-23 | Characterisation tests planned against unchanged `route.ts`, whose fallback connects to **production** when `DATABASE_URL` is unset | Fallback removal is a separate PR that must merge before any test imports `route.ts` | §11 P1 |
| I-24 | The test guard forbade `*_PROD*` variables while config required `PRODUCTION_DB_DENYLIST`; `DATABASE_URL` was both "unset" and "injected" in test | An explicit list of forbidden variables; in test the app reads only `TEST_DATABASE_URL` | §8.4, §9.4 |
| I-25 | Hold checked eligibility before the idempotent same-stall retry, so a retry after close couldn't recover the hold | The team's own claim is evaluated before eligibility | §4.5 |
| I-26 | Registration could still update an existing account that had been registered as a member | Registration never updates existing `user_accounts` rows | §6.1 R-02 |

---

## 1. Executive summary and architecture

**Goal:** a `/book-your-stall` page on `register.startupjathara.com` (this repository, Next.js 16.4 App Router + Supabase Postgres through postgres.js). It lets each eligible, authenticated **team leader** hold one stall for 5 minutes and confirm it. All rules are enforced by Postgres.

**Key decisions:**

1. **Single source of truth:** `booking.reservations`, one row per hold. It becomes the booking on confirmation. Partial unique indexes enforce one live claim per stall and per team, without depending on time.
2. **Time:** only the database clock (`clock_timestamp()`, read after locks). Application server clocks are never used for decisions.
3. **Concurrency:** READ COMMITTED, explicit `SELECT … FOR UPDATE` in one global lock order (team → stalls ascending → reservations ascending), short transactions with `lock_timeout`, and whole-transaction retry for deadlock or timeout. A trigger acts as a backstop.
4. **Expiry is lazy.** Expired holds stay `held` in storage until a later locked transaction marks them `expired`. Readers compute the effective state from `expires_at`. No cleanup job is needed.
5. **Identity:** email one-time codes to the email on the leader record. Opaque server-side sessions in `__Host-` cookies. Teams resolved only from `startup_team_leaders` / `student_innovators` rows for edition 2026.
6. **Live status:** authenticated polling of a full computed snapshot every 2.5 s, `no-store`, ordered by `asOf`. Push (Supabase Realtime or Vercel WebSockets) is an optional later "refresh now" hint only.
7. **Isolation:** new schemas `app_auth` and `booking` that the Data API doesn't expose; a least-privilege `isf_app` runtime role; RLS on existing `public` tables.
8. **Safe rollout:** code ships dark (`FEATURE_BOOKING_UI=false`, `booking.settings.booking_enabled=false`). Inventory stays `provisional` (`bookable=false`) until organisers sign off.

```
Browser (map, countdown) ──HTTPS──▶ Next.js route handlers on Vercel (stateless, N instances)
        ▲  poll 2.5s (no-store)              │ postgres.js, prepare:false, max ≤5/instance
        └────────────────────────────────────┤ role isf_app via Supavisor transaction mode (6543)
                                             ▼
                          Postgres: public.* (registration, RLS on)
                                    app_auth.* (sessions, OTP, admins)
                                    booking.*  (teams, stalls, reservations, audit)
Mail: provider SMTP relay (prod) │ Mailpit (local/CI) │ log adapter (unit tests)
Migrations: operator/CI as table owner over session-mode or direct connection
```

---

## 2. Database schema and migration order

The DDL below is a **specification**. It hasn't been executed: no Postgres was run in this phase. Phase 3 MUST execute it against the test Postgres before merging (§9 SCH-00).

### 2.1 Existing tables used read-only by booking

`public.user_accounts(id, email, status)`, `public.startup_team_leaders(id, user_id, edition_id, team_name, full_name, email, mobile)`, `public.student_innovators(…same…)`, `public.event_editions(id)`. Booking code MUST select explicit columns and never touch `aadhar_number` or `pan_number`.

### 2.2 Schemas

```sql
create schema app_auth;   -- NOT in Supabase "exposed schemas"
create schema booking;    -- NOT in Supabase "exposed schemas"
revoke all on schema app_auth, booking from public;
revoke all on schema app_auth, booking from anon, authenticated, service_role;  -- Supabase roles
grant usage on schema app_auth, booking to isf_app;
```

### 2.3 Identity and auth (`0004_identity_and_auth.sql`)

```sql
create table app_auth.admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  display_name  text not null check (length(btrim(display_name)) between 1 and 200),
  status        text not null default 'active' check (status in ('active','disabled')),
  created_at    timestamptz not null default now(),
  created_by    text not null check (length(btrim(created_by)) > 0),   -- operator name from runbook
  disabled_at   timestamptz,
  check ((status = 'disabled') = (disabled_at is not null))
);

create table app_auth.admin_grants (
  id            bigint generated always as identity primary key,
  admin_user_id uuid not null references app_auth.admin_users(id) on delete restrict,
  permission    text not null check (permission in ('booking.cancel','inventory.manage','teams.manage','reports.view')),
  granted_at    timestamptz not null default now(),
  granted_by    text not null,
  revoked_at    timestamptz,
  revoked_by    text,
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index admin_grants_active_uq on app_auth.admin_grants (admin_user_id, permission) where revoked_at is null;

create table app_auth.login_challenges (
  id            uuid primary key default gen_random_uuid(),
  audience      text not null check (audience in ('leader','admin')),
  email         text not null check (email = lower(btrim(email))),
  user_id       uuid references public.user_accounts(id) on delete cascade,
  admin_user_id uuid references app_auth.admin_users(id) on delete cascade,
  code_mac      bytea not null,
  created_at    timestamptz not null default clock_timestamp(),
  expires_at    timestamptz not null,
  attempts      smallint not null default 0 check (attempts between 0 and 5),
  consumed_at   timestamptz,
  superseded_at timestamptz,
  check ((audience = 'leader' and user_id is not null and admin_user_id is null)
      or (audience = 'admin'  and admin_user_id is not null and user_id is null)),
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index login_challenges_active_ix on app_auth.login_challenges (audience, email, created_at desc)
  where consumed_at is null and superseded_at is null;

create table app_auth.sessions (
  id                  uuid primary key default gen_random_uuid(),
  token_hash          bytea not null unique,                 -- sha256(cookie token)
  principal_type      text not null check (principal_type in ('leader','admin')),
  user_id             uuid references public.user_accounts(id) on delete cascade,
  admin_user_id       uuid references app_auth.admin_users(id) on delete cascade,
  created_at          timestamptz not null default clock_timestamp(),
  last_seen_at        timestamptz not null default clock_timestamp(),
  idle_expires_at     timestamptz not null,
  absolute_expires_at timestamptz not null,
  reauth_at           timestamptz not null default clock_timestamp(),  -- last OTP verification
  revoked_at          timestamptz,
  revoke_reason       text,
  check ((principal_type = 'leader' and user_id is not null and admin_user_id is null)
      or (principal_type = 'admin'  and admin_user_id is not null and user_id is null)),
  check (idle_expires_at <= absolute_expires_at),
  check ((revoked_at is null) = (revoke_reason is null))
);
create index sessions_user_live_ix  on app_auth.sessions (user_id)       where revoked_at is null;
create index sessions_admin_live_ix on app_auth.sessions (admin_user_id) where revoked_at is null;

create table app_auth.rate_limits (
  bucket       text not null,          -- 'otp-req:email:' || hex(hmac(key, email)) etc.; never raw PII
  window_start timestamptz not null,
  hits         integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);

create table booking.teams (
  id                     uuid primary key default gen_random_uuid(),
  edition_id             smallint not null references public.event_editions(id) on delete restrict,
  leader_user_id         uuid not null references public.user_accounts(id) on delete restrict,
  track                  text not null check (track in ('senior','junior')),
  startup_team_leader_id uuid references public.startup_team_leaders(id) on delete restrict,
  student_innovator_id   uuid references public.student_innovators(id) on delete restrict,
  team_name_snapshot     text not null check (length(btrim(team_name_snapshot)) between 1 and 200),
  approval_status        text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approval_changed_at    timestamptz,
  approval_changed_by    uuid references app_auth.admin_users(id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((track = 'senior' and startup_team_leader_id is not null and student_innovator_id is null)
      or (track = 'junior' and student_innovator_id is not null and startup_team_leader_id is null)),
  check ((approval_changed_at is null) = (approval_changed_by is null)),
  unique (edition_id, leader_user_id),
  unique (startup_team_leader_id),
  unique (student_innovator_id),
  unique (id, edition_id)
);
```

**Trigger `booking.teams_guard`** (BEFORE INSERT OR UPDATE):
- On INSERT, the referenced source row's `user_id` must equal `leader_user_id`, and its `edition_id` must equal `edition_id`. Otherwise error `BK008`.
- On UPDATE, only `approval_status`, `approval_changed_at`, `approval_changed_by`, `team_name_snapshot` and `updated_at` may change. Otherwise error `BK003`.

### 2.4 Booking core (`0005_booking_core.sql`)

```sql
create table booking.settings (
  edition_id               smallint primary key references public.event_editions(id) on delete restrict,
  booking_enabled          boolean not null default false,       -- kill switch
  opens_at                 timestamptz,
  closes_at                timestamptz,
  hold_seconds             integer not null default 300 check (hold_seconds between 2 and 900),
  eligible_tracks          text[]  not null default '{}' check (eligible_tracks <@ array['senior','junior']::text[]),
  require_team_approval    boolean not null default true,
  rehold_cooldown_seconds  integer not null default 600 check (rehold_cooldown_seconds between 0 and 86400),
  max_new_holds_per_hour   integer not null default 6   check (max_new_holds_per_hour between 1 and 100),
  public_map               boolean not null default false,
  show_hold_expiry_publicly boolean not null default false,
  updated_at               timestamptz not null default now(),
  updated_by               text not null,
  check (opens_at is null or closes_at is null or closes_at > opens_at),
  check (not booking_enabled or (opens_at is not null and closes_at is not null and cardinality(eligible_tracks) > 0))
);
-- hold_seconds >= 2 exists only so tests can run real expiry quickly. Production startup asserts hold_seconds = 300 (§8.4).

create table booking.zones (
  id               uuid primary key default gen_random_uuid(),
  edition_id       smallint not null references public.event_editions(id) on delete restrict,
  code             text not null check (code ~ '^[A-Z]{2}$'),
  name             text not null check (length(btrim(name)) between 1 and 120),
  frame_definition text,                      -- origin/axes description from the survey (§7)
  extent_width_ft  numeric(7,2) check (extent_width_ft > 0),
  extent_depth_ft  numeric(7,2) check (extent_depth_ft > 0),
  landmarks        jsonb not null default '[]'::jsonb check (jsonb_typeof(landmarks) = 'array'),
  inventory_status text not null default 'provisional' check (inventory_status in ('provisional','approved','retired')),
  source_ref       text not null,             -- e.g. 'Map Startup.docx sha256:e0d5d7b7… table 2'
  unique (edition_id, code),
  unique (id, edition_id)
);

create table booking.stalls (
  id               uuid primary key default gen_random_uuid(),   -- permanent identifier
  edition_id       smallint not null,
  zone_id          uuid not null,
  code             text not null check (code ~ '^[A-Z]{2}-[A-Z][0-9]{2}$'),
  width_ft         numeric(5,2) not null default 10 check (width_ft > 0),
  depth_ft         numeric(5,2) not null default 10 check (depth_ft > 0),
  x_ft             numeric(7,2),
  y_ft             numeric(7,2),
  rotation_deg     numeric(5,2) check (rotation_deg >= 0 and rotation_deg < 360),
  inventory_status text not null default 'provisional' check (inventory_status in ('provisional','approved','retired')),
  admin_status     text not null default 'active' check (admin_status in ('active','disabled')),
  disabled_reason  text,
  disabled_at      timestamptz,
  disabled_by      uuid references app_auth.admin_users(id) on delete restrict,
  bookable         boolean generated always as (inventory_status = 'approved' and admin_status = 'active') stored,
  source_ref       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (zone_id, edition_id) references booking.zones(id, edition_id) on delete restrict,
  unique (edition_id, code),            -- codes are never reused, even after retirement
  unique (id, edition_id),
  check (inventory_status <> 'approved' or (x_ft is not null and y_ft is not null and rotation_deg is not null)),
  check ((admin_status = 'disabled') = (disabled_at is not null and disabled_reason is not null))
);

create table booking.reservations (
  id                    uuid primary key default gen_random_uuid(),   -- = holdId
  edition_id            smallint not null,
  stall_id              uuid not null,
  team_id               uuid not null,
  created_by_user_id    uuid not null references public.user_accounts(id) on delete restrict,
  status                text not null check (status in ('held','confirmed','released','expired','cancelled')),
  held_at               timestamptz not null,
  expires_at            timestamptz not null,
  confirmed_at          timestamptz,
  confirmed_by_user_id  uuid references public.user_accounts(id) on delete restrict,
  booking_id            uuid,                                          -- set at confirmation
  booking_ref           text check (booking_ref ~ '^SJ26-[0-9A-HJKMNP-TV-Z]{8}$'),
  released_at           timestamptz,
  release_reason        text check (release_reason in ('leader','admin_disable')),
  released_by_user_id   uuid references public.user_accounts(id) on delete restrict,
  released_by_admin_id  uuid references app_auth.admin_users(id) on delete restrict,
  expired_at            timestamptz,
  cancelled_at          timestamptz,
  cancelled_by_admin_id uuid references app_auth.admin_users(id) on delete restrict,
  cancel_reason         text check (length(btrim(cancel_reason)) between 10 and 500),
  cancel_request_id     uuid,
  foreign key (stall_id, edition_id) references booking.stalls(id, edition_id) on delete restrict,
  foreign key (team_id,  edition_id) references booking.teams(id,  edition_id) on delete restrict,
  constraint reservations_booking_id_uq     unique (booking_id),
  constraint reservations_booking_ref_uq    unique (booking_ref),
  constraint reservations_cancel_request_uq unique (cancel_request_id),
  constraint reservations_window_ck check (expires_at > held_at and expires_at <= held_at + interval '15 minutes'),
  constraint reservations_state_ck check (
    (status = 'held'
      and num_nonnulls(confirmed_at, confirmed_by_user_id, booking_id, booking_ref,
                       released_at, release_reason, released_by_user_id, released_by_admin_id, expired_at,
                       cancelled_at, cancelled_by_admin_id, cancel_reason, cancel_request_id) = 0)
    or (status = 'confirmed'
      and num_nonnulls(confirmed_at, confirmed_by_user_id, booking_id, booking_ref) = 4
      and num_nonnulls(released_at, release_reason, released_by_user_id, released_by_admin_id, expired_at,
                       cancelled_at, cancelled_by_admin_id, cancel_reason, cancel_request_id) = 0
      and confirmed_at >= held_at and confirmed_at < expires_at)
    or (status = 'released'
      and num_nonnulls(confirmed_at, confirmed_by_user_id, booking_id, booking_ref, expired_at,
                       cancelled_at, cancelled_by_admin_id, cancel_reason, cancel_request_id) = 0
      and released_at is not null and released_at >= held_at and released_at < expires_at
      and ((release_reason = 'leader'        and released_by_user_id is not null and released_by_admin_id is null)
        or (release_reason = 'admin_disable' and released_by_admin_id is not null and released_by_user_id is null)))
    or (status = 'expired'
      and num_nonnulls(confirmed_at, confirmed_by_user_id, booking_id, booking_ref,
                       released_at, release_reason, released_by_user_id, released_by_admin_id,
                       cancelled_at, cancelled_by_admin_id, cancel_reason, cancel_request_id) = 0
      and expired_at is not null and expired_at >= expires_at)
    or (status = 'cancelled'
      and num_nonnulls(confirmed_at, confirmed_by_user_id, booking_id, booking_ref) = 4
      and num_nonnulls(cancelled_at, cancelled_by_admin_id, cancel_reason, cancel_request_id) = 4
      and num_nonnulls(released_at, release_reason, released_by_user_id, released_by_admin_id, expired_at) = 0
      and cancelled_at >= confirmed_at)
  )
);
-- Invariants enforced independently of time and of application code:
create unique index reservations_live_stall_uq on booking.reservations (stall_id) where status in ('held','confirmed');
create unique index reservations_live_team_uq  on booking.reservations (team_id)  where status in ('held','confirmed');
create index reservations_team_history_ix on booking.reservations (team_id, held_at desc);
create index reservations_team_stall_ix   on booking.reservations (team_id, stall_id, held_at desc);

create table booking.audit_events (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default clock_timestamp(),
  edition_id     smallint not null references public.event_editions(id) on delete restrict,
  action         text not null check (action in ('hold_created','hold_released','hold_expired','booking_confirmed',
                   'booking_cancelled','stall_disabled','stall_enabled','team_approval_changed','settings_changed',
                   'inventory_changed','admin_grant_changed','team_created')),
  actor_type     text not null check (actor_type in ('leader','admin','system','operator')),
  actor_user_id  uuid references public.user_accounts(id) on delete restrict,
  actor_admin_id uuid references app_auth.admin_users(id) on delete restrict,
  actor_operator text,
  team_id        uuid references booking.teams(id) on delete restrict,
  stall_id       uuid references booking.stalls(id) on delete restrict,
  reservation_id uuid references booking.reservations(id) on delete restrict,
  request_id     uuid,
  reason         text,
  details        jsonb not null default '{}'::jsonb,   -- IDs and states only; no PII
  check ((actor_type = 'leader')   = (actor_user_id  is not null)),
  check ((actor_type = 'admin')    = (actor_admin_id is not null)),
  check ((actor_type = 'operator') = (actor_operator is not null))
);
create index audit_events_reservation_ix on booking.audit_events (reservation_id);
create index audit_events_time_ix        on booking.audit_events (occurred_at desc);
```

**Trigger `booking.reservations_guard`.** BEFORE INSERT OR UPDATE OR DELETE, FOR EACH ROW. Custom SQLSTATEs are mapped in §5.2.

| Event | Rule | Error |
|---|---|---|
| INSERT | `status` must be `held`. `held_at` must be within `[clock_timestamp() - 10 s, clock_timestamp()]`. `expires_at` must equal `held_at + settings.hold_seconds`. `expires_at > clock_timestamp()`. The stall must have `bookable = true`. | `BK005` |
| DELETE | Always rejected | `BK004` |
| UPDATE, any | `id, edition_id, stall_id, team_id, created_by_user_id, held_at, expires_at` are immutable | `BK003` |
| UPDATE `held→confirmed` | `clock_timestamp() < OLD.expires_at` (**expiry backstop that doesn't depend on the application**). `NEW.confirmed_at ≤ clock_timestamp()`. Stall `bookable`. | `BK002` |
| UPDATE `held→released` | Allowed (row CHECK requires `released_at < expires_at`) | — |
| UPDATE `held→expired` | `clock_timestamp() ≥ OLD.expires_at` | `BK006` |
| UPDATE `confirmed→cancelled` | `confirmed_*` and `booking_*` unchanged | `BK003` |
| UPDATE, anything else | Includes a status-preserving update, any update from `released`, `expired` or `cancelled`, and `confirmed→held` | `BK001` |

**Trigger `booking.audit_events_append_only`.** BEFORE UPDATE OR DELETE: always raises `BK007`.

**Trigger `booking.stalls_guard`.** BEFORE UPDATE:
- `id`, `edition_id`, `code` and `zone_id` are immutable.
- `inventory_status` can only move provisional→approved, provisional→retired or approved→retired.
- Retiring or un-approving a stall with a live reservation raises `BK009`.

**Why this is complete:**
- *One active hold per team* and *one confirmed stall per team*: `reservations_live_team_uq`. A team has at most one row that is `held` or `confirmed`, so it can't hold while booked or hold two stalls.
- *One confirmed booking per stall*: `reservations_live_stall_uq`, which also forbids held and confirmed together on one stall.
- *No inconsistent or partial confirmation*: confirmation is one UPDATE of one row, checked by `reservations_state_ck` and the trigger, and written in the same transaction as its audit row.
- *Expired hold cannot be confirmed even if the app is wrong*: `confirmed_at < expires_at` (CHECK) plus `clock_timestamp() < expires_at` at write time (trigger).
- **Stale `held` rows** still occupy the unique indexes. That's intentional: any transaction that wants the stall or team must first lock and mark them `expired`, so every handover is serialised (§4).

### 2.5 Ownership, deletion and retention

| Data | Owner | Delete policy | Retention (provisional default; [ORG] D-24) |
|---|---|---|---|
| `booking.reservations`, `booking.audit_events` | Event organisers | Never deleted by the app (triggers). FKs RESTRICT. | Event end + 180 days, then export and archive by [INFRA] |
| `booking.teams`, `booking.stalls`, `booking.zones` | Organisers | RESTRICT. Stalls are retired, never deleted. | Same as above |
| `app_auth.sessions` | System | App purges rows expired more than 30 days ago (opportunistically) | 30 days after expiry |
| `app_auth.login_challenges` | System | Purged 7 days after creation | 7 days |
| `app_auth.rate_limits` | System | Purged 2 days after `window_start` | 2 days |
| `app_auth.admin_users/grants` | [INFRA] | Disable or revoke only | Indefinite |
| Effect on registration data | — | `user_accounts`, `startup_team_leaders` and `student_innovators` rows referenced by `booking.teams` / `reservations` **can no longer be deleted** (RESTRICT). This is a deliberate behaviour change; deleting a booked team needs a runbook. | — |

### 2.6 Roles, grants, RLS (`0002_app_schemas_and_privileges.sql`, `0003_public_tables_rls.sql`)

| Role | Created by | Purpose | Privileges |
|---|---|---|---|
| owner (`postgres`) | Supabase | Migrations only, run by [INFRA] or a protected CI job | Owner of all objects |
| `isf_app` | [INFRA] creates it with a password in the dashboard SQL editor (the password is never in git) | Runtime, via `isf_app.<project-ref>` on the transaction pooler | See below. **No** DDL, TRUNCATE, BYPASSRLS, CREATEROLE or superuser |
| `isf_test` | Local or CI docker only | Test owner of per-worker test DBs | Owner of test DBs; non-superuser |

`isf_app` grants:
- **`public` registration tables:** `SELECT, INSERT, UPDATE` on `user_accounts`, `role_grants`, `edition_access`, `startups`, `startup_memberships`, `startup_team_leaders`, `student_innovators`, `startup_team_members`, `student_team_members`. `DELETE` **only** on `startup_team_members` and `student_team_members`, because registration replaces member lists (`route.ts:605,703`). `SELECT` on `event_editions`.
- **`app_auth`:**
  - `SELECT, INSERT, UPDATE, DELETE` on `login_challenges`, `sessions`, `rate_limits`
  - **`SELECT` only** on `admin_users`, `admin_grants`
- **`booking`:**
  - `SELECT` on `settings`, `zones`
  - `SELECT` + `UPDATE(admin_status, disabled_reason, disabled_at, disabled_by, updated_at)` on `stalls`
  - `SELECT, INSERT` + `UPDATE(approval_status, approval_changed_at, approval_changed_by, team_name_snapshot, updated_at)` on `teams`
  - `SELECT, INSERT, UPDATE` on `reservations` (the trigger restricts updates)
  - `SELECT, INSERT` on `audit_events`

**RLS on existing `public` tables (`0003`):** for every registration table:
- `alter table … enable row level security`
- `create policy isf_app_all on … for all to isf_app using (true) with check (true)`
- `revoke all on … from anon, authenticated`

The owner bypasses RLS (not FORCE), so the current app connecting as `postgres` keeps working while this is staged.

**Why:** Supabase's documentation states that `public` tables may be granted to `anon`/`authenticated` by default, and that tables without RLS are reachable through the Data API by any role with grants. These tables hold Aadhaar and PAN numbers. **Whether this project currently exposes them is unverified** (B-03, [INFRA], P0).

`app_auth` and `booking` are excluded from exposed schemas and have no grants to Supabase API roles, so RLS isn't needed there. An integration test asserts the absence of grants (SCH-12).

**Sensitive data:** booking never reads Aadhaar or PAN. Column-level revocation of `SELECT(aadhar_number, pan_number)` from `isf_app` is desirable but would break the `ON CONFLICT … DO UPDATE … coalesce(table.col)` statements in `route.ts`. It's deferred to D-25 / a post-launch hardening item.

### 2.7 Migration order, runner, verification, rollback

| # | File | Phase | Content | Down (empty DB only) |
|---|---|---|---|---|
| 0001 | `0001_registration_init.sql` (exists) | — | Baseline. On production it's **marked applied without running** after [INFRA] compares the schema (B-04). | — |
| 0002 | `0002_app_schemas_and_privileges.sql` | P1 | Schemas, revokes, `isf_app` grants on `public` (needs `isf_app` to exist) | drop schemas |
| 0003 | `0003_public_tables_rls.sql` | P1 | RLS and policies on registration tables, revoke anon/authenticated | disable RLS, drop policies, **restore previously captured grants** (captured by a pre-migration report) |
| 0004 | `0004_identity_and_auth.sql` | P2 | §2.3 including `booking.teams` and its trigger, plus grants | drop tables |
| 0005 | `0005_booking_core.sql` | P3 | §2.4 plus triggers and grants | drop tables |
| 0006 | `0006_booking_settings_and_team_backfill.sql` | P3 | Settings row for 2026: `booking_enabled=false`, `eligible_tracks='{}'`, `require_team_approval=true`, `updated_by='migration-0006'`. Inserts teams for leaders with **exactly one** 2026 leader row, `approval_status='pending'`. | delete inserted rows |
| seed | `database/seeds/dev_stall_inventory_provisional.sql` | P4 | Generated from the CSV: zones and stalls `provisional`, geometry null. **Refuses to run when `APP_ENV=production`.** | — |
| 00NN | `00NN_stall_inventory_approved_v1.sql` | after B-07 | Generated from the signed CSV: zones and stalls `approved` with geometry | retire stalls (never delete) |

**Runner** (`scripts/migrate.mjs`, Node, uses the existing `postgres` package):
- Connects through **session mode (5432) or direct**, never 6543.
- Takes `pg_advisory_lock(hashtext('isf-migrations'))`.
- Table `public.schema_migrations(version text primary key, sha256 text not null, applied_at timestamptz not null default now(), applied_by text not null)`.
- Each file runs in one transaction, with checksum verification. It refuses if an applied file's checksum changed.
- Supports `--baseline 0001` and `--dry-run` (prints the plan).
- Requires `--target local|test|staging|production` matching `APP_ENV`, and an interactive confirmation phrase for production.

**Verification** (`database/verify/*.sql`, run after every migration in CI and by [INFRA] after production):
- constraints, indexes and triggers exist by name
- `has_table_privilege('isf_app', …)` matrix equals expected
- `has_table_privilege('anon', 'public.user_accounts', 'select') = false`
- `relrowsecurity` is true for the registration tables
- `pg_namespace` / Supabase exposed-schema setting excludes `app_auth` and `booking` (manual dashboard check by [INFRA])

**Rollback policy:** migrations are additive.
- Before any reservation exists, a down script may run (staging only).
- After real reservations exist, **never drop booking data**. Roll back by setting `booking_enabled=false` and using Vercel instant rollback to the previous deployment; old code ignores the new schemas.
- Point-in-time restore is an [INFRA] decision for catastrophic corruption only. Before production migrations, [INFRA] confirms backups/PITR (B-05).

---

## 3. Authentication, authorisation and threat model

### 3.1 Choice: email one-time code

| Option | Assessment |
|---|---|
| **Email OTP (chosen)** | Every leader already gave an email, and the passwordless flow matches the product decision to remove passwords (`f84c578`). Nodemailer is already a dependency. **Risks:** deliverability and latency at booking open; burst sending; typo'd registration emails (unverified at registration); shared inboxes. **Mitigations:** a transactional provider with domain authentication; leaders can log in *before* opening (sessions last 12 h); an admin recovery runbook for wrong emails. |
| Magic link | Same deliverability. Email security scanners may pre-fetch and consume links. Rejected. |
| SMS OTP | Indian DLT template registration, cost and lead time. Rejected for v1. |
| Supabase Auth | A second user store that doesn't map to `user_accounts`. Its built-in mailer isn't suitable for production volume, so custom SMTP would be needed anyway. Rejected. |
| Password | Removed by product decision; a reset flow needs email anyway. Rejected. |
| Existing `auth_subject = 'dev|<email>'` | **Not an authentication mechanism.** It's ignored for authorisation. |

**Provider setup ([INFRA] + [ORG], B-06):**
1. Choose a provider with an SMTP relay (keeps nodemailer; no new dependency).
2. Verify the sending domain and publish SPF, DKIM and DMARC for the domain [ORG] controls.
3. Use `no-reply@<domain>`.
4. Production credentials go only in Vercel *Production* environment variables; a sandbox or restricted key goes in Preview.
5. Consumer Gmail has documented daily sending caps unsuitable for burst OTP, and its credential is already exposed. It MUST NOT be used for OTP in production.

### 3.2 OTP protocol

1. **`POST /v1/auth/otp/request` `{email, audience}`:**
   - Normalise the email with `lower(btrim())`.
   - Validate the format; on failure return 400.
   - Apply rate limits (§5.9).
   - **Principal lookup:**
     - leader: a `user_accounts` row with `status='active'` **and** at least one 2026 row in `startup_team_leaders` or `student_innovators` for that `user_id`
     - admin: an active `admin_users` row with at least one active grant
   - If a principal exists:
     - mark that email's active challenges `superseded_at = clock_timestamp()`
     - generate `code = crypto.randomInt(0, 1_000_000)`, zero-padded to 6 digits
     - store `code_mac = HMAC-SHA256(OTP_PEPPER, challenge_id || ':' || code)` with `expires_at = created_at + 10 min`
     - send the email **after the response**, using Next.js `after()`; its Vercel behaviour is verified in P2
   - **Always** return `202 {"message":"If this address belongs to an eligible account, a code has been sent."}`. Both branches do the same DB reads, so timing doesn't reveal which branch ran.
2. **`POST /v1/auth/otp/verify` `{email, audience, code}`.** One transaction:
   - `UPDATE app_auth.login_challenges SET attempts = attempts + 1 WHERE id = (latest active for audience+email) AND attempts < 5 AND expires_at > clock_timestamp() AND consumed_at IS NULL AND superseded_at IS NULL RETURNING id, code_mac, user_id, admin_user_id`
   - Constant-time compare.
   - On match: `UPDATE … SET consumed_at = clock_timestamp() WHERE id = $1 AND consumed_at IS NULL`. If 0 rows, it's a parallel duplicate and is treated as a failure.
   - Create a session (§3.4) and set the cookie.
   - **Every failure** returns `400 INVALID_OR_EXPIRED_CODE`.
   - Incrementing attempts before comparing means parallel brute-force attempts still count.
3. Email body: the code, its expiry, and "never share this code". No links. The message is plain text plus minimal HTML with all values escaped.

### 3.3 Leader and team resolution (server-side only)

`resolveLeaderTeam(userId)` runs inside each booking transaction:

1. `S = SELECT id, user_id, team_name FROM public.startup_team_leaders WHERE user_id = $u AND edition_id = 2026`
2. `J = SELECT id, user_id, team_name FROM public.student_innovators  WHERE user_id = $u AND edition_id = 2026`
3. Branch on what was found:

   | Found | Result |
   |---|---|
   | Neither | `403 NOT_TEAM_LEADER`. This covers members, deactivated users and leader rows with a NULL `edition_id`; the last are reported for repair (§6.4). |
   | Both | `409 TEAM_AMBIGUOUS`. No team is used; an admin runbook resolves it (B-10). |
   | Exactly one | `INSERT INTO booking.teams (…) VALUES (…) ON CONFLICT (edition_id, leader_user_id) DO NOTHING`, then `SELECT … FROM booking.teams WHERE edition_id = 2026 AND leader_user_id = $u FOR UPDATE` (lock L1). If the locked row's source id ≠ the resolved row id: `409 TEAM_RECORD_MISMATCH` (admin review). |

4. **Read-only endpoints** (E4, E5, E6) apply steps 1–3 without the INSERT and without locks. If no team row exists yet, they report the status that would apply.
5. **Never used for authorisation:** client-supplied team, startup or user IDs; `user_accounts.category`; `role_grants`, which can't tell the tracks apart (`route.ts:480` grants `startup_team_leader` to both tracks); `startups.name` or `startups.id`; `startup_memberships.position`, which registration can demote (`route.ts:643-646`).

**Eligibility** (evaluated after locks, with `decided_at`):
`booking_enabled AND opens_at ≤ decided_at < closes_at AND track ∈ eligible_tracks AND approval_status <> 'rejected' AND (NOT require_team_approval OR approval_status = 'approved')`

`closes_at` is not checked at confirm (I-17).

### 3.4 Sessions, cookies, CSRF

| Item | Leader | Admin |
|---|---|---|
| Cookie name | `__Host-sj_session` | `__Host-sj_admin` |
| Attributes | `HttpOnly; Secure; SameSite=Lax; Path=/`; no `Domain`; `Max-Age` = remaining absolute lifetime | same |
| Token | 32 random bytes, base64url. DB stores `sha256(token)` only. | same |
| Idle / absolute | 120 min sliding / 12 h | 30 min / 8 h |
| Sliding update | `last_seen_at` and `idle_expires_at` are updated at most once every 5 minutes, so polling doesn't cause a write per request | same |
| Step-up | — | `booking.cancel`, `inventory.manage` and `teams.manage` writes require `reauth_at ≥ clock_timestamp() - 10 min`. Otherwise `403 REAUTH_REQUIRED`; the UI repeats the OTP flow, which updates `reauth_at`. |
| Rotation | A new session row and token on every successful OTP verify. Pre-existing cookies are ignored and replaced. | same |
| Revocation | Logout. Admin runbook. All of the principal's sessions are revoked when an admin changes the email or deactivates the account. At most 5 live sessions per principal; the oldest are revoked. | same |
| Validation | Every request: `token_hash` match, `revoked_at IS NULL`, `idle_expires_at > clock_timestamp()`, `absolute_expires_at > clock_timestamp()`, principal still active | same |

**CSRF:** every non-GET endpoint requires all three of the following; otherwise `403 CSRF_REJECTED`:
- `Origin` equal to `APP_ORIGIN`, or a configured Preview origin (Preview environments only)
- `Content-Type: application/json`
- `Sec-Fetch-Site` of `same-origin`, when the header is present

No CORS headers are emitted; the existing `Access-Control-Allow-Origin: *` at `route.ts:342-351` is removed. GET endpoints change nothing except the throttled `last_seen_at`.

**Local development:** `__Host-` cookies require `Secure`. Chromium and Firefox treat `http://localhost` as a secure context. Verify in P2; otherwise use `next dev --experimental-https`.

### 3.5 Per-handler authorisation

Every route handler calls `requireLeader()` or `requireAdmin(permission, {stepUp})` itself. No `proxy.ts` or middleware is relied on. Pages check the session server-side for redirects only. A test enumerates every route file and asserts each one exports handlers that call the guard (AUTH-15).

### 3.6 Administrators

- **Identity:** `app_auth.admin_users`. They're independent of `user_accounts`, so registration can't create, modify or promote an admin.
- **Permissions** are granted separately:
  - `booking.cancel`: cancel confirmed bookings
  - `inventory.manage`: enable or disable stalls
  - `teams.manage`: approve or reject teams
  - `reports.view`: read lists and audit
- **Grant process:** only [INFRA], using `docs/runbooks/admin-grants.md` (P5). It's reviewed SQL run in the Supabase SQL editor, inserting into `admin_users` / `admin_grants` plus an `audit_events` row with `actor_type='operator'`. `isf_app` has no write privilege on these tables, so a compromised app can't escalate.
- **Audit:** every admin write records the admin ID, a mandatory reason (10–500 characters), the `requestId`, and the before and after states.

### 3.7 Threat model

| # | Threat | Asset | Mitigation |
|---|---|---|---|
| T-01 | Leaked DB, SMTP and ImageKit credentials (public repo, a fork exists via PR #1 `its5zoo`) | Everything | Rotation (§8.1), fallback removal, scanning, least-privilege runtime role |
| T-02 | Data API exposure of `public` tables | Aadhaar, PAN, contacts | RLS plus revoking from anon/authenticated (0003); [INFRA] verification B-03 |
| T-03 | Team takeover by re-submitting registration | Team identity, booking | `409 ALREADY_REGISTERED` for existing leaders (R-02) |
| T-04 | Member upsert overwriting or demoting accounts | Leader identity | Member rows never modify existing accounts (R-03) |
| T-05 | OTP brute force | Sessions | 5 attempts per challenge (counted atomically), 10-minute TTL, IP and email limits |
| T-06 | Account enumeration | Privacy | Constant 202 response; email sent after response; same DB work in both branches |
| T-07 | CSRF | Booking actions | Origin + JSON + SameSite=Lax + no CORS |
| T-08 | Accessing another team's holds or bookings (IDOR) | Holds, bookings | Ownership checked against the session's team; other teams' IDs return 404 |
| T-09 | Double booking via races | Inventory | Partial unique indexes + locks + trigger backstop (§4) |
| T-10 | Hold squatting (hold, release, re-hold) | Fairness | Per-(team, stall) cooldown + hourly cap (D-07) |
| T-11 | Admin misuse | Bookings | Separate permissions, step-up, reasons, append-only audit |
| T-12 | App compromise escalating to admin or DDL | Everything | `isf_app` has no DDL and only SELECT on admin tables |
| T-13 | Tests or scripts writing to production | Production data | Fail-closed guards (§8.4, §9.4) |
| T-14 | HTML injection in emails (`route.ts:769-873` interpolates raw input) | Sender reputation, phishing | Escape all values (R-10) |
| T-15 | Raw DB errors to clients (`route.ts:916`, shown by `register/page.tsx:504`) | Infrastructure details | Sanitised errors with `requestId` (R-07) |
| T-16 | Polling DoS | Availability | Auth-gated polling, WAF/instance limits, small snapshot query |
| T-17 | Hold-token replay | Booking | Token bound to hold, team and expiry; session team must match; expiry enforced in the DB |
| T-18 | Client clock skew | UX only | Decisions use DB time; countdown uses `serverNow` offset |
| T-19 | PII in logs | Privacy | Structured logs with IDs only; tokens, codes, cookies and emails redacted |
| T-20 | XSS stealing session | Sessions | HttpOnly cookies, React escaping. A CSP is recommended post-launch (styled-jsx inline styles need a nonce strategy). |

---

## 4. State machine and transaction algorithms

### 4.1 States

**Persisted** (`booking.reservations.status`): `held`, `confirmed`, `released`, `expired`, `cancelled`. Only `held` and `confirmed` are *live*.

**Effective map status** (computed per stall when read, with `ts = clock_timestamp()` captured once):

| Stall flags | Live reservation | Effective status | Visible to |
|---|---|---|---|
| `inventory_status <> 'approved'` or `admin_status = 'disabled'` | none | `unavailable` | all map viewers |
| any | `confirmed` | `booked` (takes precedence) | all; own team also sees `bookingRef` |
| bookable | `held`, `expires_at > ts` | `held` (own team: `held_by_you` + `holdId`, `expiresAt`) | all; expiry shown to others only if `show_hold_expiry_publicly` |
| bookable | `held`, `expires_at ≤ ts` (stale, not yet cleaned up) | **`available`** | all |
| bookable | none | `available` | all |

The difference: a stale `held` row is **stored** as `held` until a locked transaction marks it `expired`. The map shows it as `available` straight away. Any hold attempt on that stall marks the stale row `expired` under lock before inserting.

### 4.2 Transition table (reservation rows)

| # | From | To | Operation | Actor | Preconditions (under locks, at `decided_at`) | DB enforcement |
|---|---|---|---|---|---|---|
| S1 | (none) | `held` | Hold | Leader | Team eligible; stall bookable; no live claim for team or stall; cooldown and cap OK | `BK005` insert rules; live indexes |
| S2 | `held` | `confirmed` | Confirm | Leader | Owner team; valid token; `decided_at < expires_at`; `booking_enabled`; approval OK; stall bookable | `reservations_state_ck`; `BK002` |
| S3 | `held` | `released` | Release | Leader | Owner team; `decided_at < expires_at` | CHECK `released_at < expires_at` |
| S4 | `held` | `released` (`admin_disable`) | Forced disable | Admin `inventory.manage` | `force=true`; `decided_at < expires_at` | same |
| S5 | `held` | `expired` | Lazy expiry inside hold, confirm, release or disable | `system` | `decided_at ≥ expires_at` | `BK006` |
| S6 | `confirmed` | `cancelled` | Cancel | Admin `booking.cancel` | Reason, requestId | CHECK + `BK003` |
| — | any other | any | — | — | — | `BK001` |

**Stall `admin_status`:** `active ⇄ disabled` (admin `inventory.manage`). Disabling is refused while the stall is `confirmed`. A `held` stall needs `force`, which uses S4.
**Stall `inventory_status`:** provisional → approved → retired, by operator migration only.

### 4.3 Common transaction frame

```
withBookingTx(op):
  attempt = 1..3:
    sql.begin(tx):
      SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s';
      SET LOCAL idle_in_transaction_session_timeout = '10s';
      … op-specific steps (all queries sequential: no Promise.all inside tx; the pooler doesn't support pipelining)
      callbackDone = true
    on success → return
    on error:
      if !callbackDone and SQLSTATE ∈ {40001, 40P01, 55P03} or pre-commit connection error → sleep(rand 25–100 ms × attempt), retry
      if callbackDone (failure during COMMIT) → outcome unknown → re-run op once in a NEW tx (ops are idempotent, §4.4)
      if SQLSTATE 57014 (statement timeout) → 503 RETRY_LATER (no retry)
      BK00x / 23505 → map via §5.2
  exhausted → 503 RETRY_LATER (Retry-After: 2)
```

**Global lock order** (deadlocks can't happen by construction):
1. **L1:** the acting team's `booking.teams` row. At most one team per transaction.
2. **L2:** `booking.stalls` rows, **ascending `id`**.
3. **L3:** `booking.reservations` rows, ascending `id`.

Admin operations that start from a reservation or stall ID first read the related IDs **without locks**, then lock in L1 → L2 → L3 order, then **re-read and re-validate**. If anything changed (for example a different live reservation now exists), they roll back and restart, up to 3 attempts.

Postgres deadlock detection (`deadlock_timeout`) is still the backstop for unforeseen paths: `40P01` → retry.

`decided_at := SELECT clock_timestamp()` is taken **once, after the last lock is acquired**. All expiry and window comparisons and all new timestamps (`held_at`, `expires_at`, `confirmed_at`, `released_at`, `expired_at`, `cancelled_at`) use it. The trigger rechecks against the real clock at write time.

### 4.4 Idempotency and unknown outcomes

| Operation | Idempotency key | Retry after a lost response returns |
|---|---|---|
| Hold | (team, stall) live hold | `200` with the same `holdId`, `expiresAt` and the **same token**. The hold is never extended. |
| Confirm | `holdId` | `200` with the same `bookingId` / `bookingRef` |
| Release | `holdId` | `200 {status:'released'}` or `{status:'expired'}` |
| Cancel | `cancel_request_id` (client UUID) | `200` if it matches; `409 ALREADY_CANCELLED` if it was cancelled by another request |
| Disable / enable | target state | `200` no-op if already in that state (no duplicate audit row) |
| OTP verify | challenge `consumed_at` | Second use fails (`400`). The client then checks `GET /v1/auth/session`. |

**Client recovery rule:** after any network error, timeout or `503 OUTCOME_UNKNOWN`, the client MUST call `GET /v1/booking/me` and render from it, and MUST NOT assume an outcome. A booking that succeeded therefore can't be lost from view, and a hold token can be recovered on any device.

### 4.5 Hold: `POST /v1/booking/holds {stallId}`

1. Authenticate the leader session (otherwise 401). Check CSRF (otherwise 403). Validate that `stallId` is a UUID (otherwise 400).
2. Begin the transaction. `resolveLeaderTeam` takes **L1** (§3.3). Read `settings`.
3. Read the team's live reservation `T` (no lock), giving `T.stall_id` or none. Read the target stall row (no lock); if it doesn't exist in edition 2026, return `404 STALL_NOT_FOUND`.
4. **L2:** `SELECT … FROM booking.stalls WHERE id = ANY($ids) ORDER BY id FOR UPDATE`, where `$ids = {target, T.stall_id}`.
5. **L3:** `SELECT … FROM booking.reservations WHERE status IN ('held','confirmed') AND (team_id = $team OR stall_id = $target) ORDER BY id FOR UPDATE`. Re-derive `T` (team's live claim) and `X` (target stall's live claim) from these locked rows.
6. `decided_at := clock_timestamp()`.
7. Team's own claim `T`. This is evaluated **before** eligibility, so an idempotent retry still recovers an existing hold after `closes_at` or while suspended (confirming it remains subject to §4.6):
   - `confirmed` → `409 TEAM_ALREADY_BOOKED` (body includes their booking)
   - `held`, `decided_at < T.expires_at`:
     - same stall → **COMMIT; `200`**, idempotent, same token
     - other stall → `409 TEAM_HAS_ACTIVE_HOLD` (body includes their hold and token: the caller *is* the owner)
   - `held`, expired → `UPDATE … SET status='expired', expired_at=decided_at`, plus audit `hold_expired` (`actor_type='system'`)
8. Eligibility for a **new** hold (§3.3):
   - not enabled → `409 BOOKING_SUSPENDED`
   - before `opens_at` → `409 BOOKING_NOT_OPEN`
   - at or after `closes_at` → `409 BOOKING_CLOSED`
   - track or approval → `403 TEAM_NOT_ELIGIBLE`
9. Target stall `X` (another team's, since our own was handled in step 8):
   - `confirmed` → `409 STALL_UNAVAILABLE {reason:'booked'}`
   - `held`, unexpired → `409 STALL_UNAVAILABLE {reason:'held'}`
   - `held`, expired → mark `expired` and audit
10. Stall not `bookable` → `409 STALL_UNAVAILABLE {reason:'unavailable'}`.
11. **Cooldown:** a reservation of this team on this stall with status `released`/`expired` whose end (`released_at`, or `expires_at` for expired) is after `decided_at - rehold_cooldown_seconds` → `409 REHOLD_COOLDOWN {retryAfterSeconds}`.
12. **Cap:** `count(*)` of this team's reservations with `held_at > decided_at - 1 hour` ≥ `max_new_holds_per_hour` → `429 HOLD_LIMIT_REACHED {retryAfterSeconds}`.
13. `INSERT` a held row (`held_at = decided_at`, `expires_at = decided_at + hold_seconds`) plus audit `hold_created`. COMMIT. Return `201 {hold}`.

### 4.6 Confirm: `POST /v1/booking/holds/{holdId}/confirm {token}`

1. Authenticate the leader. Check CSRF. Validate `holdId` (UUID) and `token`, matching `^v1\.[a-z0-9]{1,8}\.[A-Za-z0-9_-]{43}$`.
2. Begin the transaction. `resolveLeaderTeam` takes **L1**. Read the reservation `H` by ID (no lock). If it's missing or `H.team_id ≠ team`, return `404 HOLD_NOT_FOUND`.
3. **L2:** lock `H.stall_id`. **L3:** lock `H`. `decided_at := clock_timestamp()`.
4. Verify the token: `v1.<kid>.base64url(HMAC-SHA256(HOLD_TOKEN_KEYS[kid], "sj-hold|v1|" ‖ H.id ‖ "|" ‖ H.team_id ‖ "|" ‖ epochMillis(H.expires_at)))`, constant time. On failure: `403 INVALID_HOLD_TOKEN`.
5. Branch on `H.status`:

   | Status | Result |
   |---|---|
   | `confirmed` | `200` (idempotent, the same booking) |
   | `cancelled` | `409 BOOKING_CANCELLED` |
   | `released` | `409 HOLD_RELEASED` |
   | `expired` | `409 HOLD_EXPIRED` |
   | `held`, `decided_at ≥ expires_at` | Mark `expired` and audit, **COMMIT**, then `409 HOLD_EXPIRED` |
   | `held`, valid | Continue to step 6 |

6. Re-check `booking_enabled` (otherwise `409 BOOKING_SUSPENDED`), team approval (otherwise `403 TEAM_NOT_ELIGIBLE`) and stall bookable (otherwise `409 STALL_UNAVAILABLE`). `closes_at` is deliberately **not** re-checked (I-17).
7. Set `booking_id = gen_random_uuid()` and `booking_ref = 'SJ26-' + 8 Crockford base32 characters`, both from a CSPRNG. `UPDATE … SET status='confirmed', confirmed_at=decided_at, confirmed_by_user_id=$u, booking_id, booking_ref`, plus audit `booking_confirmed`. COMMIT. Return `201 {booking}`.
   - If the trigger raises `BK002` (the clock passed `expires_at` between `decided_at` and the write, a microsecond window): the transaction aborts → `409 HOLD_EXPIRED`. Nothing is persisted, and the stale `held` row is cleaned up by the next locked operation.
   - `23505` on `booking_ref`: retry the whole transaction (new random ref).

### 4.7 Release: `DELETE /v1/booking/holds/{holdId}`

Same frame and locks as confirm, with no token (session ownership is enough). After `decided_at`:
- `held` and valid → `released` (`release_reason='leader'`), audit, `200 {status:'released'}`
- `held` and expired → `expired`, `200 {status:'expired'}`
- already `released` / `expired` → `200` (idempotent)
- `confirmed` → `409 BOOKING_CONFIRMED`
- `cancelled` → `409 BOOKING_CANCELLED`

### 4.8 Admin cancel: `POST /v1/admin/bookings/{bookingId}/cancel {reason, requestId}`

1. `requireAdmin('booking.cancel', {stepUp:true})`. Check CSRF. Validate: `reason` 10–500 characters after trimming; `requestId` a UUID.
2. Read `R` by `booking_id` (no lock); if missing, `404 BOOKING_NOT_FOUND`.
3. **L1:** lock team `R.team_id`. **L2:** lock stall `R.stall_id`. **L3:** lock `R`. `decided_at`.
4. Branch:
   - `confirmed` → `cancelled` (`cancelled_at=decided_at`, admin, reason, `cancel_request_id=requestId`), audit `booking_cancelled`, `200`
   - `cancelled` with the same `cancel_request_id` → `200` (idempotent)
   - `cancelled` otherwise → `409 ALREADY_CANCELLED`

The stall's effective status becomes `available` straight away (D-12). If the organisers want it held back, an `inventory.manage` admin disables it as a separate, audited operation.

### 4.9 Admin stall availability: `POST /v1/admin/stalls/{stallId}/availability {action, reason, force?, requestId}`

1. `requireAdmin('inventory.manage', {stepUp:true})`. Check CSRF. Validate: `action ∈ {disable, enable}`; `reason` 10–500 characters; `force` a boolean (default false); `requestId` a UUID.
2. Read the stall (otherwise 404) and its live reservation `L` (no lock).
3. If `L` exists: **L1** lock `L.team_id`. Then **L2** lock the stall. Then **L3** lock the live reservation(s) for the stall. If the locked live reservation ≠ `L` (it appeared, disappeared or changed team): roll back and restart (max 3; then `503 RETRY_LATER`).
4. `decided_at`, then by action:
   - **`enable`:**
     - stall `inventory_status ≠ 'approved'` → `409 STALL_NOT_APPROVED`
     - already active → `200` no-op
     - otherwise set active, audit `stall_enabled`, `200`
   - **`disable`:**
     - live `confirmed` → `409 STALL_HAS_BOOKING`
     - live `held` and valid: `force=false` → `409 STALL_HAS_ACTIVE_HOLD`; `force=true` → `released` (`admin_disable`) plus audit
     - live `held` and expired → mark `expired`
     - then set `admin_status='disabled'`, reason, `disabled_at=decided_at`, `disabled_by`, audit `stall_disabled`, `200`
     - already disabled → `200` no-op

### 4.10 Live status

**v1 design:**
- `GET /v1/booking/stalls` runs **one SQL statement**:
  - a CTE `clk AS MATERIALIZED (SELECT clock_timestamp() AS ts)`
  - joins stalls, zones and live reservations
  - computes the effective status (§4.1)
  - returns `asOf = ts`
- Headers: `Cache-Control: private, no-store`, `Vary: Cookie`, `export const dynamic = 'force-dynamic'`. **No ETag or 304.** A hold that expires with no writes shows as `available` in the very next response.
- The viewer's own team fields (`heldByYou`, `holdId`, `expiresAt`, `bookingRef`) come from the same statement. **The hold token is never in the snapshot**; only `GET /v1/booking/me` returns it.
- **Client:**
  - polls every 2.5 s while visible; pauses when hidden
  - polls immediately on `visibilitychange`→visible, `online`, after every action, and at `expiresAt + 250 ms` for its own hold
  - ignores any response with `asOf <` the last applied `asOf`
  - backs off exponentially to 15 s on 429/5xx
  - countdown = `expiresAt − (Date.now() + (serverNow − receivedAt))`

**Load estimate:** 100 leaders ÷ 2.5 s ≈ 40 requests/s. Each request is about 2 statements (session check, snapshot), plus at most one session update every 5 minutes. That's well within one Postgres instance, but **pool capacity is unverified** (B-12). Load tests decide.

**Future ETag (optional):** only `ETag = sha256(viewer-specific body)` after expiry has been computed, with `Cache-Control: private, no-cache`. This saves bandwidth only. Never derive it from write counters.

**Push options, re-evaluated against current documentation:**

| Option | Facts (verified 2026-10-28) | Verdict |
|---|---|---|
| Vercel WebSockets | GA on all plans; requires Fluid compute; billed as function usage while open. Next.js needs `upgradeWebSocket()` from `@vercel/functions` ≥ 3.10.0. A connection is pinned to one instance and closes at the function's maximum duration (300 s default; Pro up to 800 s, 1,800 s beta). Vercel recommends an external store such as Redis to coordinate across instances. A DB change feed would also be needed; `LISTEN` sessions don't work through transaction pooling. | Not in v1: needs Redis plus a change feed, for little gain at about 100 users |
| Supabase Realtime (Broadcast from Database) | 200 concurrent connections on Free, 500 on Pro. Needs `supabase-js` and a publishable key in the browser, plus channel authorisation (we don't use Supabase Auth). | Optional v1.1: a public "stall changed" hint that triggers a refetch. Never a source of state. |
| SSE | Same duration limit and change-feed problem | No advantage |
| **Polling** | Stateless; works with the transaction pooler; every response is authoritative | **v1** |

---

## 5. Endpoint contracts

### 5.1 Conventions

- All endpoints are under `/v1`; JSON in and out.
- Every response carries an `X-Request-Id` (generated if absent) and `Cache-Control: private, no-store`.
- Unlisted methods return `405`.
- The error body is `{"error":{"code":"…","message":"…","requestId":"…","details":{…}?}}`. Raw database or provider messages never appear.
- Timestamps are ISO-8601 UTC. The UI displays IST (`Asia/Kolkata`).
- These new static routes take precedence over the existing catch-all `app/v1/[...route]/route.ts`, which keeps serving `POST /v1/auth/register` and `/v1/public/signup`.

### 5.2 Error mapping

| Source | HTTP / code |
|---|---|
| `BK002` | 409 `HOLD_EXPIRED` |
| `BK005` caused by a stall that isn't bookable | 409 `STALL_UNAVAILABLE` |
| `BK001`, `BK003`, `BK004`, `BK006`, `BK007`, `BK008`, `BK009`, or `BK005` for any other reason | 500 `INTERNAL` (programming error; alert) |
| `23505` on `reservations_live_stall_uq` | 409 `STALL_UNAVAILABLE` (should be unreachable; alert) |
| `23505` on `reservations_live_team_uq` | 409 `TEAM_HAS_ACTIVE_CLAIM` (should be unreachable; alert) |
| `23505` on `reservations_booking_ref_uq` | retry the transaction |
| `40001`, `40P01`, `55P03` | retry, then 503 `RETRY_LATER` |
| `57014` | 503 `RETRY_LATER` |
| Unknown commit outcome after re-run | 503 `OUTCOME_UNKNOWN` |
| Config guard failure | 503 `SERVICE_MISCONFIGURED` (details only in logs) |

### 5.3 Endpoints

| # | Method and path | Auth | Authorisation | Request | Success | Errors | Idempotency | Rate limit |
|---|---|---|---|---|---|---|---|---|
| E1 | `POST /v1/auth/otp/request` | none | — | `{email: string ≤254, audience: 'leader'\|'admin'}` | `202 {message}` | 400 VALIDATION, 403 CSRF_REJECTED, 429 RATE_LIMITED | A new request supersedes earlier codes | email+audience: 3 per 15 min, 10 per 24 h; IP: 20 per 15 min |
| E2 | `POST /v1/auth/otp/verify` | none | — | `{email, audience, code: /^\d{6}$/}` | `200 {principal:{type, displayName}, sessionExpiresAt}` + Set-Cookie | 400 INVALID_OR_EXPIRED_CODE, 403 CSRF_REJECTED, 429 | Single use | IP: 50 per 15 min; 5 per challenge |
| E3 | `POST /v1/auth/logout` | session (either) | — | `{audience}` | `204` + cookie cleared | 403 CSRF_REJECTED | Yes | — |
| E4 | `GET /v1/auth/session` | optional | — | — | `200 {principal\|null, leader?:{resolution:'eligible'\|'not_eligible'\|'ambiguous'\|'not_leader'\|'pending_approval', team?:{name, track, approvalStatus}}, sessionExpiresAt}` | — | — | soft 60/min |
| E5 | `GET /v1/booking/stalls` | leader or admin (anonymous if `public_map`) | — | `?zone=PG\|BB\|AG` optional | `200 {asOf, serverNow, bookingWindow:{enabled, opensAt, closesAt}, zones:[{code, name, extent, landmarks}], stalls:[{id, code, zone, x, y, w, d, rot, status, heldByYou?, holdId?, expiresAt?, bookingRef?}]}` | 401, 429 | Read-only | WAF/instance soft 40/min per session |
| E6 | `GET /v1/booking/me` | leader | own team only | — | `200 {team, eligibility, reservation: null \| {kind:'hold', holdId, stallId, stallCode, expiresAt, token} \| {kind:'booking', bookingId, bookingRef, stallId, stallCode, confirmedAt}}` | 401, 403 NOT_TEAM_LEADER, 409 TEAM_AMBIGUOUS | Read-only (recovery endpoint) | 60/min |
| E7 | `POST /v1/booking/holds` | leader | resolved team (§3.3) | `{stallId: uuid}` | `201` or `200` (idempotent) `{holdId, stallId, stallCode, expiresAt, serverNow, token}` | 400, 401, 403 (CSRF_REJECTED, NOT_TEAM_LEADER, TEAM_NOT_ELIGIBLE), 404 STALL_NOT_FOUND, 409 (TEAM_AMBIGUOUS, TEAM_RECORD_MISMATCH, TEAM_HAS_ACTIVE_HOLD, TEAM_ALREADY_BOOKED, STALL_UNAVAILABLE, REHOLD_COOLDOWN, BOOKING_NOT_OPEN, BOOKING_CLOSED, BOOKING_SUSPENDED), 429 (HOLD_LIMIT_REACHED, RATE_LIMITED), 503 | §4.4 | 30/min per team (all calls) + business cap |
| E8 | `POST /v1/booking/holds/{holdId}/confirm` | leader | owner team + token | `{token}` | `201` or `200` (idempotent) `{bookingId, bookingRef, stallId, stallCode, confirmedAt}` | 400, 401, 403 (CSRF_REJECTED, INVALID_HOLD_TOKEN, TEAM_NOT_ELIGIBLE), 404 HOLD_NOT_FOUND, 409 (HOLD_EXPIRED, HOLD_RELEASED, BOOKING_CANCELLED, BOOKING_SUSPENDED, STALL_UNAVAILABLE), 503 | By `holdId` | 30/min per team |
| E9 | `DELETE /v1/booking/holds/{holdId}` | leader | owner team | — (header `Content-Type: application/json`, empty `{}` body for CSRF uniformity) | `200 {status:'released'\|'expired'}` | 401, 403, 404, 409 (BOOKING_CONFIRMED, BOOKING_CANCELLED), 503 | Yes | 30/min per team |
| E10 | `GET /v1/admin/bookings` | admin | `reports.view` or `booking.cancel` | `?status=confirmed\|cancelled&zone=&cursor=&limit≤100` | `200 {items:[{bookingId, bookingRef, stallCode, zone, teamName, track, leaderName, leaderEmail, leaderMobile, confirmedAt, status, cancelledAt?, cancelReason?}], nextCursor}`. Never Aadhaar or PAN. | 401, 403 | Read-only | 60/min |
| E11 | `POST /v1/admin/bookings/{bookingId}/cancel` | admin | `booking.cancel` + step-up | `{reason: 10–500, requestId: uuid}` | `200 {bookingId, status:'cancelled', cancelledAt}` | 400, 401, 403 (FORBIDDEN, REAUTH_REQUIRED, CSRF_REJECTED), 404 BOOKING_NOT_FOUND, 409 ALREADY_CANCELLED, 503 | `requestId` | 30/min |
| E12 | `POST /v1/admin/stalls/{stallId}/availability` | admin | `inventory.manage` + step-up | `{action:'disable'\|'enable', reason: 10–500, force?: boolean, requestId: uuid}` | `200 {stallId, adminStatus, releasedHoldId?}` | 400, 401, 403, 404, 409 (STALL_HAS_BOOKING, STALL_HAS_ACTIVE_HOLD, STALL_NOT_APPROVED), 503 | Target state | 30/min |
| E13 | `GET /v1/admin/teams` | admin | `teams.manage` or `reports.view` | `?approval=&track=&cursor=&limit≤100` | `200 {items:[{teamId, track, teamName, leaderName, leaderEmail, approvalStatus, reservation?}], unresolved:{ambiguousLeaders:int, nullEditionLeaders:int}, nextCursor}` | 401, 403 | Read-only | 60/min |
| E14 | `POST /v1/admin/teams/{teamId}/approval` | admin | `teams.manage` + step-up | `{status:'approved'\|'rejected'\|'pending', reason: 10–500, requestId}` | `200 {teamId, approvalStatus}` | 400, 401, 403, 404, 503 | Target state | 30/min |
| E15 | `GET /v1/admin/audit` | admin | `reports.view` | `?reservationId=&stallId=&teamId=&cursor=&limit≤200` | `200 {items:[audit_event]}` | 401, 403 | Read-only | 60/min |
| E16 | `POST /v1/auth/register` (existing) | none | — | Unchanged schema; `password` is ignored | `200` (unchanged shape, **minus `aadharNumber` and `panNumber`**) | 400, **409 ALREADY_REGISTERED** (new), 500 INTERNAL (sanitised) | Not idempotent across retries; a duplicate returns 409 | IP: 10 per 15 min (new, DB-backed) |

E14 locks the team row (L1 only). It doesn't change live reservations; rejecting a team that already holds a booking requires a separate cancel.

### 5.4 Pages

| Path | Access |
|---|---|
| `/login` | Leader OTP |
| `/book-your-stall` | Server component. No session → redirect to `/login`. Gated by `FEATURE_BOOKING_UI`. |
| `/admin/login` | Admin OTP |
| `/admin` | Tabs: bookings, stalls, teams, audit. Each action is guarded by its API. |

---

## 6. Registration integration and compatibility

### 6.1 Defect triage

| ID | Defect (evidence) | Classification | Fix |
|---|---|---|---|
| R-01 | Hard-coded secret fallbacks (`route.ts:7-9, 69, 103-104`) | **Must fix before any deploy of new code** | `lib/config.ts`; no defaults for secrets |
| R-02 | Unauthenticated resubmission overwrites any leader (`route.ts:487-523, 572-603, 668-700`) | **Must fix before booking launch** | In one transaction: `INSERT … ON CONFLICT DO NOTHING` the account, then `SELECT … FOR UPDATE` the `user_accounts` row by `lower(email)`. If a leader row with `edition_id = 2026` **or NULL** exists in **either** track → `409 ALREADY_REGISTERED` ("contact the organisers to change details"). **Registration never updates an existing `user_accounts` row**; leader details live in the new leader row. Changes to existing registrations go through an admin runbook (D-08). |
| R-03 | Member upsert overwrites existing accounts' name, category, team and photo (`route.ts:610-628, 708-726`) and demotes a leader's membership to `member` (`643-646`, `741-744`) | **Must fix before launch** | Members: `INSERT … ON CONFLICT DO NOTHING RETURNING id`, else `SELECT id`. Never update an existing account. Memberships: `ON CONFLICT DO NOTHING`. Reject a member email equal to the leader email, or duplicated within one submission (`400`). |
| R-04 | Writes not transactional (`route.ts:487-763`) | **Must fix before launch** | ImageKit uploads run first; all DB writes run inside `sql.begin`; the email is sent after commit |
| R-05 | Startups shared by normalised name (`route.ts:541-560`; `schema.sql:77,88`, not unique) | Isolate | Booking never uses `startups`. New registrations create their own `startups` row. Existing shared rows are reported only (§6.4). |
| R-06 | Category accepted as `startup_team_leader`/`startup_leader` and stored raw (`route.ts:383, 495`); `schema.sql:30` CHECK allows only 3 values | Should fix | Store canonical `startup_founder` / `student_innovator` |
| R-07 | Raw DB error and `detail` returned (`route.ts:899-918`) and displayed (`register/page.tsx:504`) | **Must fix** | Generic message + `requestId`; client shows `message` only |
| R-08 | Runtime DDL `ensureTables()` (`route.ts:169-335`) | **Must fix before the switch to `isf_app`** | Remove after [INFRA] confirms the production schema contains all columns (B-04) |
| R-09 | No team identity for booking | Must add | Insert `booking.teams` in the registration transaction (approval `pending`) |
| R-10 | Unescaped HTML in the confirmation email (`route.ts:769-873`) | Should fix (small, security) | Escape every interpolated value |
| R-11 | Aadhaar and PAN returned in the API response (`route.ts:893-894`) and emailed in plain text (`850-851`) | Response: should fix. Email: **[ORG] D-25** | Remove from the JSON response. The email content is an organiser data-protection decision. |
| R-12 | `Access-Control-Allow-Origin: *` (`route.ts:342-351`) | Must fix | Remove CORS; same-origin only |
| R-13 | TLS verification disabled (`route.ts:50, 91`) | Must fix | Verify with the Supabase CA bundle; default TLS for SMTP |
| R-14 | Project-specific URL rewriting (`route.ts:11-43`) | Must fix | Remove; validate `DATABASE_URL` |
| R-15 | `auth_subject = 'dev\|<email>'` (`route.ts:482`) | Isolate | Kept for compatibility; never used for authorisation |
| Out of scope | Base64 upload size/type validation, the unused password field in the UI, visual design, shared-startup data clean-up | — | Backlog |

### 6.2 Compatibility

- **First-time registrations** behave the same: same request and response shapes, minus Aadhaar and PAN in the response.
- **Resubmissions** change from "silently overwrite" to `409`. This is a user-visible behaviour change and needs [ORG] acknowledgement (D-08).
- **No existing rows are modified** by migrations, apart from the new RLS policies and FK RESTRICT effects (§2.5).

### 6.3 Team identity rule (final)

A team for edition 2026 **is** the single leader row (`startup_team_leaders` or `student_innovators`) whose `user_id` is the authenticated principal. It's materialised as one `booking.teams` row. Names, startups, categories and client input are never part of identity.

### 6.4 Read-only diagnostics ([INFRA] runs them; only counts are returned to developers)

1. Users with 2026 leader rows in both tracks
2. Leader rows with `edition_id IS NULL`
3. Leaders whose `user_accounts.category` is a member category
4. Leader emails that also appear as members of other teams
5. `startups` with more than one `startup_memberships.position='leader'`
6. Leaders whose `startup_memberships` row was demoted to `member`
7. Count of duplicate `aadhar_number` across leader rows (a count only; no values leave the database)
8. Schema drift: production `information_schema` columns, constraints and indexes compared with `schema.sql`, especially the `user_accounts.category` CHECK, `student_team_members.leader_user_id` NOT NULL, and whether `startup_team_leaders.mobile` is nullable

Repairs are separate, reviewed SQL changes per case, run by [INFRA] with an audit note. Nothing is repaired automatically.

---

## 7. Venue inventory

Full detail: [`STALL_INVENTORY_PROVISIONAL.md`](STALL_INVENTORY_PROVISIONAL.md); 107 rows in [`stall_inventory_provisional.csv`](stall_inventory_provisional.csv).

| Zone (provisional code) | Runs (stall counts stated explicitly) | Reserved / landmarks (from source) | Position confidence |
|---|---|---|---|
| PG: Play Ground (402 ft × 338 ft labels) | PG-A ×30; PG-B ×18 (180 ft) | Stage for Guru Ji 67 ft; 20 ft road toward guest house; 135 ft open space toward agricultural land; Helipad (with ↑ and → arrows of unknown meaning) | medium / low |
| BB: Basketball Ground | BB-A ×25; BB-B ×28 | Bus Stand Road; Mechanical Block 305 ft; ISF 55 ft; Meeting Room 25 ft; Rang Manch 101 ft (GIET); Entry →, Exit ←; toward Play Ground | medium |
| AG: Outside Agricultural Gate (40 ft) | AG-A ×4; AG-B ×2 | Main Gate; Entry →, Exit ←; road toward guest house | medium / low |
| Unplaced | — | Food Stall; SAFER; Biotech Department | unknown |

**Rules:**
- Every seeded stall is `inventory_status='provisional'` with null geometry, so `bookable=false`; the DB CHECK forbids approval without geometry.
- Seeds never run in production.
- Approval requires the §6 checklist in the inventory document, signed with file hashes.
- **Dates:** 17–20 Dec (map document, main-site body) vs 18–20 Dec with pre-event 17 Dec (registration app, main-site meta). **Not resolved; D-20.**

---

## 8. Environment and secret remediation

### 8.1 Credentials to treat as compromised

Values are deliberately not reproduced. The repository is public (verified: an unauthenticated GitHub API request returned 200), and at least one fork existed (PR #1 from `its5zoo`).

| Credential | Exposed at | First exposed in | Rotation owner and place | Dependent redeploys |
|---|---|---|---|---|
| Supabase `postgres` role password, project `ddrremsyzozutyxbxigf` | `route.ts:9` fallback | `f4c9fdb` | [INFRA]: Supabase dashboard → Database settings → reset password | Every Vercel environment that has `DATABASE_URL`; any local `.env`; any other service using this DB (unknown → [INFRA] inventory) |
| Gmail app password of the sender account | `route.ts:69`; `.env.example:18`; `frontend-web/.env.example:23` | `86d8b81` | Account owner: Google Account → Security → App passwords → revoke. Review recent security activity and sent mail. | Vercel environments with `SMTP_*` |
| ImageKit private key (and paired public key) | `route.ts:103-104`; `.env.example:11-12`; `frontend-web/.env.example:16-17` | `86d8b81` | [INFRA]: ImageKit dashboard → Developer options → regenerate. Audit the media library and usage, because the key allows upload and delete. | Vercel environments with `IMAGEKIT_*` |
| Non-secret but should be config | Sender address (`route.ts:68, 97`), reply-to (`820`), ImageKit ID and endpoint (`101-102`), project ref in messages (`906-912`) | — | [DEV] | — |

**What I did not do:** I didn't test whether any credential still works, and I didn't rotate anything. **No rotation is claimed.**

**Verifying rotation (performed and recorded by [INFRA]):**
1. Dashboard evidence of the rotation (timestamp, operator).
2. The old secret fails authentication when tried from an [INFRA]-controlled machine. This is done only by [INFRA], never in CI and never by developers.
3. Vercel environment variables have been updated in Production, Preview and Development, and redeployed.
4. A smoke test of registration on Preview against **staging**.
5. Supabase auth logs are watched for failures from old credentials for 14 days.

**Developer evidence (P1):**
- `gitleaks detect` passes on the working tree.
- `git grep` finds no literal secrets.
- The app refuses to start with any secret variable missing (CFG tests).

### 8.2 Git history rewrite

- **Value:** low. The secrets are already public, a fork exists, and GitHub keeps `refs/pull/*`; caches and clones also persist. Rewriting does **not** remove the need to rotate.
- **Cost:** every collaborator must re-clone, open PRs break, and commit SHAs change (this document cites SHAs).
- **If [ORG]/[INFRA] still choose it (D-23):**
  1. Rotate first.
  2. Freeze pushes.
  3. `git filter-repo --replace-text` on a fresh mirror clone.
  4. Force-push all branches and tags (repository admin).
  5. Ask GitHub Support to purge cached views and PR refs.
  6. Ask fork owners to delete their forks.
  7. Collaborators re-clone; nobody pushes old clones.
- Recommendation: **don't rewrite**. Rotate, enable GitHub secret scanning with push protection, and move on.

### 8.3 Scanning

- **CI (P1):** `gitleaks` on every PR (diff) and a weekly full-history job. Known historical findings get one allowlist entry per fingerprint, citing this document, so new leaks still fail.
- **GitHub:** [INFRA] enables secret scanning and push protection in the repository settings.
- **Optional pre-commit hook:** `gitleaks protect --staged`.

### 8.4 Configuration and startup guard (`lib/config.ts`, run from `instrumentation.ts` `register()` and lazily on first use)

| Variable | local | test | staging / preview | production |
|---|---|---|---|---|
| `APP_ENV` | `local` | `test` | `staging` | `production` |
| `APP_ORIGIN` | `http://localhost:3000` | `http://localhost:31xx` | Preview or staging URL | `https://register.startupjathara.com` |
| `DATABASE_URL` | local docker | **must be unset**. When `APP_ENV=test` the app reads only `TEST_DATABASE_URL`, after the §9.4 guard. | staging project, `isf_app.<staging-ref>`, port 6543 | production `isf_app.<prod-ref>`, port 6543 |
| `TEST_DATABASE_URL` | — | required (`isf_test@localhost/isf_test_*`) | — | must be unset |
| `DATABASE_CA_CERT` (PEM) | optional | — | required | required |
| `PRODUCTION_DB_DENYLIST` | required (prod ref) | required | required | — |
| `OTP_PEPPER`, `HOLD_TOKEN_KEYS`, `RATE_LIMIT_HASH_KEY` | dev values | test values | staging-only | production-only, ≥ 32 bytes |
| `MAIL_TRANSPORT` | `smtp` → Mailpit | `smtp` → Mailpit or `log` | `smtp` → provider sandbox | `smtp` → provider |
| `MAIL_RECIPIENT_ALLOWLIST` | required | required | **required** | must be unset |
| `SMTP_HOST/PORT/USER/PASS`, `NOTIFY_EMAIL_FROM`, optional `NOTIFY_REPLY_TO` (existing variable names kept) | Mailpit | `log` transport | provider (staging key) | provider (prod key) |
| `IMAGEKIT_*`, `IMAGEKIT_FOLDER` | stub or dev account | **must be unset** (uploads stubbed) | staging folder or key | production |
| `FEATURE_BOOKING_UI` | true | true | true | false until launch |

**Fail-closed rules** (any failure → log the variable name only; every request returns 503 `SERVICE_MISCONFIGURED`):
1. Every required variable is present and well-formed. **There are no defaults for secrets.**
2. Outside production, the database URL in use must not contain any `PRODUCTION_DB_DENYLIST` entry, and email must go only to `MAIL_RECIPIENT_ALLOWLIST`. In `local`/`test`, `SMTP_HOST` must be a loopback address or a single-label compose service name (Mailpit).
3. In staging and production, after connecting:
   - `current_user` must be `isf_app`
   - `SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user` must be false
   - TLS must have been verified
4. In production, `booking.settings.hold_seconds` must equal 300; otherwise booking endpoints return 503 `SERVICE_MISCONFIGURED`.
5. In test, the full test guard (§9.4) must pass.

**Error handling:** a central `toHttpError()` maps known errors to codes (§5.2). Unknown errors → `500 INTERNAL` with `requestId`. Server logs are structured JSON with request ID, route, SQLSTATE and constraint name; tokens, codes, cookies, emails and payloads are redacted.

**TLS:** postgres.js `ssl: { ca: DATABASE_CA_CERT, rejectUnauthorized: true }`; whether the pooler hostname verifies against Supabase's CA is checked on staging (B-12). Nodemailer uses default certificate verification.

---

## 9. Testing, load, deployment, rollback, launch gates

### 9.1 Toolchain (to be added in P1; package installs need approval at that time)

- **Unit, DB and integration tests:** vitest
- **Browser tests:** `@playwright/test`
- **Load tests:** k6 (a separate binary, staging only)
- **Docker Compose for local and CI:**
  - `postgres:<major matching production; B-12>` with `-c cluster_name=isf-test`
  - PgBouncer in **transaction** mode
  - Mailpit
  - Toxiproxy (fault injection)
  - All image tags pinned
- Node 22 (`engines`)

### 9.2 Suites

| Suite | DB connection | App |
|---|---|---|
| `unit` | none | Pure functions: config validation, token HMAC, error mapping, eligibility, client ordering |
| `db` | direct, as `isf_test`; app-path statements run as a test-local `isf_app` | none |
| `integration` | through PgBouncer (transaction mode, `prepare:false`) | Route handlers invoked in-process |
| `concurrency` | PgBouncer | **3 `next start` instances** (ports 3101–3103), requests round-robin |
| `e2e` | PgBouncer | 1 instance + Mailpit; Playwright Chromium and WebKit (desktop and mobile viewports) |
| `load` | staging Supavisor | Staging deployment |

### 9.3 Test matrix

Every test that touches the database ends with **INV**: a SQL check that (a) no stall or team has more than one live row, (b) every `confirmed`/`cancelled` row has a booking ID and ref, (c) no `held` row is unexpired on a non-bookable stall, (d) every state change has a matching audit row.

| ID | Area | Scenario | Expected |
|---|---|---|---|
| SCH-00 | Schema | Apply 0001→0006 to a fresh DB; then apply 0002→0006 to a DB built from the `ensureTables()` DDL (production-like drift) | Both succeed; verification SQL passes |
| SCH-01 | Schema | Insert two live rows for one stall / one team | `23505` |
| SCH-02 | Schema | Each illegal transition (`BK001`), immutable column change (`BK003`), DELETE (`BK004`), audit UPDATE/DELETE (`BK007`) | Rejected |
| SCH-03 | Schema | `held→confirmed` with `confirmed_at < expires_at` but issued after `expires_at` (stale timestamp from the app) | `BK002` |
| SCH-04 | Schema | `held→expired` before expiry | `BK006` |
| SCH-05 | Schema | Insert held with a stale `held_at`, a wrong `expires_at`, or a non-bookable stall | `BK005` |
| SCH-06 | Schema | Approve a stall without geometry; retire a stall with a live reservation | CHECK / `BK009` |
| SCH-07 | Schema | Cross-edition reservation (stall of edition A, team of edition B) | FK violation |
| SCH-08 | Schema | Team row whose leader doesn't match its source row | `BK008` |
| SCH-09 | Schema | Delete a user with a booked team | FK RESTRICT |
| SCH-10 | Schema | Every `reservations_state_ck` branch, positive and negative | As specified |
| SCH-11 | Privilege | `isf_app` privilege matrix; `isf_app` can't write `admin_*`, run DDL or TRUNCATE | As specified |
| SCH-12 | Privilege | `anon`/`authenticated` (created in the test DB to mirror Supabase) have no access to `public` registration tables, `app_auth` or `booking` | Denied |
| RACE-01 | Contention | 100 distinct leaders, barrier-synchronised, hold the same stall; 3 instances; ×50 rounds | Exactly 1 × 201, 99 × 409 STALL_UNAVAILABLE, 0 × 5xx; INV |
| RACE-02 | Same team | One leader, 3 sessions (devices), 20 parallel holds on 20 stalls | Exactly 1 × 201; the other 19 get 409 TEAM_HAS_ACTIVE_HOLD; INV |
| RACE-03 | Same team | Same leader, same stall from 3 devices at once | 1 × 201, 2 × 200, all with the same `holdId` and token |
| RACE-04 | **Confirm waiting past expiry** | `hold_seconds=3`. A lock-holder connection takes `FOR UPDATE` on the stall. Confirm starts before `expires_at` and is observed waiting (`pg_stat_activity.wait_event_type='Lock'`). Wait until DB `clock_timestamp() > expires_at + 0.5 s`; release the lock. | 409 HOLD_EXPIRED; row not `confirmed`; INV. A **mutant** using `now()` must fail this test. |
| RACE-05 | Reclaim vs late confirm | Same as RACE-04, plus team B's hold queued after expiry; run with both queue orders | B 201; A 409 HOLD_EXPIRED; in both orders |
| RACE-06 | Confirm before expiry | Lock released before expiry; B queued | A 201; B 409 STALL_UNAVAILABLE |
| RACE-07 | Trigger backstop | Fault hook delays between `decided_at` and the UPDATE until after expiry | `BK002` → 409; nothing persisted |
| RACE-08 | Duplicate confirm | 10 parallel confirms with the same token; double click | 1 × 201, 9 × 200; one booking ID |
| RACE-09 | Lost response | Fault hook drops the response after COMMIT (hold, confirm, cancel) | The client's `GET /me` shows the outcome; a retry returns the same result |
| RACE-10 | Unknown commit | Fault hook throws a connection error during COMMIT; also Toxiproxy reset mid-commit | Service re-runs → idempotent result, or 503 OUTCOME_UNKNOWN; INV |
| RACE-11 | DB failure | Kill the backend mid-transaction; statement timeout; lock timeout | Rollback; 503; no partial state |
| RACE-12 | Deadlock | Forced reverse-order lock by a test connection | 40P01 retried or 503; INV |
| RACE-13 | Cancel vs hold | Admin cancels while 20 teams try to hold that stall | Serialised; at most one new hold after the cancel commits |
| RACE-14 | Disable vs hold/confirm | Disable (no force) racing a hold; forced disable racing a confirm | Either the hold wins and the disable gets 409 STALL_HAS_ACTIVE_HOLD, or the disable wins and the hold gets 409; forced disable vs confirm leaves exactly one of `released`/`confirmed` |
| RACE-15 | Cooldown and cap | Re-hold the same stall within the cooldown; exceed the hourly cap | 409 REHOLD_COOLDOWN; 429 HOLD_LIMIT_REACHED |
| RACE-16 | Approval change vs hold | Reject a team while it is holding | Serialised on L1; the confirm then fails with 403 |
| AUTH-01 | OTP | Request for a leader, member, unknown or admin email | 202 for all; email only for leader/admin; same DB statement count |
| AUTH-02 | OTP | 6 wrong codes; 10 parallel wrong codes | Locked after 5; attempts counted atomically |
| AUTH-03 | OTP | Expired code; reused code; superseded code; 2 parallel correct submissions | 400; exactly one session created |
| AUTH-04 | OTP | Rate limits per email and per IP | 429 with Retry-After |
| AUTH-05 | Session | Cookie attributes; idle and absolute expiry; revocation; logout; rotation on login | As specified |
| AUTH-06 | Session | A forged cookie or another session's token | 401 |
| AUTH-07 | CSRF | Wrong `Origin`; form content type; cross-site `Sec-Fetch-Site` | 403 |
| AUTH-08 | Authz | Member, non-leader, ambiguous leader, rejected or pending team on every booking endpoint | 403 / 409 as specified |
| AUTH-09 | IDOR | Team B confirms or releases team A's hold; uses A's token | 404 |
| AUTH-10 | Forged input | Extra `teamId`/`userId`/`role` fields in a booking or admin body | `400 VALIDATION` (strict schemas reject unknown keys); such fields are never read |
| AUTH-11 | Admin | Each permission alone against each admin endpoint; no step-up; disabled admin; revoked grant | 403 / REAUTH_REQUIRED |
| AUTH-12 | Admin | Registration with an admin's email | Admin record untouched |
| AUTH-13 | Token | Hold token for another hold, with altered expiry, or with an unknown key ID | 403 INVALID_HOLD_TOKEN |
| AUTH-14 | Token | Key rotation: old key ID accepted only while it's in `HOLD_TOKEN_KEYS` | As specified |
| AUTH-15 | Coverage | Static check that every `app/v1/**/route.ts` handler calls a guard (except E1, E2, E4, E16) | Pass |
| REG-01 | Characterisation (written **before** changing `route.ts`) | New senior and junior registrations create the same rows as today | Rows match the snapshot |
| REG-02 | Takeover | Resubmit an existing leader's email (same or other track) | 409; rows unchanged |
| REG-03 | Member | A member email equal to an existing leader or admin email; duplicate member emails | Existing account unchanged / 400 |
| REG-04 | Atomicity | Inject a failure at the Nth member insert | No rows from that submission persist |
| REG-05 | Errors | DB failure | Body has no `detail`, no SQL text, no hostnames |
| REG-06 | Response | Response JSON | No `aadharNumber` or `panNumber` |
| REG-07 | Email | A team name containing `<script>` | Escaped in the HTML email (captured by Mailpit) |
| REG-08 | Teams | A new registration creates a `booking.teams` row with `pending` approval | Yes |
| GUARD-01 | Test guard | `DATABASE_URL` set; `TEST_DATABASE_URL` host `*.supabase.co`/`.com`, a pooler host, any dotted non-allowlisted host; user ≠ `isf_test`; DB name not matching; missing `cluster_name`; missing marker; non-fixture emails present | Aborts **before the first write**; for pre-connect failures the DB client factory is never called |
| GUARD-02 | Test guard | Populated test DB with valid markers | Runs |
| CFG-01 | App guard | Each missing secret; denylisted DB in staging; `current_user=postgres` in staging; mail recipient outside the allowlist; `hold_seconds≠300` in production | 503 / refuses |
| LIVE-01 | Expiry without writes | Snapshot before and after `expires_at` with no writes in between | `held` → `available` |
| LIVE-02 | Privacy | Team B's snapshot while A holds | `held` with no `holdId`, `expiresAt` (unless enabled) or token |
| LIVE-03 | Headers | E5 response | `private, no-store`; no ETag |
| LIVE-04 | Ordering | Client receives responses out of order (unit + Playwright with delayed routes) | Older `asOf` ignored |
| LIVE-05 | Reconnect | Playwright offline → changes happen → online | Immediate refetch shows the latest state |
| LIVE-06 | Multi-instance | Write on instance 1, poll instance 3 | Visible on the next poll |
| E2E-01..08 | Browser | Login; hold; countdown; confirm; expiry message; stale-map 409 then refresh; keyboard-only flow; mobile list view; admin cancel and disable with step-up | Pass |
| MIG-01 | Runner | Re-apply refused; checksum change detected; `--dry-run` has no effects; `--target` mismatch refused | As specified |

**Fault hooks** (`lib/db/faults.ts`) are compiled into the module but **only active when `APP_ENV==='test'`**, and are checked at call time. CFG-01 asserts they're inert under every other `APP_ENV`.

### 9.4 Test database safety mechanism (final)

**Before connecting** (`tests/support/guard.ts`, shared by vitest `globalSetup`, Playwright `globalSetup`, `scripts/migrate.mjs --target test`, and the app when `APP_ENV=test`):
1. `APP_ENV === 'test'` and `NODE_ENV === 'test'`.
2. `DATABASE_URL`, `SMTP_PASS`, `IMAGEKIT_PRIVATE_KEY` and `IMAGEKIT_PUBLIC_KEY` are **unset**; otherwise abort, naming the variables. (`PRODUCTION_DB_DENYLIST` is *required* and is also applied to `TEST_DATABASE_URL`.)
3. Parse `TEST_DATABASE_URL`:
   - protocol `postgres:`/`postgresql:`
   - hostname ∈ `{localhost, 127.0.0.1, ::1}` ∪ `TEST_DB_ALLOWED_HOSTS` (bare single-label names only, e.g. `postgres-test`, `pgbouncer-test`)
   - reject any hostname containing a dot that isn't a loopback IP
   - reject any match of `/supabase|pooler|amazonaws|azure|neon|render/i`
   - username **exactly** `isf_test`
   - database name matching `^isf_test(_[a-z0-9]{1,32})?$`

**After connecting, before the first write (read-only queries):**
4. `current_setting('cluster_name') = 'isf-test'`, a server-level marker set only in the compose file.
5. `current_user = 'isf_test'` and `current_database()` equal the parsed name.
6. `SELECT value FROM isf_test_guard.marker WHERE key = 'isf-test-db'` returns `'ISF-TEST-DATABASE-v1'`. The bootstrap creates this only inside databases it just created after steps 1–5 passed.
7. **Populated DB allowed:** instead of requiring empty tables, require `SELECT count(*) FROM public.user_accounts WHERE email NOT LIKE '%@example.test'` to be 0. All fixtures use `@example.test`. A restored production dump fails this check.

**Lifecycle:**
- Bootstrap creates `isf_test_template` (migrated plus marker).
- Each worker uses `CREATE DATABASE isf_test_w<N> TEMPLATE isf_test_template` and runs steps 4–7 again.
- Workers are dropped at the end.
- The guard result is cached per process. Every DB client factory in tests asserts the guard passed. There is **never** a fallback to `DATABASE_URL`.

### 9.5 CI (GitHub Actions, P1)

- On every PR: typecheck, gitleaks, unit, db, integration, concurrency (compose services), e2e (Chromium + WebKit).
- Artifacts: JUnit, Playwright traces, INV outputs.
- CI holds **no** production or staging secrets.

### 9.6 Staging

- A separate Supabase project and Vercel Preview/staging environment ([INFRA] B-02), with synthetic data only (never copied PII).
- **Smoke tests:** migrations and verification SQL; `isf_app` connection with TLS; OTP to allowlisted inboxes; hold, confirm, cancel, disable; polling; guard rejects the production DB ref.

### 9.7 Load tests (staging only, k6)

| ID | Scenario | Pass criteria |
|---|---|---|
| LD-01 | 100 sessions polling every 2.5 s for 15 min | p95 < 300 ms, p99 < 800 ms, errors < 0.1 %, DB connections < 70 % of the pool limit |
| LD-02 | 100 sessions hold the **same** stall, synchronised start, ×10 rounds | Per round exactly 1 success; 0 × 5xx; p95 < 1.5 s; INV |
| LD-03 | 150 teams hold then confirm random stalls (sell-out) | Confirmed ≤ stalls; no duplicates; INV; 503 < 0.5 % and every 503 recovered via `/me` |
| LD-04 | Mixed: 100 polling + 50 booking + 2 admins | LD-01 thresholds plus INV |
| LD-05 | 100 OTP requests in 60 s (`MAIL_TRANSPORT=log` on staging for this run) | p95 < 500 ms; limits behave as designed |

Sessions for load tests come from a staging-only seeding script that inserts session rows directly. It's guarded by `APP_ENV=staging`, a staging host allowlist, and an `isf_staging_guard.marker` table. Load tests are never run against production.

### 9.8 Deployment and rollback

1. P1 deployed (security baseline) after B-01.
2. Migrations 0002–0003 on staging → tests → production (after B-04, B-05).
3. Runtime switched to `isf_app` on staging → production.
4. Feature code deployed dark (`FEATURE_BOOKING_UI=false`, `booking_enabled=false`).
5. Inventory approved via migration after B-07.
6. Organisers set the settings (D-01..D-07), applied by an operator SQL runbook with an audit row.
7. Open booking with the UI flag on.

**Rollback:**
- `booking_enabled=false` (immediate; confirmed bookings are kept).
- Vercel instant rollback (the schema is additive).
- Never drop booking data.

### 9.9 Launch gates (all required, with evidence)

| Gate | Evidence |
|---|---|
| LG-01 | Credentials rotated: [INFRA] signed note with dates (§8.1) |
| LG-02 | No secrets in the tree; gitleaks CI green; GitHub push protection enabled |
| LG-03 | Production runs as `isf_app`; verification SQL output attached |
| LG-04 | Data API exposure closed: RLS and grant verification output for production (B-03) |
| LG-05 | Registration fixes R-01..R-04, R-07, R-08, R-09, R-12..R-14 deployed; REG suite green |
| LG-06 | Email provider live with SPF/DKIM/DMARC passing; test OTP received |
| LG-07 | Inventory approved and signed (hashes); approved migration applied; previews attached |
| LG-08 | Decision register entries marked [ORG] approved, with name and date |
| LG-09 | All CI suites green on the release commit (links) |
| LG-10 | LD-01..LD-05 reports meet the criteria |
| LG-11 | Manual acceptance (desktop, Android, iOS; admin workflow) signed by [ORG] |
| LG-12 | Backups/PITR confirmed by [INFRA] |
| LG-13 | Runbooks: admin grants, team ambiguity, wrong-email recovery, incident/kill switch |
| LG-14 | Monitoring: alerts on 5xx rate, `BK00x`/unexpected `23505`, DB connections |

---

## 10. Business decision register

Rows marked "Organiser approval: Yes" need **organiser approval**. None has been obtained.

| ID | Decision | Provisional default (not approved) | Reason | If left undecided | Organiser approval |
|---|---|---|---|---|---|
| D-01 | Eligible tracks | None enabled (`eligible_tracks='{}'`); suggested: Senior and Junior both eligible, since both tracks' perks mention a demo desk or kiosk | Can't be inferred safely | Booking can't open | Yes |
| D-02 | Organiser approval of teams | Required (`require_team_approval=true`) | Registration is unauthenticated, so filtering spam or duplicates protects inventory | Every team stays `pending`; nobody can book | Yes |
| D-03 | Lead one team and be a member of another | Allowed; never modifies the other account (R-03) | Common in student teams | Current behaviour is unsafe (overwrites) | Yes |
| D-04 | One person leading two teams (same email) | Impossible: a 2026 leader row in either track blocks a second (R-02) | Takeover prevention | — | Yes (acknowledge) |
| D-05 | Booking window and timezone | `opens_at` / `closes_at` in IST (`Asia/Kolkata`), stored UTC; suggested after the 11 Nov registration deadline and after approvals | Final team list | Can't open | Yes |
| D-06 | Simultaneous access or staggered by track | Simultaneous single window | Simplicity | — | Yes |
| D-07 | Cooldown and caps | Re-hold of the same stall blocked for 10 min after release or expiry; at most 6 new holds per hour | Prevents squatting | Squatting possible | Yes |
| D-08 | Changes to existing registrations | Blocked (409); organisers edit through a runbook | Prevents takeover | Takeover risk stays | Yes |
| D-09 | Self-service stall change after booking | Not allowed | One live claim per team (index) | — | Yes |
| D-10 | Voluntary release of a hold | Allowed | Frees inventory | — | Yes |
| D-11 | Rebooking after an admin cancels | Allowed while the window is open | Cancellations usually fix mistakes | — | Yes |
| D-12 | Cancelled stall availability | Available immediately (an admin may disable it separately) | Simplicity | — | Yes |
| D-13 | Who may cancel; reason | `booking.cancel` admins only; reason 10–500 characters | Accountability | — | Yes |
| D-14 | Confirmation of a hold after `closes_at` | Allowed until the hold expires | Fairness at close | — | Yes |
| D-15 | Leader change after booking | Not supported in v1; organisers cancel, and the new leader (after a runbook registration fix) books again | Complexity | — | Yes |
| D-16 | Booking confirmation email | Yes, best-effort after commit; the booking stands if the email fails | User reassurance; not needed for correctness | No email | Yes |
| D-17 | Who sees the map | Logged-in leaders and admins only (`public_map=false`) | Smaller attack and load surface | — | Yes |
| D-18 | Public details | Stall code, zone, status only; no team names. Hold expiry hidden from others. | Privacy | — | Yes |
| D-19 | Admin view details | Team name, track, leader name, email and mobile; **no** Aadhaar or PAN | Need to know | — | Yes |
| D-20 | Event and stall operating dates | **Unresolved:** 17–20 vs 18–20 (+17 pre-event) | Conflicting sources | Confirmation text can't be finalised | Yes |
| D-21 | Admin list and permissions | Named people and the permission each receives | Least privilege | No admin operations | Yes |
| D-22 | Email provider and sending domain | A transactional provider on the organisers' domain | Deliverability | No login | Yes, plus [INFRA] |
| D-23 | Git history rewrite | Don't rewrite; rotate | §8.2 | — | Yes, plus [INFRA] |
| D-24 | Retention of booking records | Event end + 180 days | Disputes and audit | Indefinite retention | Yes |
| D-25 | Aadhaar/PAN in emails and plaintext storage | Stop emailing; review storage (DPDP Act 2023 obligations to be assessed by organisers) | Data protection | Ongoing exposure | Yes |
| D-26 | Stall code scheme and inventory | `PG-A01…` provisional (inventory document) | Traceability | Can't activate | Yes |

**Safe technical defaults, no organiser approval needed:** hold length 300 s (stated requirement); DB-clock decisions; lock order; OTP parameters; session lifetimes; no-store polling; least-privilege roles; fail-closed guards.

---

## 11. File-by-file implementation plan

Each bullet is about one reviewable PR with its own tests. **P0** is human-only. Branch: `feature/book-your-stall`, created from `origin/main` after fast-forwarding local `main` (3 commits behind; no local changes conflict).

**P0: Prerequisites (no code).** B-01..B-07 and the decisions in §10.

**P1: Security and environment isolation**
1. `docker-compose.test.yml`, `tests/support/guard.ts`, `tests/support/db.ts`, `tests/guard/*.test.ts`, `vitest.config.ts`, `frontend-web/package.json` (devDeps, scripts). GUARD-01/02.
2. **Fallback removal only** (R-01): `frontend-web/lib/config.ts` (DB, SMTP and ImageKit variables, required, no defaults; `APP_ENV=test` reads `TEST_DATABASE_URL` through the guard) and `frontend-web/lib/db.ts`. Edit `route.ts` only to use them. No other behaviour change. **This MUST merge before any test imports `route.ts`.** Today the unchanged file falls back to the production database whenever `DATABASE_URL` is unset, which the test guard requires.
3. `tests/integration/registration.characterization.test.ts` (REG-01) against the code from step 2. Photos are passed as `https://` URLs so ImageKit isn't called; email goes to Mailpit.
4. `frontend-web/instrumentation.ts` (startup guard). Edit `app/v1/[...route]/route.ts`: remove `resolveDatabaseUrl`, the TLS bypass and CORS; sanitise errors (R-07, R-12..R-14). Edit `app/register/page.tsx`: show `message`, not `detail`. Placeholders in `.env.example` and `frontend-web/.env.example`. CFG-01.
5. `.gitleaks.toml`, `.github/workflows/ci.yml`.
6. `scripts/migrate.mjs`, `database/migrations/0002_app_schemas_and_privileges.sql`, `0003_public_tables_rls.sql`, `database/verify/*.sql`, `tests/db/privileges.test.ts` (SCH-11/12, MIG-01). `docs/runbooks/create-isf-app-role.md`.

**P2: Authentication and team-leader verification**
1. `0004_identity_and_auth.sql` + SCH tests for teams and auth tables.
2. `lib/auth/{otp,session,guards,rate-limit}.ts`, `lib/mail.ts`; routes `app/v1/auth/otp/request/route.ts`, `otp/verify/route.ts`, `logout/route.ts`, `session/route.ts`; AUTH-01..07, AUTH-15.
3. `lib/booking/resolve-team.ts`; AUTH-08.
4. Registration hardening in `route.ts`: R-02, R-03, R-04, R-06, R-09, R-10, R-11 (response); REG-02..08. Remove `ensureTables` (R-08) after B-04.
5. Pages `app/login/page.tsx`, `app/admin/login/page.tsx`; `docs/runbooks/{admin-grants,wrong-email-recovery,team-ambiguity}.md`.

**P3: Booking database and atomic reservation service**
1. `0005_booking_core.sql`, `0006_booking_settings_and_team_backfill.sql`; SCH-00..10.
2. `lib/booking/{tx,errors,token,service,snapshot}.ts`, `lib/db/faults.ts`.
3. Routes `app/v1/booking/stalls/route.ts`, `me/route.ts`, `holds/route.ts`, `holds/[holdId]/route.ts`, `holds/[holdId]/confirm/route.ts`.
4. `tests/concurrency/*` RACE-01..12, 15, 16; LIVE-01..03, 06.

**P4: Interactive map and live status**
1. `scripts/inventory/{validate,generate-seed,render-preview}.mjs`, `database/seeds/dev_stall_inventory_provisional.sql` (generated).
2. `app/book-your-stall/page.tsx`, `components/{StallMap,ZoneTabs,StallLegend,StallList,HoldPanel,ConfirmDialog}.tsx`, `lib/booking/client-poller.ts`. Styles follow `globals.css` tokens. Header link in `app/layout.tsx` behind `FEATURE_BOOKING_UI`.
3. `e2e/*.spec.ts`, `playwright.config.ts`; LIVE-04/05, E2E-01..07.

**P5: Admin operations**
1. Routes `app/v1/admin/{bookings,bookings/[bookingId]/cancel,stalls/[stallId]/availability,teams,teams/[teamId]/approval,audit}/route.ts`.
2. `app/admin/page.tsx` + components; AUTH-11/12, RACE-13/14, E2E-08.

**P6: Dedicated testing and hardening.** `load/*.k6.js`, staging seeding script, Toxiproxy scenarios (RACE-10), security review, LD-01..05, launch-gate evidence pack (`docs/release/LAUNCH_EVIDENCE.md`).

**Inventory activation** (after B-07): `database/migrations/00NN_stall_inventory_approved_v1.sql` generated from the signed CSV.

---

## 12. Blockers and owners

| Priority | ID | Blocker | Owner | Needed before |
|---|---|---|---|---|
| P0 | B-01 | Rotate the Supabase DB password, Gmail app password and ImageKit key; update Vercel environments; redeploy; record evidence (§8.1) | [INFRA] / account owners | Any further deploy; P1 merge |
| P0 | B-03 | Check whether the Data API exposes `public` registration tables (grants to anon/authenticated, RLS status, exposed schemas) and whether the anon key is in use anywhere | [INFRA] | Immediately (Aadhaar data) |
| P0 | B-02 | Staging Supabase project + Vercel staging/Preview environment with separate secrets; confirm Preview never uses production variables | [INFRA] | P1 testing on staging |
| P1 | B-04 | Read-only production schema dump (schema only, no data) and the §6.4 diagnostic counts | [INFRA] | Removing `ensureTables`; baseline 0001 |
| P1 | B-05 | Confirm backups/PITR and the restore procedure | [INFRA] | Production migrations |
| P1 | B-06 | Email provider, sending domain, DNS records (D-22) | [ORG] + [INFRA] | P2 launch |
| P1 | B-08 | Create the `isf_app` role (password via dashboard; never in git) | [INFRA] | Migration 0002 |
| P1 | B-09 | Decisions D-01..D-26 recorded with approver and date | [ORG] | Opening booking (D-08 before P2 ships) |
| P1 | B-07 | Approved venue inventory and coordinates (§7, inventory document) | [ORG] (+ [DEV] tooling) | Activating inventory |
| P2 | B-10 | Admin list (D-21) and resolution of ambiguous leaders | [ORG] + [INFRA] | P5 |
| P2 | B-11 | Confirm Vercel plan, Fluid compute, WAF rate-limit availability, and that hosting really is Vercel | [INFRA] | P3 rate-limit design final |
| P2 | B-12 | Supabase plan, Postgres major version, Supavisor pool sizes, CA certificate, custom-role login via shared pooler (`isf_app.<ref>`) | [INFRA] | P1 compose image; LD criteria |
| P2 | B-13 | Approval to add devDependencies (vitest, Playwright) and Docker images | [ORG]/maintainer | P1 |
| P2 | B-14 | Fast-forward local `main` to `origin/main` before branching | [DEV] (with approval) | P1 |

---

## Appendix A: Evidence ledger

**Verified in this phase (read-only):**
- Git state: clean except `docs/`; local `main` 3 behind `origin/main`; the upstream diff touches only `register/page.tsx`.
- No local `.env*` files; no relevant environment variable *names* set in the inspection shell (values never read).
- Secret locations and the commits that introduced them (values redacted in all outputs).
- The repository is publicly readable (unauthenticated API 200). PR #1 came from fork `its5zoo`.
- Code facts cited with `file:line` above. The registration client displays `data.detail` (`register/page.tsx:504`).
- `Map Startup.docx` structure, text, colours, arrows, image placement and metadata (parsed from OOXML; the scratch copy is byte-identical to the repository file).
- Current Vercel WebSocket, function-duration, Supabase Data API, RLS, Realtime-limit and pooler custom-role documentation (fetched 2026-10-28).

## Appendix B: Implementation progress

**P1, partially implemented on branch `feature/book-your-stall` (uncommitted):**
- Done: R-01 (all secret fallbacks removed; `lib/config.ts`, `lib/db.ts`, `lib/mail.ts`), R-07 (sanitised errors with `requestId`; the client no longer shows `detail`), R-12 (wildcard CORS removed), R-13 (TLS verified with `DATABASE_CA_CERT`; the SMTP TLS bypass removed), R-14 (`resolveDatabaseUrl` removed), placeholder-only `.env.example` files, `instrumentation.ts` startup check, the test guard (§9.4), vitest `unit`/`db` projects, characterisation tests (REG-01), `.gitleaks.toml` + CI.
- **Deviations from this spec:**
  1. There's no Docker Compose. `frontend-web/scripts/test-db.mjs` runs an `initdb` cluster, locally and in CI (the runner's preinstalled PostgreSQL), because Docker isn't available on the development machine. PgBouncer, Mailpit and Toxiproxy are deferred to P3 and P6.
  2. The existing mail variable names are kept (`NOTIFY_EMAIL_FROM`).
  3. gitleaks' default rules detected **none** of the three leaked credential types. `.gitleaks.toml` adds project rules, verified to find all 7 known leaks in the pre-remediation tree and none in the new tree.
  4. CI scans the working tree plus pull-request commits only; a history scan would fail on the pre-rotation commits.
- Not yet done in P1: migration runner, privileges/RLS migration (blocked on B-08 `isf_app`), production `current_user` check (with the role switch).

**P2, implemented on the same branch (uncommitted):**
- Migrations: `0002_app_schemas.sql` (private schemas; Supabase API roles revoked when present) and `0003_identity_and_auth.sql` (§2.3 tables + `booking.teams` with `teams_guard`).
- Auth: `lib/auth/{crypto,rate-limit,otp,session,guards,leader}.ts`, `lib/http.ts`, `lib/after-response.ts`.
- Routes: E1 `POST /v1/auth/otp/request`, E2 `POST /v1/auth/otp/verify`, E3 `POST /v1/auth/logout`, E4 `GET /v1/auth/session`.
- Pages: `/login`, `/admin/login`.
- Registration hardening in `route.ts` + `lib/registration/{persist,confirmation-email}.ts`: R-02, R-03, R-04, R-05 (per-leader startups), R-06, R-09, R-10, R-11 (response only).
- Runbooks: `docs/runbooks/{admin-grants,team-ambiguity,wrong-email-recovery}.md`.
- **Deviations from this spec:**
  1. **Migration numbering:** schemas are 0002 and identity/auth is 0003. The RLS-on-`public` and runtime-grants migration (spec 0003 and part of 0002) moves to a later number because it needs the `isf_app` role (B-08). Booking core and backfill shift up accordingly.
  2. **E4 response shape:** `{ leader: {...} | null, admin: {...} | null }`, because the leader and admin cookies are independent. "Eligible" vs "pending approval" needs `booking.settings` (P3); until then E4 reports `resolution` plus `team.approvalStatus`.
  3. **Registration rate limit:** 30 per 15 minutes per address (spec E16 said 10), so a campus network registering many teams isn't blocked.
  4. **Duplicate registration:** checks for a leader row in **any** edition, because `user_id` is unique across editions in both leader tables.
  5. **OTP request timing:** reads are identical whether or not an account exists, but the write is not. The extra time (one small transaction) is the residual difference; the email itself is sent after the response.
- **Deployment prerequisites for P2 code** (none performed):
  - Apply migrations 0002 and 0003 **before** deploying; registration writes `booking.teams` and uses `app_auth.rate_limits`.
  - Set `APP_ORIGIN`, `OTP_PEPPER` and `RATE_LIMIT_HASH_KEY` (independent random values, ≥ 32 characters).
  - Choose the email provider (B-06) before enabling sign-in for real users.
  - `ensureTables()` remains until B-04.

**P3, implemented on the same branch (uncommitted):**
- Migrations:
  - `0004_booking_core.sql`: settings, zones, stalls, reservations, audit events; triggers `reservations_guard` (BK001–BK006), `audit_events_append_only` (BK007), `stalls_guard` (BK001/BK003/BK009).
  - `0005_booking_settings_and_team_backfill.sql`: booking starts closed; teams backfilled for leaders with exactly one 2026 registration. Verified on legacy-shaped data.
- Service: `lib/booking/{tx,service,snapshot,token,poll-limit}.ts`, `lib/db/faults.ts` (test-only hooks).
- Routes:
  - E5 `GET /v1/booking/stalls`
  - E6 `GET /v1/booking/me`
  - E7 `POST /v1/booking/holds`
  - E8 `POST /v1/booking/holds/{holdId}/confirm`
  - E9 `DELETE /v1/booking/holds/{holdId}`
- Config: `HOLD_TOKEN_KEYS` (required; versioned keys for rotation).
- Tests: `tests/concurrency/booking-races.test.ts` (RACE-01..12, 15, 16), `tests/integration/booking-api.test.ts`, `tests/db/booking-schema.test.ts` (SCH-01..07, 10), `tests/unit/booking-unit.test.ts`.
- **Deviations from this spec:**
  1. **Migration numbers:** booking core is 0004 and settings/backfill is 0005 (the shift recorded under P2).
  2. **Concurrency tests run in-process, not across 3 instances behind PgBouncer** (no Docker/PgBouncer on the development machine). The real route handlers and the production pool settings (`max: 5`, `prepare: false`) are used. Multi-instance and transaction-pooler runs (RACE-01 variant, LIVE-06) and Toxiproxy network faults (RACE-10 variant) move to P6 on staging (B-02, B-12).
  3. **Unknown-commit and pre-commit failures** are injected with test-only fault hooks, inert unless `APP_ENV=test` (unit-tested).
  4. **`/me` eligibility reasons** are more specific than the spec: `BOOKING_SUSPENDED`, `BOOKING_NOT_OPEN`, `BOOKING_CLOSED`, `TRACK_NOT_ELIGIBLE`, `PENDING_APPROVAL`, `TEAM_REJECTED`. E4 still reports resolution plus approval only; clients use E6 for eligibility.
  5. **E5** authorises inline (leader or admin session, or the organiser-enabled public map) and is on the reviewed AUTH-15 list. Provisional stalls appear as `unavailable`; production has no stalls until the approved inventory migration.
  6. **Registration:** team names over 200 characters now get a clear 400. On the schema of record (`0001`, `startups.name` ≤ 200) they previously failed with a raw 500. The booking snapshot is also truncated to 200 defensively for legacy data.
- **Deployment prerequisites for P3 code** (none performed):
  - Apply 0004 and 0005 after 0002/0003.
  - Set `HOLD_TOKEN_KEYS`.
  - Booking stays closed until operators apply organiser decisions D-01..D-07 and an approved inventory (B-07, B-09).

**Not verified (owner):**
- Production schema, grants, RLS and Data API exposure (B-03, B-04, [INFRA])
- Whether exposed credentials are still valid (deliberately not tested; [INFRA])
- Vercel project configuration, plan and environment scoping (B-11)
- Supabase plan, Postgres version, pool sizes, CA verification through the pooler (B-12)
- Existence of other forks or clones
- Behaviour of Next.js `after()` on Vercel, and `__Host-` cookies on `http://localhost` (to be tested in P2)
- **All DDL in §2 is unexecuted** (validated in P3 by SCH-00)
- **No tests exist or were run**
