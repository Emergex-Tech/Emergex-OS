\set ON_ERROR_STOP on
-- B15: as a real agent login, count the rows visible in EVERY table that has RLS, against a database that actually
-- contains data (run it after the end-to-end suite, or against staging). On an empty database it proves nothing,
-- so it reports how many tables actually held data.
do $$
declare uid uuid; t text; n_total bigint; n_seen bigint; checked int := 0; empty int := 0; bad text := ''; control bigint; team uuid;
begin
  select id into uid from profiles where role_key = 'agent' limit 1;
  if uid is null then raise notice 'SKIP: there is no agent profile in this database'; return; end if;
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity and tablename <> 'profiles' order by 1 loop
    execute format('select count(*) from %I', t) into n_total;
    perform set_config('request.jwt.claim.sub', uid::text, true); set local role authenticated;
    execute format('select count(*) from %I', t) into n_seen;
    reset role;
    if n_total = 0 then empty := empty + 1; else checked := checked + 1; end if;
    if n_seen <> 0 then bad := bad || t || '(' || n_seen || ' of ' || n_total || ') '; end if;
  end loop;
  if bad <> '' then raise exception 'FAIL: an agent can read rows from: %', bad; end if;
  -- control: the same query as a STAFF user must see data, otherwise the zeros above could just mean "the query is broken"
  select id into team from profiles where role_key in ('team', 'manager', 'ceo') limit 1;
  perform set_config('request.jwt.claim.sub', team::text, true); set local role authenticated;
  select count(*) into control from price_records; reset role;
  if control = 0 then raise exception 'FAIL: the control query returned nothing for staff, so this sweep proves nothing'; end if;
  raise notice 'PASS as an agent, % tables that contain data return ZERO rows (% other tables are empty here and say nothing); staff control sees % price records', checked, empty, control;
end $$;
