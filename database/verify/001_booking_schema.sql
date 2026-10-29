-- Post-migration verification (run: node scripts/migrate.mts verify --target <...>).
-- Every row must have ok = true. Read-only.
select 'schema app_auth exists' as check_name, exists (select 1 from pg_namespace where nspname = 'app_auth') as ok, null::text as detail
union all select 'schema booking exists', exists (select 1 from pg_namespace where nspname = 'booking'), null
union all select 'table ' || t, to_regclass(t) is not null, null
  from unnest(array['app_auth.admin_users', 'app_auth.admin_grants', 'app_auth.login_challenges', 'app_auth.sessions',
                    'app_auth.rate_limits', 'booking.teams', 'booking.settings', 'booking.zones', 'booking.stalls',
                    'booking.reservations', 'booking.audit_events']) as t
union all select 'index ' || i, exists (select 1 from pg_indexes where schemaname = 'booking' and indexname = i), null
  from unnest(array['reservations_live_stall_uq', 'reservations_live_team_uq']) as i
union all select 'constraint reservations_state_ck',
  exists (select 1 from pg_constraint where conname = 'reservations_state_ck' and conrelid = 'booking.reservations'::regclass), null
union all select 'trigger ' || g, exists (select 1 from pg_trigger where tgname = g and not tgisinternal), null
  from unnest(array['reservations_guard', 'audit_events_append_only', 'stalls_guard', 'teams_guard']) as g
union all select 'booking settings row for 2026', exists (select 1 from booking.settings where edition_id = 2026), null
union all select 'no approved stall lacks geometry',
  not exists (select 1 from booking.stalls where inventory_status = 'approved' and (x_ft is null or y_ft is null or rotation_deg is null)), null
union all select 'no duplicate live claims',
  not exists (select stall_id from booking.reservations where status in ('held', 'confirmed') group by stall_id having count(*) > 1)
  and not exists (select team_id from booking.reservations where status in ('held', 'confirmed') group by team_id having count(*) > 1), null
union all select 'Supabase API role ' || r || ' has no access to app_auth/booking',
  not (has_schema_privilege(r, 'app_auth', 'USAGE') or has_schema_privilege(r, 'booking', 'USAGE')), null
  from unnest(array['anon', 'authenticated', 'service_role']) as r
 where exists (select 1 from pg_roles where rolname = r);
