-- 0014 (was 0011 on main, renumbered after this branch's 0010-0013): provision the least-privilege
-- runtime role isf_app. It is created NOLOGIN; an operator gives it a password and LOGIN when the
-- app is switched to it (database/roles/isf_app_grants.sql, docs/runbooks/deploy-migrations.md).
-- A migrating user without CREATEROLE (e.g. the test cluster's) skips this with a notice.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'isf_app') then
    return;
  end if;
  if exists (select 1 from pg_roles where rolname = current_user and (rolcreaterole or rolsuper)) then
    create role isf_app nologin noinherit;
  else
    raise notice '0014: % may not create roles; isf_app not created', current_user;
  end if;
end
$$;
