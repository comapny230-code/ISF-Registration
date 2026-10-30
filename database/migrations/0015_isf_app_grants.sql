-- 0015 (was 0012 on main, renumbered after this branch's 0010-0013): grant schema and table permissions to the isf_app role if it exists.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'isf_app') then
    grant usage on schema public, app_auth, booking to isf_app;

    grant select, insert, update on
      public.user_accounts, public.role_grants, public.edition_access, public.startups, public.startup_memberships,
      public.startup_team_leaders, public.student_innovators, public.startup_team_members, public.student_team_members
      to isf_app;
    grant select on public.event_editions to isf_app;
    grant usage, select on sequence public.role_grants_id_seq to isf_app;

    grant select, insert, update, delete on app_auth.login_challenges, app_auth.rate_limits, app_auth.registration_email_challenges to isf_app;
    grant select, insert, update on app_auth.sessions to isf_app;
    grant select on app_auth.admin_users, app_auth.admin_grants to isf_app;
    -- Administrator passwords and adding administrators from the admin page (0010).
    grant update (password_hash) on app_auth.admin_users to isf_app;
    grant insert on app_auth.admin_users, app_auth.admin_grants to isf_app;

    grant select on booking.settings, booking.zones to isf_app;
    grant select on booking.stalls to isf_app;
    grant update (admin_status, disabled_reason, disabled_at, disabled_by, updated_at) on booking.stalls to isf_app;
    grant select, insert on booking.teams to isf_app;
    grant update (approval_status, approval_changed_at, approval_changed_by, updated_at) on booking.teams to isf_app;
    grant select, insert, update on booking.reservations to isf_app;
    grant select, insert on booking.audit_events to isf_app;
    grant usage, select on sequence booking.audit_events_id_seq to isf_app;
  end if;
end
$$;
