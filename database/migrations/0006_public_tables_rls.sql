-- 0006: close the Supabase Data API path to registration data (spec §2.6, T-02, launch gate LG-04).
--
-- The public schema holds Aadhaar and PAN numbers, phone numbers and addresses. Supabase's
-- Data API serves any public table that its API roles (anon, authenticated) hold privileges
-- on and that has no row-level security. This migration, for every table in public:
--   * enables row-level security with NO policies, so a role that is not the owner sees no rows;
--   * revokes every table privilege from PUBLIC and, where they exist, from anon and authenticated;
-- and stops future tables in public inheriting default privileges for those roles.
--
-- The application connects as the table owner, which bypasses row-level security (it is not
-- FORCEd), so it keeps working unchanged. The policies for the least-privilege runtime role
-- isf_app are added when [INFRA] creates that role (B-08). service_role is left untouched: it
-- bypasses row-level security by design and is a server-side secret.
--
-- Idempotent: safe to run again, e.g. after a table is added outside migrations.
-- Rollback (only if ever needed): disable row-level security per table and re-grant ONLY what a
-- pre-migration grant report shows was there; never grant registration tables to anon.

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
