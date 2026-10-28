-- 0002_app_schemas.sql
-- Private schemas for authentication and stall booking.
-- Neither schema is exposed through the Supabase Data API, and no Supabase API
-- role (anon, authenticated, service_role) may use it.
-- Runtime grants for the least-privilege role are added by a later migration
-- once that role exists (docs/STALL_BOOKING_FINAL_SPEC.md §2.6, blocker B-08).

create schema if not exists app_auth;
create schema if not exists booking;

revoke all on schema app_auth from public;
revoke all on schema booking from public;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on schema app_auth from %I', api_role);
      execute format('revoke all on schema booking from %I', api_role);
    end if;
  end loop;
end
$$;
