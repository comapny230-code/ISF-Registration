-- 0009: close the Supabase Data API's RPC path into public functions (launch gate LG-04).
--
-- 0006 closed the public tables and sequences, but PostgreSQL grants EXECUTE on every new
-- function to PUBLIC, and Supabase also grants it to anon and authenticated. Any function in
-- public is then callable without signing in at /rest/v1/rpc/<name>. The connected Supabase
-- project already has one such function, public.rls_auto_enable() (a SECURITY DEFINER event
-- trigger function added from the dashboard), flagged by the Supabase security advisor
-- (lints 0028/0029). The application calls no function in public. This migration:
--   * revokes EXECUTE on every existing function in public from PUBLIC and, where they exist,
--     from anon and authenticated;
--   * stops future functions created by the migrating role inheriting EXECUTE for them.
--
-- Event triggers and ordinary triggers keep firing: PostgreSQL checks EXECUTE only when a
-- trigger is created, not when it fires (tested in tests/db/public-functions.test.ts).
-- service_role is left untouched (server-side secret, as in 0006).
--
-- Idempotent: safe to run again. Rollback (only if ever needed): re-grant EXECUTE on the named
-- function to the specific role a pre-migration grant report shows had it.

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

  -- PUBLIC's default EXECUTE is global, so it can only be revoked without IN SCHEMA.
  -- This applies to functions created later by this (the owner) role in any schema; the app
  -- never relies on PUBLIC EXECUTE (booking and app_auth are closed to PUBLIC anyway).
  execute 'alter default privileges revoke execute on functions from public';
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('alter default privileges in schema public revoke execute on functions from %I', api_role);
    end if;
  end loop;
end
$$;
