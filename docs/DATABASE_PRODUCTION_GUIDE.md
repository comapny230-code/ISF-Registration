# ISF Startup Jathara 2026 — Production Database Guide

This document explains the unified PostgreSQL database architecture for **Summit Registration** and **Book Your Stall**, and how to initialize and operate it in local development and production.

---

## 1. Unified Master Schema Overview

The complete production database schema is unified into:
* **[`database/schema.sql`](../database/schema.sql)**

It creates all three required schemas, constraints, indexes, triggers, and production seed data:

### Schemas & Tables

| Schema | Table | Description |
|---|---|---|
| `public` | `event_editions` | Event metadata (Edition 2026: 18–20 Dec 2026 @ GIET University) |
| `public` | `user_accounts` | Team leaders and team members credentials, contact, and profile details |
| `public` | `startups` | Registered startups and prototype project entities |
| `public` | `startup_memberships` | Mapping of leaders and members to startups |
| `public` | `startup_team_leaders` | Senior track team leader accreditation records |
| `public` | `startup_team_members` | Senior track team member badges & details |
| `public` | `student_innovators` | Junior track innovator accreditation records |
| `public` | `student_team_members` | Junior track team member badges & details |
| `app_auth` | `admin_users` | Platform operators and stall administrators (isolated from registrants) |
| `app_auth` | `admin_grants` | Fine-grained admin privileges (`booking.cancel`, `inventory.manage`, etc.) |
| `app_auth` | `login_challenges` | One-time 6-digit email OTPs bound to browser session hashes |
| `app_auth` | `sessions` | Server-managed HttpOnly sessions |
| `app_auth` | `rate_limits` | HMAC-keyed rate limiting buckets |
| `app_auth` | `registration_email_challenges` | Pre-submission email proof challenges |
| `booking` | `settings` | Hold window (300s), open/close timestamps, eligible tracks |
| `booking` | `teams` | Verified teams eligible for stall booking |
| `booking` | `zones` | Event zones (PG: Play Ground, BB: Basketball Ground, AG: Agricultural Gate) |
| `booking` | `stalls` | 107 stalls with coordinates (`x_ft`, `y_ft`, `rotation_deg`), dimensions, and live bookability |
| `booking` | `reservations` | Append-only hold/confirm/release lifecycle state machine |
| `booking` | `audit_events` | Immutable forensic audit log tracking every action |

---

## 2. Hard Invariants & Concurrency Guards

The database enforces critical rules directly at the PostgreSQL engine level, regardless of application code:
1. **Single Live Claim per Stall (`reservations_live_stall_uq`)**: Partial unique index prevents any two teams from holding or booking the same stall concurrently.
2. **Single Live Reservation per Team (`reservations_live_team_uq`)**: A team can hold or book at most one stall at a time.
3. **Database Clock Authority (`reservations_guard`)**: Expiry and confirmation use `clock_timestamp()` evaluated *after* acquiring row-level locks. Confirmations at or after expiry are rejected with error `BK002`.
4. **Append-Only Immutability (`audit_events_append_only`)**: Updates and deletes on audit log records raise error `BK007`.

---

## 3. Deploying to Production (Supabase, Neon, AWS RDS, etc.)

### Option A: One-Command Setup Runner
If your production or staging database connection string is available:
```bash
npm run db:setup -- --url "postgresql://<user>:<password>@<host>:<port>/<dbname>?sslmode=require"
```
Or set `DATABASE_URL` in `frontend-web/.env.production` and run:
```bash
npm run db:setup
```

### Option B: Cloud SQL Editor (Supabase / Neon Dashboard)
1. Open your database dashboard's **SQL Editor**.
2. Copy and paste the contents of **[`database/schema.sql`](../database/schema.sql)**.
3. Run the script. It is idempotent and safe to run on new or existing instances.

---

## 4. Local Development with Docker

To run a clean PostgreSQL 16 instance locally:
```bash
# 1. Start database container (initializes automatically with database/schema.sql)
docker compose up -d

# 2. Verify status
npm run db:verify
```
The database listens on `localhost:5432` with user `postgres`, password `postgres`, database `isf_dev`.

---

## 5. Adding Admin Users

To grant an organizer or operator admin access to `/admin`:
```sql
-- 1. Insert admin user
insert into app_auth.admin_users (email, display_name, created_by)
values ('admin@startupjathara.com', 'Lead Organizer', 'manual_init')
on conflict (email) do nothing;

-- 2. Grant all administrative permissions
insert into app_auth.admin_grants (admin_user_id, permission, granted_by)
select id, p.permission, 'manual_init'
  from app_auth.admin_users
 cross join (values ('booking.cancel'), ('inventory.manage'), ('teams.manage'), ('reports.view')) as p(permission)
 where email = 'admin@startupjathara.com'
on conflict do nothing;
```
The admin can then sign in via `/admin/login` using email OTP authentication.
