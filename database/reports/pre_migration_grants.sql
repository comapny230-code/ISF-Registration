-- READ-ONLY report to save BEFORE applying migrations to staging or production (spec §2.7).
-- It records who can reach the registration data today, so the effect of migration 0006
-- (row-level security; no access for anon/authenticated/PUBLIC) can be shown and, if ever
-- needed, the previous grants restored exactly. Changes nothing.
--
--   psql "$MIGRATION_DATABASE_URL" -X -f database/reports/pre_migration_grants.sql > grants-before-<date>.txt

begin read only;

\echo '== tables in public: owner, row-level security'
select c.relname as table_name, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by 1;

\echo '== table privileges in public held by roles other than the owner'
select c.relname as table_name, coalesce(nullif(g.grantee::regrole::text, '-'), 'PUBLIC') as grantee, g.privilege_type
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
 where n.nspname = 'public' and c.relkind in ('r', 'p') and g.grantee <> c.relowner
 order by 1, 2, 3;

\echo '== row-level security policies in public'
select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' order by 1, 2;

\echo '== default privileges for new objects in public'
select pg_get_userbyid(d.defaclrole) as for_role, d.defaclobjtype as object_type, d.defaclacl as privileges
  from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public';

\echo '== Supabase API roles present'
select rolname, rolbypassrls from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'isf_app') order by 1;

\echo '== migrations already recorded (empty or error before the first run of the runner)'
select version, name, applied_at from public.schema_migrations order by version;

rollback;
