-- ============================================================================
-- ISF · STARTUP JATHARA 2026 — COMPLETE CLEAN DATABASE RESET SCRIPT
-- DESTROYS ALL DATA (registrations, accounts, bookings). Never run it against the live
-- project. It refuses to run unless you first run, in the same session:
--   set isf.confirm_reset = 'DELETE-ALL-DATA';
-- ============================================================================

do $$
begin
  if current_setting('isf.confirm_reset', true) is distinct from 'DELETE-ALL-DATA' then
    raise exception 'reset_database.sql refused: set isf.confirm_reset first (this deletes all data)';
  end if;
end $$;

drop schema if exists booking cascade;
drop schema if exists app_auth cascade;

drop table if exists public.student_team_members cascade;
drop table if exists public.student_innovators cascade;
drop table if exists public.startup_team_members cascade;
drop table if exists public.startup_team_leaders cascade;
drop table if exists public.startup_memberships cascade;
drop table if exists public.startups cascade;
drop table if exists public.edition_access cascade;
drop table if exists public.role_grants cascade;
drop table if exists public.user_accounts cascade;
drop table if exists public.event_editions cascade;

-- ============================================================================
-- ISF · STARTUP JATHARA 2026 — PRODUCTION DATABASE SCHEMA
-- Schemas:
--   1. public   (Registrations, Startups, Team Leaders & Members)
--   2. app_auth (Admins, Sessions, OTP Challenges, Rate Limits)
--   3. booking  (Settings, Teams, Zones, Stalls, Reservations, Audit Log)
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Schemas
create schema if not exists app_auth;
create schema if not exists booking;

-- ============================================================================
-- 1. PUBLIC REGISTRATION SYSTEM
-- ============================================================================

create table if not exists public.event_editions (
  id              smallint primary key check (id between 2026 and 2100),
  name            text not null,
  pre_event_on    date default '2026-12-17',
  event_starts_on date default '2026-12-18',
  event_ends_on   date default '2026-12-20',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

insert into public.event_editions (id, name)
values (2026, 'ISF Startup Jathara 2026 @ Dandakaranya')
on conflict (id) do nothing;

create table if not exists public.user_accounts (
  id                  uuid primary key default gen_random_uuid(),
  auth_subject        text unique,
  email               text,
  mobile_e164         text,
  full_name           text not null check (length(trim(full_name)) between 1 and 200),
  password_hash       text,
  status              text not null default 'active' check (status in ('pending_activation', 'active', 'deactivated')),
  category            text check (category in ('startup_founder', 'student_innovator', 'startup_team_member')),
  team_name           text,
  team_members        text,
  team_members_json   jsonb,
  photo_url           text,
  domain              text,
  project_details     text,
  project_report_url  text,
  aadhar_number       text,
  pan_number          text,
  alt_mobile          text,
  city                text,
  state               text,
  country             text default 'India',
  linkedin_url        text,
  id_consent_given    boolean not null default false,
  id_consent_at       timestamptz,
  id_consent_ip       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists user_accounts_email_unique on public.user_accounts (lower(email)) where email is not null;
create unique index if not exists user_accounts_aadhar_unique on public.user_accounts (aadhar_number) where aadhar_number is not null;
create unique index if not exists user_accounts_pan_unique on public.user_accounts (upper(pan_number)) where pan_number is not null;
create index if not exists idx_user_accounts_mobile on public.user_accounts (mobile_e164);
create index if not exists idx_user_accounts_category on public.user_accounts (category);

create table if not exists public.role_grants (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.user_accounts(id) on delete cascade,
  role        text not null check (role in ('startup_team_leader', 'startup_team_member')),
  edition_id  smallint references public.event_editions(id),
  granted_at  timestamptz not null default now()
);
create unique index if not exists role_grants_active_unique on public.role_grants (user_id, role, coalesce(edition_id, 0));

create table if not exists public.edition_access (
  user_id     uuid not null references public.user_accounts(id) on delete cascade,
  edition_id  smallint not null references public.event_editions(id),
  source      text not null default 'predefined',
  granted_at  timestamptz not null default now(),
  primary key (user_id, edition_id)
);

create table if not exists public.startups (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(trim(name)) between 2 and 200),
  name_normalized     text generated always as (lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) stored,
  city                text,
  state               text,
  origin              text not null default 'applicant',
  project_details     text,
  project_report_url  text,
  created_by          uuid references public.user_accounts(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_startups_name_normalized on public.startups (name_normalized);

create table if not exists public.startup_memberships (
  startup_id  uuid not null references public.startups(id) on delete cascade,
  user_id     uuid not null references public.user_accounts(id) on delete cascade,
  position    text not null check (position in ('leader', 'member')),
  created_at  timestamptz not null default now(),
  primary key (startup_id, user_id)
);

create table if not exists public.startup_team_leaders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.user_accounts(id) on delete cascade,
  startup_id          uuid references public.startups(id) on delete set null,
  team_name           text not null,
  full_name           text not null,
  email               text not null,
  mobile              text not null,
  alt_mobile          text not null,
  domain              text not null,
  project_details     text,
  project_report_url  text,
  aadhar_number       text,
  pan_number          text,
  city                text not null,
  state               text not null,
  country             text not null default 'India',
  linkedin_url        text not null,
  photo_url           text,
  edition_id          smallint default 2026 references public.event_editions(id),
  id_consent_given    boolean not null default false,
  id_consent_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_startup_team_leaders_user unique (user_id)
);
create unique index if not exists idx_startup_team_leaders_email_uq on public.startup_team_leaders (lower(email), coalesce(edition_id, 2026));
create unique index if not exists idx_startup_team_leaders_aadhar_uq on public.startup_team_leaders (aadhar_number, coalesce(edition_id, 2026)) where aadhar_number is not null;
create unique index if not exists idx_startup_team_leaders_pan_uq on public.startup_team_leaders (upper(pan_number), coalesce(edition_id, 2026)) where pan_number is not null;
create index if not exists idx_startup_team_leaders_phone on public.startup_team_leaders (mobile);

create table if not exists public.startup_team_members (
  id              uuid primary key default gen_random_uuid(),
  startup_id      uuid references public.startups(id) on delete cascade,
  leader_user_id  uuid not null references public.user_accounts(id) on delete cascade,
  user_id         uuid references public.user_accounts(id) on delete cascade,
  name            text not null,
  photo_url       text,
  phone           text not null,
  email           text not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_startup_team_members_leader on public.startup_team_members (leader_user_id);
create index if not exists idx_startup_team_members_email on public.startup_team_members (lower(email));

create table if not exists public.student_innovators (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.user_accounts(id) on delete cascade,
  startup_id          uuid references public.startups(id) on delete set null,
  team_name           text not null,
  full_name           text not null,
  email               text not null,
  mobile              text not null,
  alt_mobile          text not null,
  domain              text not null,
  project_details     text,
  project_report_url  text,
  aadhar_number       text,
  pan_number          text,
  city                text not null,
  state               text not null,
  country             text not null default 'India',
  linkedin_url        text not null,
  photo_url           text,
  edition_id          smallint default 2026 references public.event_editions(id),
  id_consent_given    boolean not null default false,
  id_consent_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_student_innovators_user unique (user_id)
);
create unique index if not exists idx_student_innovators_email_uq on public.student_innovators (lower(email), coalesce(edition_id, 2026));
create unique index if not exists idx_student_innovators_aadhar_uq on public.student_innovators (aadhar_number, coalesce(edition_id, 2026)) where aadhar_number is not null;
create unique index if not exists idx_student_innovators_pan_uq on public.student_innovators (upper(pan_number), coalesce(edition_id, 2026)) where pan_number is not null;
create index if not exists idx_student_innovators_phone on public.student_innovators (mobile);

create table if not exists public.student_team_members (
  id                    uuid primary key default gen_random_uuid(),
  student_innovator_id  uuid references public.student_innovators(id) on delete cascade,
  leader_user_id        uuid not null references public.user_accounts(id) on delete cascade,
  user_id               uuid references public.user_accounts(id) on delete cascade,
  team_name             text,
  name                  text not null,
  photo_url             text,
  phone                 text not null,
  email                 text not null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_student_team_members_leader on public.student_team_members (leader_user_id);
create index if not exists idx_student_team_members_email on public.student_team_members (lower(email));

-- ============================================================================
-- 2. APP AUTHENTICATION SCHEMA (app_auth)
-- ============================================================================

create table if not exists app_auth.admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  display_name  text not null check (length(btrim(display_name)) between 1 and 200),
  password_hash text,
  status        text not null default 'active' check (status in ('active', 'disabled')),
  created_at    timestamptz not null default now(),
  created_by    text not null check (length(btrim(created_by)) > 0),
  disabled_at   timestamptz,
  check ((status = 'disabled') = (disabled_at is not null))
);
alter table app_auth.admin_users add column if not exists password_hash text;

create table if not exists app_auth.admin_grants (
  id            bigint generated always as identity primary key,
  admin_user_id uuid not null references app_auth.admin_users(id) on delete restrict,
  permission    text not null check (permission in ('booking.cancel', 'inventory.manage', 'teams.manage', 'reports.view')),
  granted_at    timestamptz not null default now(),
  granted_by    text not null check (length(btrim(granted_by)) > 0),
  revoked_at    timestamptz,
  revoked_by    text,
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index if not exists admin_grants_active_uq on app_auth.admin_grants (admin_user_id, permission) where revoked_at is null;

create table if not exists app_auth.login_challenges (
  id            uuid primary key,
  audience      text not null check (audience in ('leader', 'admin')),
  email         text not null check (email = lower(btrim(email))),
  user_id       uuid references public.user_accounts(id) on delete cascade,
  admin_user_id uuid references app_auth.admin_users(id) on delete cascade,
  code_mac      bytea not null,
  binding_hash  bytea check (binding_hash is null or octet_length(binding_hash) = 32),
  created_at    timestamptz not null default clock_timestamp(),
  expires_at    timestamptz not null,
  attempts      smallint not null default 0 check (attempts between 0 and 5),
  consumed_at   timestamptz,
  superseded_at timestamptz,
  check ((audience = 'leader' and user_id is not null and admin_user_id is null)
      or (audience = 'admin'  and admin_user_id is not null and user_id is null)),
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index if not exists login_challenges_active_ix on app_auth.login_challenges (audience, email, created_at desc)
  where consumed_at is null and superseded_at is null;
create index if not exists login_challenges_binding_ix on app_auth.login_challenges (audience, email, binding_hash, created_at desc)
  where consumed_at is null and superseded_at is null;

create table if not exists app_auth.sessions (
  id                  uuid primary key default gen_random_uuid(),
  token_hash          bytea not null unique,
  principal_type      text not null check (principal_type in ('leader', 'admin')),
  user_id             uuid references public.user_accounts(id) on delete cascade,
  admin_user_id       uuid references app_auth.admin_users(id) on delete cascade,
  created_at          timestamptz not null default clock_timestamp(),
  last_seen_at        timestamptz not null default clock_timestamp(),
  idle_expires_at     timestamptz not null,
  absolute_expires_at timestamptz not null,
  reauth_at           timestamptz not null default clock_timestamp(),
  revoked_at          timestamptz,
  revoke_reason       text,
  check ((principal_type = 'leader' and user_id is not null and admin_user_id is null)
      or (principal_type = 'admin'  and admin_user_id is not null and user_id is null)),
  check (idle_expires_at <= absolute_expires_at),
  check ((revoked_at is null) = (revoke_reason is null))
);
create index if not exists sessions_user_live_ix  on app_auth.sessions (user_id, created_at desc)       where revoked_at is null;
create index if not exists sessions_admin_live_ix on app_auth.sessions (admin_user_id, created_at desc) where revoked_at is null;

create table if not exists app_auth.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);

create table if not exists app_auth.registration_email_challenges (
  id            uuid primary key,
  email         text not null check (email = lower(btrim(email))),
  code_mac      bytea not null,
  binding_hash  bytea not null check (octet_length(binding_hash) = 32),
  created_at    timestamptz not null default clock_timestamp(),
  expires_at    timestamptz not null,
  attempts      smallint not null default 0 check (attempts between 0 and 5),
  verified_at   timestamptz,
  consumed_at   timestamptz,
  superseded_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  check (consumed_at is null or verified_at is not null)
);
create index if not exists registration_email_challenges_active_ix
  on app_auth.registration_email_challenges (email, binding_hash, created_at desc)
  where consumed_at is null and superseded_at is null;

-- ============================================================================
-- 3. BOOKING SCHEMA (booking)
-- ============================================================================

create table if not exists booking.teams (
  id                     uuid primary key default gen_random_uuid(),
  edition_id             smallint not null references public.event_editions(id) on delete restrict,
  leader_user_id         uuid not null references public.user_accounts(id) on delete restrict,
  track                  text not null check (track in ('senior', 'junior')),
  startup_team_leader_id uuid references public.startup_team_leaders(id) on delete restrict,
  student_innovator_id   uuid references public.student_innovators(id) on delete restrict,
  team_name_snapshot     text not null check (length(btrim(team_name_snapshot)) between 1 and 200),
  approval_status        text not null default 'approved' check (approval_status in ('pending', 'approved', 'rejected')),
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

create table if not exists booking.settings (
  edition_id                smallint primary key references public.event_editions(id) on delete restrict,
  booking_enabled           boolean not null default false,
  opens_at                  timestamptz,
  closes_at                 timestamptz,
  hold_seconds              integer not null default 300 check (hold_seconds between 2 and 900),
  eligible_tracks           text[]  not null default '{}' check (eligible_tracks <@ array['senior', 'junior']::text[]),
  require_team_approval     boolean not null default false,
  rehold_cooldown_seconds   integer not null default 600 check (rehold_cooldown_seconds between 0 and 86400),
  max_new_holds_per_hour    integer not null default 6 check (max_new_holds_per_hour between 1 and 100),
  public_map                boolean not null default true,
  show_hold_expiry_publicly boolean not null default false,
  updated_at                timestamptz not null default now(),
  updated_by                text not null,
  check (opens_at is null or closes_at is null or closes_at > opens_at),
  check (not booking_enabled or (opens_at is not null and closes_at is not null and cardinality(eligible_tracks) > 0))
);

create table if not exists booking.zones (
  id               uuid primary key default gen_random_uuid(),
  edition_id       smallint not null references public.event_editions(id) on delete restrict,
  code             text not null check (code ~ '^[A-Z]{2}$'),
  name             text not null check (length(btrim(name)) between 1 and 120),
  frame_definition text,
  extent_width_ft  numeric(7,2) check (extent_width_ft > 0),
  extent_depth_ft  numeric(7,2) check (extent_depth_ft > 0),
  landmarks        jsonb not null default '[]'::jsonb check (jsonb_typeof(landmarks) = 'array'),
  inventory_status text not null default 'approved' check (inventory_status in ('provisional', 'approved', 'retired')),
  source_ref       text not null,
  unique (edition_id, code),
  unique (id, edition_id)
);

create table if not exists booking.stalls (
  id               uuid primary key default gen_random_uuid(),
  edition_id       smallint not null,
  zone_id          uuid not null,
  code             text not null check (code ~ '^[A-Z]{2}-[A-Z][0-9]{2}$'),
  width_ft         numeric(5,2) not null default 10 check (width_ft > 0),
  depth_ft         numeric(5,2) not null default 10 check (depth_ft > 0),
  x_ft             numeric(7,2),
  y_ft             numeric(7,2),
  rotation_deg     numeric(5,2) check (rotation_deg >= 0 and rotation_deg < 360),
  inventory_status text not null default 'approved' check (inventory_status in ('provisional', 'approved', 'retired')),
  admin_status     text not null default 'active' check (admin_status in ('active', 'disabled')),
  disabled_reason  text,
  disabled_at      timestamptz,
  disabled_by      uuid references app_auth.admin_users(id) on delete restrict,
  bookable         boolean generated always as (inventory_status = 'approved' and admin_status = 'active') stored,
  source_ref       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (zone_id, edition_id) references booking.zones(id, edition_id) on delete restrict,
  unique (edition_id, code),
  unique (id, edition_id),
  check (inventory_status <> 'approved' or (x_ft is not null and y_ft is not null and rotation_deg is not null)),
  check ((admin_status = 'disabled') = (disabled_at is not null and disabled_reason is not null))
);

create table if not exists booking.reservations (
  id                    uuid primary key default gen_random_uuid(),
  edition_id            smallint not null,
  stall_id              uuid not null,
  team_id               uuid not null,
  created_by_user_id    uuid not null references public.user_accounts(id) on delete restrict,
  status                text not null check (status in ('held', 'confirmed', 'released', 'expired', 'cancelled')),
  held_at               timestamptz not null,
  expires_at            timestamptz not null,
  confirmed_at          timestamptz,
  confirmed_by_user_id  uuid references public.user_accounts(id) on delete restrict,
  booking_id            uuid,
  booking_ref           text check (booking_ref ~ '^SJ26-[0-9A-HJKMNP-TV-Z]{8}$'),
  released_at           timestamptz,
  release_reason        text check (release_reason in ('leader', 'admin_disable')),
  released_by_user_id   uuid references public.user_accounts(id) on delete restrict,
  released_by_admin_id  uuid references app_auth.admin_users(id) on delete restrict,
  expired_at            timestamptz,
  cancelled_at          timestamptz,
  cancelled_by_admin_id uuid references app_auth.admin_users(id) on delete restrict,
  cancel_reason         text check (length(btrim(cancel_reason)) between 10 and 500),
  cancel_request_id     uuid,
  foreign key (stall_id, edition_id) references booking.stalls(id, edition_id) on delete restrict,
  foreign key (team_id, edition_id) references booking.teams(id, edition_id) on delete restrict,
  constraint reservations_booking_id_uq unique (booking_id),
  constraint reservations_booking_ref_uq unique (booking_ref),
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

create unique index if not exists reservations_live_stall_uq on booking.reservations (stall_id) where status in ('held', 'confirmed');
create unique index if not exists reservations_live_team_uq  on booking.reservations (team_id)  where status in ('held', 'confirmed');
create index if not exists reservations_team_history_ix on booking.reservations (team_id, held_at desc);
create index if not exists reservations_team_stall_ix   on booking.reservations (team_id, stall_id, held_at desc);

create table if not exists booking.audit_events (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default clock_timestamp(),
  edition_id     smallint not null references public.event_editions(id) on delete restrict,
  action         text not null check (action in ('hold_created', 'hold_released', 'hold_expired', 'booking_confirmed',
                   'booking_cancelled', 'stall_disabled', 'stall_enabled', 'team_approval_changed', 'settings_changed',
                   'inventory_changed', 'admin_grant_changed', 'team_created')),
  actor_type     text not null check (actor_type in ('leader', 'admin', 'system', 'operator')),
  actor_user_id  uuid references public.user_accounts(id) on delete restrict,
  actor_admin_id uuid references app_auth.admin_users(id) on delete restrict,
  actor_operator text,
  team_id        uuid references booking.teams(id) on delete restrict,
  stall_id       uuid references booking.stalls(id) on delete restrict,
  reservation_id uuid references booking.reservations(id) on delete restrict,
  request_id     uuid,
  reason         text,
  details        jsonb not null default '{}'::jsonb,
  check ((actor_type = 'leader')   = (actor_user_id  is not null)),
  check ((actor_type = 'admin')    = (actor_admin_id is not null)),
  check ((actor_type = 'operator') = (actor_operator is not null))
);
create index if not exists audit_events_reservation_ix on booking.audit_events (reservation_id);
create index if not exists audit_events_time_ix        on booking.audit_events (occurred_at desc);

-- ============================================================================
-- 4. CONCURRENCY & BUSINESS INVARIANT TRIGGERS
-- ============================================================================

create or replace function booking.reservations_guard() returns trigger
language plpgsql as $$
declare
  now_ts         timestamptz := clock_timestamp();
  hold_secs      integer;
  stall_bookable boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'reservations are append-only' using errcode = 'BK004';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'held' then
      raise exception 'new reservations must be holds' using errcode = 'BK005', hint = 'not_held';
    end if;
    select hold_seconds into hold_secs from booking.settings where edition_id = new.edition_id;
    if hold_secs is null then
      raise exception 'booking settings missing' using errcode = 'BK005', hint = 'no_settings';
    end if;
    if new.held_at > now_ts or new.held_at < now_ts - interval '10 seconds' then
      raise exception 'held_at must be the current database time' using errcode = 'BK005', hint = 'stale_held_at';
    end if;
    if new.expires_at <> new.held_at + make_interval(secs => hold_secs) then
      raise exception 'expires_at must equal held_at + hold_seconds' using errcode = 'BK005', hint = 'bad_expiry';
    end if;
    select bookable into stall_bookable from booking.stalls where id = new.stall_id;
    if not coalesce(stall_bookable, false) then
      raise exception 'stall is not bookable' using errcode = 'BK005', hint = 'stall_not_bookable';
    end if;
    return new;
  end if;

  if (new.id, new.edition_id, new.stall_id, new.team_id, new.created_by_user_id, new.held_at, new.expires_at)
     is distinct from
     (old.id, old.edition_id, old.stall_id, old.team_id, old.created_by_user_id, old.held_at, old.expires_at) then
    raise exception 'reservation identity columns are immutable' using errcode = 'BK003';
  end if;

  if old.status = 'held' and new.status = 'confirmed' then
    if now_ts >= old.expires_at then
      raise exception 'hold expired before confirmation' using errcode = 'BK002';
    end if;
    if new.confirmed_at > now_ts then
      raise exception 'confirmed_at is in the future' using errcode = 'BK001';
    end if;
    select bookable into stall_bookable from booking.stalls where id = new.stall_id;
    if not coalesce(stall_bookable, false) then
      raise exception 'stall is not bookable' using errcode = 'BK005', hint = 'stall_not_bookable';
    end if;
    return new;
  elsif old.status = 'held' and new.status = 'released' then
    return new;
  elsif old.status = 'held' and new.status = 'expired' then
    if now_ts < old.expires_at then
      raise exception 'hold has not expired yet' using errcode = 'BK006';
    end if;
    return new;
  elsif old.status = 'confirmed' and new.status = 'cancelled' then
    if (new.confirmed_at, new.confirmed_by_user_id, new.booking_id, new.booking_ref)
       is distinct from (old.confirmed_at, old.confirmed_by_user_id, old.booking_id, old.booking_ref) then
      raise exception 'booking columns are immutable' using errcode = 'BK003';
    end if;
    return new;
  end if;

  raise exception 'illegal reservation transition % -> %', old.status, new.status using errcode = 'BK001';
end
$$;

drop trigger if exists reservations_guard on booking.reservations;
create trigger reservations_guard
  before insert or update or delete on booking.reservations
  for each row execute function booking.reservations_guard();

create or replace function booking.audit_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit events are append-only' using errcode = 'BK007';
end
$$;

drop trigger if exists audit_events_append_only on booking.audit_events;
create trigger audit_events_append_only
  before update or delete on booking.audit_events
  for each row execute function booking.audit_events_append_only();

create or replace function booking.stalls_guard() returns trigger
language plpgsql as $$
begin
  if (new.id, new.edition_id, new.code, new.zone_id) is distinct from (old.id, old.edition_id, old.code, old.zone_id) then
    raise exception 'stall identity columns are immutable' using errcode = 'BK003';
  end if;
  if new.inventory_status is distinct from old.inventory_status then
    if not ((old.inventory_status = 'provisional' and new.inventory_status in ('approved', 'retired'))
         or (old.inventory_status = 'approved' and new.inventory_status = 'retired')) then
      raise exception 'illegal inventory transition % -> %', old.inventory_status, new.inventory_status using errcode = 'BK001';
    end if;
    if new.inventory_status = 'retired'
       and exists (select 1 from booking.reservations r where r.stall_id = old.id and r.status in ('held', 'confirmed')) then
      raise exception 'stall has a live reservation' using errcode = 'BK009';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists stalls_guard on booking.stalls;
create trigger stalls_guard
  before update on booking.stalls
  for each row execute function booking.stalls_guard();

-- ============================================================================
-- 5. MINIMAL ESSENTIAL INITIALIZATION (Clean & Empty for Manual Testing)
-- ============================================================================

-- Default booking configuration for 2026 Edition
insert into booking.settings (
  edition_id, booking_enabled, opens_at, closes_at,
  hold_seconds, eligible_tracks, require_team_approval,
  rehold_cooldown_seconds, max_new_holds_per_hour, public_map, updated_by
)
values (
  2026, true, '2026-01-01 00:00:00+00', '2026-12-31 23:59:59+00',
  300, array['senior', 'junior']::text[], false, 600, 6, true, 'schema-init'
)
on conflict (edition_id) do update set
  booking_enabled = true,
  require_team_approval = false;

-- Base Event Zones with exact landmarks from PDF layout
insert into booking.zones (edition_id, code, name, extent_width_ft, extent_depth_ft, landmarks, inventory_status, source_ref)
values
  (2026, 'PG', 'Playground GIET University', 338, 402, '[{"label":"67 FT Stage","kind":"stage","x":2,"y":180,"w":14,"d":67},{"label":"FIELD ENTRY","kind":"entry","x":0,"y":250,"w":20,"d":15},{"label":"135 FT OPEN SPACE TOWARDS AGRICULTURE LAND","kind":"open_space","x":2,"y":270,"w":35,"d":125},{"label":"HELIPAD","kind":"restricted","x":220,"y":305,"w":105,"d":85}]'::jsonb, 'provisional', 'master'),
  (2026, 'BB', 'Rang Manch / Basketball Ground', 101, 305, '[{"label":"RANG MANCH (101 FT)","kind":"stage","x":25,"y":0,"w":51,"d":18},{"label":"MECHANICAL ROAD 305 FT","kind":"road","x":2,"y":15,"w":10,"d":260},{"label":"ENTRY","kind":"entry","x":44,"y":18,"w":4,"d":260},{"label":"EXIT","kind":"exit","x":53,"y":18,"w":4,"d":260},{"label":"ISF STALL","kind":"reserved","x":12,"y":265,"w":30,"d":18},{"label":"MEETING ROOM","kind":"reserved","x":52,"y":265,"w":45,"d":18},{"label":"BUS-STAND ROAD 101 FT","kind":"road","x":0,"y":286,"w":101,"d":19}]'::jsonb, 'provisional', 'master')
on conflict (edition_id, code) do update set
  name = excluded.name,
  extent_width_ft = excluded.extent_width_ft,
  extent_depth_ft = excluded.extent_depth_ft,
  landmarks = excluded.landmarks,
  inventory_status = 'approved';

-- Admin users for /admin portal. No administrator is seeded; create one with
-- ADMIN_BOOTSTRAP_PASSWORD=... npm run db:create-admin -- <email> (frontend-web/scripts/create-admin.mts)
alter table if exists app_auth.admin_users add column if not exists password_hash text;

-- Stalls from PDF layout: 48 in Playground GIET University, 50 in Basketball Ground
-- PG-A01 to PG-A30 (Top horizontal run of 30 stalls)
insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
select 2026, z.id, 'PG-A' || to_char(i, 'FM00'), 10, 10, 16 + (i - 1) * 10, 0, 0, 'provisional', 'pdf-map'
from booking.zones z, generate_series(1, 30) as i
where z.code = 'PG' and z.edition_id = 2026
on conflict (edition_id, code) do update set x_ft = excluded.x_ft, y_ft = excluded.y_ft, inventory_status = 'approved';

-- PG-B01 to PG-B18 (Left vertical run of 18 stalls)
insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
select 2026, z.id, 'PG-B' || to_char(i, 'FM00'), 10, 10, 6, (i - 1) * 10, 0, 'provisional', 'pdf-map'
from booking.zones z, generate_series(1, 18) as i
where z.code = 'PG' and z.edition_id = 2026
on conflict (edition_id, code) do update set x_ft = excluded.x_ft, y_ft = excluded.y_ft, inventory_status = 'approved';

-- BB-A01 to BB-A25 (Left vertical run of 25 stalls)
insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
select 2026, z.id, 'BB-A' || to_char(i, 'FM00'), 10, 10, 16, 12 + (i - 1) * 10, 0, 'provisional', 'pdf-map'
from booking.zones z, generate_series(1, 25) as i
where z.code = 'BB' and z.edition_id = 2026
on conflict (edition_id, code) do update set x_ft = excluded.x_ft, y_ft = excluded.y_ft, inventory_status = 'approved';

-- BB-B01 to BB-B25 (Right vertical run of 25 stalls)
insert into booking.stalls (edition_id, zone_id, code, width_ft, depth_ft, x_ft, y_ft, rotation_deg, inventory_status, source_ref)
select 2026, z.id, 'BB-B' || to_char(i, 'FM00'), 10, 10, 72, 12 + (i - 1) * 10, 0, 'provisional', 'pdf-map'
from booking.zones z, generate_series(1, 25) as i
where z.code = 'BB' and z.edition_id = 2026
on conflict (edition_id, code) do update set x_ft = excluded.x_ft, y_ft = excluded.y_ft, inventory_status = 'approved';
