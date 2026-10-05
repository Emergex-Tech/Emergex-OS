\set ON_ERROR_STOP on
-- B15 access tests at the DATABASE layer. Self-contained.
create or replace function pg_temp.fail(msg text) returns void language plpgsql as $$ begin raise exception 'FAIL: %', msg; end $$;

do $$
declare
  org uuid := gen_random_uuid(); org2 uuid := gen_random_uuid();
  agA uuid := gen_random_uuid(); agB uuid := gen_random_uuid(); agX uuid := gen_random_uuid();
  uTeam uuid := gen_random_uuid(); uMgr uuid := gen_random_uuid(); uA uuid := gen_random_uuid(); uB uuid := gen_random_uuid();
  vend uuid := gen_random_uuid(); brand uuid := gen_random_uuid(); prop uuid := gen_random_uuid(); item1 uuid := gen_random_uuid(); item2 uuid := gen_random_uuid();
  deal uuid := gen_random_uuid(); ctr uuid := gen_random_uuid(); n int; t text; msg text; bad text; uX uuid := gen_random_uuid(); act0 bigint;
begin
  insert into organisations (id, name) values (org, 'AgentOrg'), (org2, 'OtherOrg');
  insert into categories (key, label, group_label, reconfirmation_rule) values ('ooh_led', 'OOH', 'Media', '60day') on conflict do nothing;
  insert into agents (id, org_id, name) values (agA, org, 'Agent Co A'), (agB, org, 'Agent Co B'), (agX, org2, 'Foreign Agent');
  insert into auth.users (id) values (uTeam), (uMgr), (uA), (uB);
  insert into profiles (id, org_id, full_name, role_key, agent_id) values
    (uTeam, org, 'team', 'team', null), (uMgr, org, 'mgr', 'manager', null), (uA, org, 'agent a', 'agent', agA), (uB, org, 'agent b', 'agent', agB);

  insert into vendors (id, org_id, name) values (vend, org, 'SECRET VENDOR');
  insert into brands (id, org_id, name) values (brand, org, 'SECRET BRAND');
  insert into properties (id, org_id, category_key, name, vendor_id) values (prop, org, 'ooh_led', 'Prop', vend);
  insert into items (id, org_id, property_id, name) values (item1, org, prop, 'Item1'), (item2, org, prop, 'Item2');
  insert into price_records (org_id, item_id, type, amount) values (org, item1, 'rack', 12345);
  insert into routes (org_id, brand_id, route_type, strength, reliability) values (org, brand, 'direct', 4, 4);
  insert into proposals (org_id, brand_id) values (org, brand);
  insert into shares (org_id, item_id, brand_id) values (org, item1, brand);
  insert into audit_events (org_id, action, entity_type, entity_id) values (org, 'x', 'item', item1);
  insert into intel_notes (org_id, note, source) values (org, 'INTERNAL-SENTINEL', 'team');
  insert into intel_notes (org_id, note, source, submitted_by_agent_id, review_status) values (org, 'AGENT-A-NOTE', 'agent', agA, 'pending'), (org, 'AGENT-B-NOTE', 'agent', agB, 'pending');
  insert into deals (id, org_id) values (deal, org);
  insert into contracts (id, org_id, deal_id, final_amount, renewal_date) values (ctr, org, deal, 100, '2027-01-01');
  insert into invoices (org_id, contract_id, direction, counterparty_type, counterparty_name, amount) values (org, ctr, 'receivable', 'brand', 'x', 5);
  insert into shareable_grants (org_id, agent_id, item_id) values (org, agA, item1);
  insert into agent_activity (org_id, agent_id, user_id, action) values (org, agA, uA, 'view_inventory');
  insert into files (org_id, linked_type, linked_id, kind, doc_title, version, is_current, name) values (org, 'contract', ctr, 'contract_file', 'Contract', 1, true, 'secret.pdf');
  insert into files (org_id, linked_type, linked_id, kind, name) values (org, 'proposal', gen_random_uuid(), 'proposal_export', 'export.xlsx');

  -- ===== STRUCTURE: guarantees that hold for any policy added in future =====
  select string_agg(tablename || '.' || policyname, ', ') into bad from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and qual not like '%is_internal()%' and not (tablename = 'profiles' and qual like '%auth.uid()%');
  if bad is not null then perform pg_temp.fail('SELECT policies that do not require is_internal(): ' || bad); end if;
  raise notice 'PASS every SELECT policy requires is_internal() (only profiles may also allow reading your own row)';

  select count(*) into n from pg_policies where schemaname = 'public' and cmd <> 'SELECT';
  if n <> 0 then perform pg_temp.fail(n || ' non-SELECT policies exist: direct writes must stay impossible'); end if;
  raise notice 'PASS there are no INSERT/UPDATE/DELETE policies at all: nothing can be written except through the service layer';

  select string_agg(tablename, ', ') into bad from pg_tables
   where schemaname = 'public' and not rowsecurity and tablename not in ('categories', 'roles', 'permissions', 'role_permissions');
  if bad is not null then perform pg_temp.fail('tables without RLS: ' || bad); end if;
  raise notice 'PASS every table has RLS except the four reference tables (categories, roles, permissions, role_permissions), which hold no business data';

  select string_agg(proname, ', ' order by proname) into bad from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef;
  if bad is distinct from 'current_org, current_role_key, has_permission, is_internal' then perform pg_temp.fail('unexpected SECURITY DEFINER functions: ' || coalesce(bad, '(none)')); end if;
  raise notice 'PASS the only SECURITY DEFINER functions are the four caller-scoped helpers';

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if n <> 0 then perform pg_temp.fail('a SECURITY DEFINER function has no pinned search_path'); end if;
  raise notice 'PASS every SECURITY DEFINER function pins its search_path';

  -- ===== AGENT A, as a real signed-in user =====
  create temp table sees (tbl text, cnt int);
  grant all on sees to authenticated;
  perform set_config('request.jwt.claim.sub', uA::text, true);
  set local role authenticated;
  for t in select unnest(array['vendors','properties','items','price_records','brands','routes','proposals','proposal_lines','shares','audit_events','intel_notes',
                               'contracts','invoices','payments','shareable_grants','agent_activity','files','deals','agents','routes','record_versions','captures',
                               'property_edge','brand_tier','proposal_line_pricing','competitor_links','share_conflict_overrides','organisations']) loop
    execute format('select count(*) from %I', t) into n;
    insert into sees values (t, n);
  end loop;
  insert into sees select 'profiles', count(*) from profiles;
  insert into sees select 'is_internal', case when is_internal() then 1 else 0 end;
  insert into sees select 'has finance.manage', case when has_permission('finance.manage') then 1 else 0 end;
  insert into sees select 'has agent.portal.use', case when has_permission('agent.portal.use') then 1 else 0 end;
  reset role;

  select string_agg(tbl || '=' || cnt, ', ') into bad from sees
   where tbl not in ('profiles', 'is_internal', 'has finance.manage', 'has agent.portal.use') and cnt <> 0;
  if bad is not null then perform pg_temp.fail('an AGENT can read rows from: ' || bad); end if;
  raise notice 'PASS as an agent, 28 sensitive tables return ZERO rows, queried directly the way a browser console could';
  if (select cnt from sees where tbl = 'profiles') <> 1 then perform pg_temp.fail('an agent should read exactly their own profile'); end if;
  if (select cnt from sees where tbl = 'is_internal') <> 0 or (select cnt from sees where tbl = 'has finance.manage') <> 0 or (select cnt from sees where tbl = 'has agent.portal.use') <> 1 then
    perform pg_temp.fail('helper functions report the wrong thing for an agent'); end if;
  raise notice 'PASS an agent reads exactly ONE profile row (their own), is not internal, has no finance permission, and does have the portal permission';

  -- Same data, same moment, an INTERNAL user does see it (so the zeros above mean something).
  perform set_config('request.jwt.claim.sub', uTeam::text, true); set local role authenticated;
  select count(*) into n from price_records; if n < 1 then reset role; perform pg_temp.fail('internal Team can no longer read price_records — the policy rewrite over-blocked'); end if;
  select count(*) into n from intel_notes; if n < 3 then reset role; perform pg_temp.fail('internal Team can no longer read intel'); end if;
  select count(*) into n from files where kind = 'contract_file'; if n <> 0 then reset role; perform pg_temp.fail('Team can read contract-file rows'); end if;
  select count(*) into n from files where kind = 'proposal_export'; if n <> 1 then reset role; perform pg_temp.fail('Team lost access to proposal export rows'); end if;
  reset role;
  perform set_config('request.jwt.claim.sub', uMgr::text, true); set local role authenticated;
  select count(*) into n from files where kind = 'contract_file'; if n <> 1 then reset role; perform pg_temp.fail('Manager cannot read contract-file rows'); end if;
  select count(*) into n from shareable_grants; if n <> 1 then reset role; perform pg_temp.fail('Manager cannot read grants'); end if;
  reset role;
  raise notice 'PASS internal users still read what they should (and Team is kept out of contract-file rows, Manager is not)';

  -- Writes and privilege escalation as an agent
  select count(*) into act0 from agent_activity;   -- measured, not assumed: this also runs against databases that already hold data
  perform set_config('request.jwt.claim.sub', uA::text, true); set local role authenticated;
  update profiles set role_key = 'ceo' where id = uA; get diagnostics n = row_count;
  begin update profiles set agent_id = agB where id = uA; exception when others then null; end;
  reset role;
  if n <> 0 or (select role_key from profiles where id = uA) <> 'agent' or (select agent_id from profiles where id = uA) <> agA then perform pg_temp.fail('an agent changed their own role or company'); end if;
  raise notice 'PASS an agent cannot promote themselves or switch to another agent company';
  perform set_config('request.jwt.claim.sub', uA::text, true); set local role authenticated;
  begin insert into intel_notes (org_id, note, source, submitted_by_agent_id) values (org, 'direct write', 'agent', agA); msg := 'ALLOWED'; exception when others then msg := 'denied'; end;
  begin insert into shareable_grants (org_id, agent_id, item_id) values (org, agA, item2); msg := msg || '/ALLOWED'; exception when others then msg := msg || '/denied'; end;
  -- A DELETE blocked by RLS does not raise: it silently matches zero rows. So judge it by rows removed, not by "no error".
  begin delete from agent_activity; get diagnostics n = row_count; msg := msg || case when n = 0 then '/denied' else '/ALLOWED' end; exception when others then msg := msg || '/denied'; end;
  reset role;
  if msg <> 'denied/denied/denied' then perform pg_temp.fail('an agent could write directly: ' || msg); end if;
  if (select count(*) from agent_activity) <> act0 then perform pg_temp.fail('the activity log lost rows'); end if;
  raise notice 'PASS an agent cannot insert intel, grant themselves items, or clear their own activity log directly';

  -- ===== constraints =====
  begin insert into profiles (id, org_id, role_key, agent_id) values (gen_random_uuid(), org, 'agent', null); perform pg_temp.fail('agent without a company accepted');
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin insert into profiles (id, org_id, role_key, agent_id) values (gen_random_uuid(), org, 'team', agA); perform pg_temp.fail('team user with an agent company accepted');
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  insert into auth.users (id) values (uX);
  begin insert into profiles (id, org_id, role_key, agent_id) values (uX, org, 'agent', agX); perform pg_temp.fail('cross-organisation agent link accepted');
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like '%same organisation%' then perform pg_temp.fail('wrong error: ' || sqlerrm); end if; end;
  raise notice 'PASS agent users must have a company, only agents may have one, and it must be in the same organisation';

  begin insert into shareable_grants (org_id, agent_id, item_id) values (org, agA, item1); perform pg_temp.fail('duplicate active grant accepted');
  exception when unique_violation then null; end;
  update shareable_grants set revoked_at = now() where agent_id = agA and item_id = item1;
  insert into shareable_grants (org_id, agent_id, item_id) values (org, agA, item1);
  begin insert into shareable_grants (org_id, agent_id, item_id) values (org, agX, item2); perform pg_temp.fail('cross-org grant accepted');
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin insert into shareable_grants (org_id, agent_id, item_id, indicative_price) values (org, agB, item1, -1); perform pg_temp.fail('negative price accepted');
  exception when check_violation then null; end;
  raise notice 'PASS one ACTIVE grant per agent+item (revoke then re-grant is fine), no cross-organisation grants, no negative prices';

  begin update agent_activity set action = 'view_item'; perform pg_temp.fail('activity log was altered');
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like '%append-only%' then perform pg_temp.fail('wrong error: ' || sqlerrm); end if; end;
  begin delete from agent_activity; perform pg_temp.fail('activity log was deleted');
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  raise notice 'PASS the agent activity log cannot be updated or deleted — even by the service layer';

  begin insert into files (org_id, linked_type, linked_id, kind, doc_title, version, is_current) values (org, 'contract', ctr, 'contract_file', 'Contract', 1, false); perform pg_temp.fail('duplicate contract-file version accepted');
  exception when unique_violation then null; end;
  begin insert into files (org_id, linked_type, linked_id, kind, doc_title, version, is_current) values (org, 'contract', ctr, 'contract_file', 'Contract', 2, true); perform pg_temp.fail('two current versions accepted');
  exception when unique_violation then null; end;
  insert into files (org_id, linked_type, linked_id, kind, doc_title, version, is_current) values (org, 'contract', ctr, 'contract_file', 'Amendment', 1, true);
  raise notice 'PASS a contract document cannot have two current versions or a duplicated version number; separate documents are independent chains';
end $$;
