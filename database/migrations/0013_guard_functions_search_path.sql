-- 0013: fix Supabase security advisor warning on mutable search_path for database guard functions.
-- Hardens booking guard and trigger functions with an explicit, immutable search_path.

create or replace function booking.reservations_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public, booking as $$
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

create or replace function booking.audit_events_append_only() returns trigger
language plpgsql
set search_path = pg_catalog, public, booking as $$
begin
  raise exception 'audit events are append-only' using errcode = 'BK007';
end
$$;

create or replace function booking.stalls_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public, booking as $$
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
