-- 0011: provision runtime database role isf_app if running in local/test/staging environments.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'isf_app') then
    create role isf_app nologin noinherit;
  end if;
end
$$;
