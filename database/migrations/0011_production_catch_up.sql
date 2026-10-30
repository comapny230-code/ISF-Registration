-- 0011: bring a database that was built from schema.sql / reset_database.sql (and the runtime
-- ensureTables() DDL) up to the state migrations 0001-0010 produce. Found by the read-only
-- inspection of the live project on 2026-10-30, which had no schema_migrations table.
-- Intended order there: `baseline --version 0010`, then `apply` (this file only).
--
-- Every statement is idempotent, so on a database built from the migrations this is a no-op.
--
-- 1. 0003: the booking.teams guard (a team must match its leader registration; identity
--    columns are immutable). Missing from schema.sql. Existing rows are not re-checked.
-- 2. 0001: seven indexes schema.sql does not create.
-- 3. 0009: EXECUTE on public functions revoked from PUBLIC, anon and authenticated.
-- 4. 0010: the password_hash format check (the column already exists there).
-- 5. 0006: row-level security and no Data API grants on every public table, and the default
--    privileges that 0006 revokes. The live project still had Supabase's defaults, which give
--    anon and authenticated full rights on every NEW public table.
--
-- Not changed: the extra unique indexes added at runtime (email, Aadhaar, PAN and phone per
-- edition on the leader tables; Aadhaar and PAN on user_accounts). The application relies on them.

-- 1. booking.teams guard (body identical to 0003).
create or replace function booking.teams_guard() returns trigger
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

drop trigger if exists teams_guard on booking.teams;
create trigger teams_guard
  before insert or update on booking.teams
  for each row execute function booking.teams_guard();

-- 2. Indexes from 0001 (same names and definitions).
create index if not exists idx_startup_team_leaders_email on public.startup_team_leaders (lower(email));
create index if not exists idx_startup_team_leaders_startup on public.startup_team_leaders (startup_id);
create index if not exists idx_startup_team_members_user on public.startup_team_members (user_id);
create index if not exists idx_student_innovators_email on public.student_innovators (lower(email));
create index if not exists idx_student_innovators_startup on public.student_innovators (startup_id);
create index if not exists idx_student_team_members_innovator on public.student_team_members (student_innovator_id);
create index if not exists idx_student_team_members_user on public.student_team_members (user_id);

-- 3. Function EXECUTE lockdown (same as 0009; re-run so it also covers functions created since).
do $$
declare
  fn regprocedure;
  api_role text;
begin
  for fn in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p')
  loop
    execute format('revoke execute on function %s from public', fn);
    foreach api_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format('revoke execute on function %s from %I', fn, api_role);
      end if;
    end loop;
  end loop;
  execute 'alter default privileges revoke execute on functions from public';
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('alter default privileges in schema public revoke execute on functions from %I', api_role);
    end if;
  end loop;
end
$$;

-- 4. password_hash format (same check as 0010). Adding it validates every existing row, so a
-- malformed stored hash makes this migration fail and roll back instead of being accepted.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'app_auth.admin_users'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%password_hash%'
  ) then
    alter table app_auth.admin_users
      add constraint admin_users_password_hash_check
      check (password_hash is null or password_hash ~ '^[0-9a-f]{32}:[0-9a-f]{128}$');
  end if;
end
$$;

-- 5. Public tables: RLS on, no Data API grants, and no grants on future tables (same as 0006).
do $$
declare
  rel regclass;
  api_role text;
begin
  for rel in
    select c.oid::regclass
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table %s enable row level security', rel);
    execute format('revoke all on table %s from public', rel);
    foreach api_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format('revoke all on table %s from %I', rel, api_role);
      end if;
    end loop;
  end loop;

  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on all sequences in schema public from %I', api_role);
      execute format('alter default privileges in schema public revoke all on tables from %I', api_role);
      execute format('alter default privileges in schema public revoke all on sequences from %I', api_role);
    end if;
  end loop;
end
$$;
