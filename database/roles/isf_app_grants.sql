-- Least-privilege runtime role isf_app (spec §2.6, blocker B-08, launch gate LG-03).
--
-- [INFRA] first creates the role with a strong password in the Supabase SQL editor (the password is
-- never in git), e.g.:   create role isf_app login password '<generated>' noinherit;
-- then runs THIS script as the schema owner, after all migrations, and re-runs it after any later
-- migration that adds tables. Idempotent.
--
-- What the app may do as isf_app (derived from every query in frontend-web/lib and app):
--   * read and write registration rows, never delete them, never run DDL;
--   * create and use sign-in codes, sessions, rate-limit counters and registration codes;
--   * READ ONLY on admin accounts and grants (an attacker in the app cannot create or promote admins);
--   * read booking settings and zones; change only a stall's availability and a team's approval;
--   * create and update reservations (the database triggers still enforce every state rule);
--   * append to the audit log (it can never be updated or deleted).
-- Row-level security (migration 0006) stays on; isf_app gets an explicit allow-all policy on the
-- registration tables, while anon/authenticated still see nothing.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'isf_app') then
    raise exception 'create the isf_app role first (see the header of this script)';
  end if;
  if (select rolsuper or rolbypassrls or rolcreaterole or rolcreatedb from pg_roles where rolname = 'isf_app') then
    raise exception 'isf_app must not be a superuser, bypass RLS, or create roles or databases';
  end if;
end
$$;

grant usage on schema public, app_auth, booking to isf_app;

-- Registration data (public). No DELETE, no TRUNCATE, no DDL.
grant select, insert, update on
  public.user_accounts, public.role_grants, public.edition_access, public.startups, public.startup_memberships,
  public.startup_team_leaders, public.student_innovators, public.startup_team_members, public.student_team_members
  to isf_app;
grant select on public.event_editions to isf_app;
grant usage, select on sequence public.role_grants_id_seq to isf_app;

do $$
declare
  t text;
begin
  foreach t in array array['user_accounts', 'role_grants', 'edition_access', 'startups', 'startup_memberships',
                           'startup_team_leaders', 'student_innovators', 'startup_team_members', 'student_team_members',
                           'event_editions'] loop
    execute format('drop policy if exists isf_app_all on public.%I', t);
    execute format('create policy isf_app_all on public.%I for all to isf_app using (true) with check (true)', t);
  end loop;
end
$$;

-- Sign-in and abuse protection.
grant select, insert, update, delete on app_auth.login_challenges, app_auth.rate_limits, app_auth.registration_email_challenges to isf_app;
grant select, insert, update on app_auth.sessions to isf_app;
grant select on app_auth.admin_users, app_auth.admin_grants to isf_app;

-- Booking.
grant select on booking.settings, booking.zones to isf_app;
grant select on booking.stalls to isf_app;
grant update (admin_status, disabled_reason, disabled_at, disabled_by, updated_at) on booking.stalls to isf_app;
grant select, insert on booking.teams to isf_app;
grant update (approval_status, approval_changed_at, approval_changed_by, updated_at) on booking.teams to isf_app;
grant select, insert, update on booking.reservations to isf_app;
grant select, insert on booking.audit_events to isf_app;
grant usage, select on sequence booking.audit_events_id_seq to isf_app;

commit;
