-- 0003_identity_and_auth.sql
-- Administrators, one-time login codes, sessions, rate-limit counters and the
-- edition-scoped team identity used by stall booking.
-- docs/STALL_BOOKING_FINAL_SPEC.md §2.3

-- Administrators are deliberately separate from public.user_accounts so that the
-- unauthenticated registration flow can never create, modify or promote them.
create table app_auth.admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(btrim(email)) and position('@' in email) > 1),
  display_name  text not null check (length(btrim(display_name)) between 1 and 200),
  status        text not null default 'active' check (status in ('active', 'disabled')),
  created_at    timestamptz not null default now(),
  created_by    text not null check (length(btrim(created_by)) > 0),
  disabled_at   timestamptz,
  check ((status = 'disabled') = (disabled_at is not null))
);

create table app_auth.admin_grants (
  id            bigint generated always as identity primary key,
  admin_user_id uuid not null references app_auth.admin_users(id) on delete restrict,
  permission    text not null check (permission in ('booking.cancel', 'inventory.manage', 'teams.manage', 'reports.view')),
  granted_at    timestamptz not null default now(),
  granted_by    text not null check (length(btrim(granted_by)) > 0),
  revoked_at    timestamptz,
  revoked_by    text,
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index admin_grants_active_uq on app_auth.admin_grants (admin_user_id, permission) where revoked_at is null;

create table app_auth.login_challenges (
  id            uuid primary key,
  audience      text not null check (audience in ('leader', 'admin')),
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
create index sessions_user_live_ix  on app_auth.sessions (user_id, created_at desc)       where revoked_at is null;
create index sessions_admin_live_ix on app_auth.sessions (admin_user_id, created_at desc) where revoked_at is null;

create table app_auth.rate_limits (
  bucket       text not null,        -- keyed HMAC of the subject; never a raw email or IP
  window_start timestamptz not null,
  hits         integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);

-- A team for an edition IS exactly one leader registration row.
create table booking.teams (
  id                     uuid primary key default gen_random_uuid(),
  edition_id             smallint not null references public.event_editions(id) on delete restrict,
  leader_user_id         uuid not null references public.user_accounts(id) on delete restrict,
  track                  text not null check (track in ('senior', 'junior')),
  startup_team_leader_id uuid references public.startup_team_leaders(id) on delete restrict,
  student_innovator_id   uuid references public.student_innovators(id) on delete restrict,
  team_name_snapshot     text not null check (length(btrim(team_name_snapshot)) between 1 and 200),
  approval_status        text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
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

create function booking.teams_guard() returns trigger
language plpgsql as $$
declare
  source_user    uuid;
  source_edition smallint;
begin
  if tg_op = 'INSERT' then
    if new.track = 'senior' then
      select user_id, edition_id into source_user, source_edition
        from public.startup_team_leaders where id = new.startup_team_leader_id;
    else
      select user_id, edition_id into source_user, source_edition
        from public.student_innovators where id = new.student_innovator_id;
    end if;
    if source_user is distinct from new.leader_user_id or source_edition is distinct from new.edition_id then
      raise exception 'team does not match its leader registration' using errcode = 'BK008';
    end if;
    return new;
  end if;

  if (new.id, new.edition_id, new.leader_user_id, new.track,
      new.startup_team_leader_id, new.student_innovator_id, new.created_at)
     is distinct from
     (old.id, old.edition_id, old.leader_user_id, old.track,
      old.startup_team_leader_id, old.student_innovator_id, old.created_at) then
    raise exception 'team identity columns are immutable' using errcode = 'BK003';
  end if;
  return new;
end
$$;

create trigger teams_guard
  before insert or update on booking.teams
  for each row execute function booking.teams_guard();
