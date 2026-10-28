-- 0004_booking_core.sql
-- Stall inventory, holds/bookings and the append-only audit log.
-- docs/STALL_BOOKING_FINAL_SPEC.md §2.4 and §4.
--
-- Invariants enforced here, independently of application code and of time:
--   * at most one live (held or confirmed) reservation per stall      -> reservations_live_stall_uq
--   * at most one live reservation per team (one hold OR one booking) -> reservations_live_team_uq
--   * a hold cannot be confirmed at or after its expiry                -> reservations_state_ck + BK002
--   * only legal state transitions; reservations and audit rows are never deleted

create table booking.settings (
  edition_id                smallint primary key references public.event_editions(id) on delete restrict,
  booking_enabled           boolean not null default false,
  opens_at                  timestamptz,
  closes_at                 timestamptz,
  -- Values below 300 exist only so tests can exercise real expiry quickly;
  -- production refuses to book unless this is 300 (lib/booking/service.ts).
  hold_seconds              integer not null default 300 check (hold_seconds between 2 and 900),
  eligible_tracks           text[]  not null default '{}' check (eligible_tracks <@ array['senior', 'junior']::text[]),
  require_team_approval     boolean not null default true,
  rehold_cooldown_seconds   integer not null default 600 check (rehold_cooldown_seconds between 0 and 86400),
  max_new_holds_per_hour    integer not null default 6 check (max_new_holds_per_hour between 1 and 100),
  public_map                boolean not null default false,
  show_hold_expiry_publicly boolean not null default false,
  updated_at                timestamptz not null default now(),
  updated_by                text not null,
  check (opens_at is null or closes_at is null or closes_at > opens_at),
  check (not booking_enabled or (opens_at is not null and closes_at is not null and cardinality(eligible_tracks) > 0))
);

create table booking.zones (
  id               uuid primary key default gen_random_uuid(),
  edition_id       smallint not null references public.event_editions(id) on delete restrict,
  code             text not null check (code ~ '^[A-Z]{2}$'),
  name             text not null check (length(btrim(name)) between 1 and 120),
  frame_definition text,
  extent_width_ft  numeric(7,2) check (extent_width_ft > 0),
  extent_depth_ft  numeric(7,2) check (extent_depth_ft > 0),
  landmarks        jsonb not null default '[]'::jsonb check (jsonb_typeof(landmarks) = 'array'),
  inventory_status text not null default 'provisional' check (inventory_status in ('provisional', 'approved', 'retired')),
  source_ref       text not null,
  unique (edition_id, code),
  unique (id, edition_id)
);

create table booking.stalls (
  id               uuid primary key default gen_random_uuid(),
  edition_id       smallint not null,
  zone_id          uuid not null,
  code             text not null check (code ~ '^[A-Z]{2}-[A-Z][0-9]{2}$'),
  width_ft         numeric(5,2) not null default 10 check (width_ft > 0),
  depth_ft         numeric(5,2) not null default 10 check (depth_ft > 0),
  x_ft             numeric(7,2),
  y_ft             numeric(7,2),
  rotation_deg     numeric(5,2) check (rotation_deg >= 0 and rotation_deg < 360),
  inventory_status text not null default 'provisional' check (inventory_status in ('provisional', 'approved', 'retired')),
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

create table booking.reservations (
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
create unique index reservations_live_stall_uq on booking.reservations (stall_id) where status in ('held', 'confirmed');
create unique index reservations_live_team_uq  on booking.reservations (team_id)  where status in ('held', 'confirmed');
create index reservations_team_history_ix on booking.reservations (team_id, held_at desc);
create index reservations_team_stall_ix   on booking.reservations (team_id, stall_id, held_at desc);

create table booking.audit_events (
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
create index audit_events_reservation_ix on booking.audit_events (reservation_id);
create index audit_events_time_ix        on booking.audit_events (occurred_at desc);

-- ---------------------------------------------------------------------------
-- Reservation state machine (spec §2.4 trigger table). clock_timestamp() is read
-- at write time, i.e. after the caller holds the row lock, so a transaction that
-- began before expiry but waited for a lock can never confirm an expired hold.
-- ---------------------------------------------------------------------------
create function booking.reservations_guard() returns trigger
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

create trigger reservations_guard
  before insert or update or delete on booking.reservations
  for each row execute function booking.reservations_guard();

create function booking.audit_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit events are append-only' using errcode = 'BK007';
end
$$;

create trigger audit_events_append_only
  before update or delete on booking.audit_events
  for each row execute function booking.audit_events_append_only();

create function booking.stalls_guard() returns trigger
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

create trigger stalls_guard
  before update on booking.stalls
  for each row execute function booking.stalls_guard();
