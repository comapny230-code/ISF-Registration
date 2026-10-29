-- Launch gate LG-04 (blocker B-03): Supabase Data API roles must not be able to read or write
-- registration data (Aadhaar, PAN, contacts). Migration 0006 enables RLS and revokes these roles.
-- The per-role rows appear only when the Supabase roles exist (they do not in local/test clusters).
select 'API role ' || r || ' cannot access public.' || t as check_name,
       not (has_table_privilege(r, 'public.' || t, 'SELECT') or has_table_privilege(r, 'public.' || t, 'INSERT')
            or has_table_privilege(r, 'public.' || t, 'UPDATE') or has_table_privilege(r, 'public.' || t, 'DELETE')) as ok,
       case when (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then 'RLS enabled' else 'RLS disabled' end as detail
  from unnest(array['anon', 'authenticated']) as r
 cross join unnest(array['user_accounts', 'startup_team_leaders', 'student_innovators', 'startup_team_members',
                         'student_team_members', 'startups', 'startup_memberships', 'role_grants', 'edition_access']) as t
 where exists (select 1 from pg_roles where rolname = r)
   and to_regclass('public.' || t) is not null

-- Every table in public must have row-level security on (migration 0006), so that a
-- Data API role can never read it even if a grant is added later. Checked everywhere,
-- including local and test clusters where the Supabase roles do not exist.
union all
select 'row-level security enabled on public.' || c.relname, c.relrowsecurity,
       case when c.relrowsecurity then 'RLS enabled' else 'RLS disabled' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')

-- No function in public may be callable through the Data API's RPC endpoint (migration 0009).
-- PUBLIC is checked everywhere; anon and authenticated only where those roles exist.
union all
select coalesce(r.rolname, 'PUBLIC') || ' cannot execute public.' || p.oid::regprocedure::text,
       not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee = r.oid)),
       case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (select null::oid as oid, null::name as rolname
              union all select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')) r
 where n.nspname = 'public' and p.prokind in ('f', 'p');;
