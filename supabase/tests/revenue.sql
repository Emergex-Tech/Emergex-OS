\set ON_ERROR_STOP on
-- Revenue plan, stage weights, the signing date, and who may read them. Self-contained and re-runnable.
create or replace function pg_temp.fail(msg text) returns void language plpgsql as $$ begin raise exception 'FAIL: %', msg; end $$;
create or replace function pg_temp.refused(stmt text, expect text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: this was accepted but must be refused: %', stmt;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if expect is not null and sqlerrm not like '%' || expect || '%' then raise exception 'FAIL: refused for the wrong reason (wanted "%", got "%") for: %', expect, sqlerrm, stmt; end if;
end $$;
do $$
declare org uuid := gen_random_uuid(); org2 uuid := gen_random_uuid(); uceo uuid := gen_random_uuid(); umgr uuid := gen_random_uuid(); uteam uuid := gen_random_uuid(); uag uuid := gen_random_uuid(); agco uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); v text;
begin
  insert into organisations (id, name) values (org, 'RevOrg'), (org2, 'Other');
  insert into auth.users (id) values (uceo), (umgr), (uteam), (uag);
  insert into agents (id, org_id, name) values (agco, org, 'AC');
  insert into profiles (id, org_id, full_name, role_key, agent_id) values (uceo, org, 'c', 'ceo', null), (umgr, org, 'm', 'manager', null), (uteam, org, 't', 'team', null), (uag, org, 'a', 'agent', agco);

  -- ===== who holds the permissions =====
  select string_agg(role_key, ',' order by role_key) into v from role_permissions where permission_key = 'revenue.view'; if v <> 'ceo,management,manager' then perform pg_temp.fail('revenue.view should be CEO, Manager and Management only: ' || coalesce(v, 'none')); end if;
  select string_agg(role_key, ',' order by role_key) into v from role_permissions where permission_key = 'revenue.plan'; if v <> 'ceo' then perform pg_temp.fail('revenue.plan should be CEO only: ' || coalesce(v, 'none')); end if;
  raise notice 'PASS the revenue view is for CEO, Manager and Management; only the CEO sets the plan and the forecast weights; Team and agents hold neither';

  -- ===== the plan =====
  insert into revenue_plan (org_id, period, currency, booked_target, collected_target, set_by) values (org, '2026-11-01', 'USD', 100000, 80000, uceo), (org, '2026-11-01', 'AED', 5000, null, uceo), (org2, '2026-11-01', 'USD', 1, null, null);
  perform pg_temp.refused(format($q$insert into revenue_plan (org_id, period, currency, booked_target) values (%L, '2026-11-15', 'USD', 1)$q$, org), 'check constraint');
  perform pg_temp.refused(format($q$insert into revenue_plan (org_id, period, currency, booked_target) values (%L, '2026-11-01', 'USD', 2)$q$, org), 'duplicate key');
  perform pg_temp.refused(format($q$insert into revenue_plan (org_id, period, currency, booked_target) values (%L, '2026-12-01', 'usd', 1)$q$, org), 'check constraint');
  perform pg_temp.refused(format($q$insert into revenue_plan (org_id, period, currency, booked_target) values (%L, '2026-12-01', 'DOLLARS', 1)$q$, org), 'check constraint');
  perform pg_temp.refused(format($q$insert into revenue_plan (org_id, period, currency, booked_target) values (%L, '2026-12-01', 'USD', -1)$q$, org), 'check constraint');
  perform pg_temp.refused(format($q$insert into revenue_plan (org_id, period, currency, booked_target, collected_target) values (%L, '2026-12-01', 'USD', 1, -5)$q$, org), 'check constraint');
  perform pg_temp.refused(format($q$insert into revenue_plan (org_id, period, currency) values (%L, '2026-12-01', 'USD')$q$, org), 'null value');
  insert into revenue_plan (org_id, period, currency, booked_target) values (org, '2026-12-01', 'USD', 0);
  raise notice 'PASS a plan is one target per MONTH and currency (always the 1st, never twice), never negative, in a real 3-letter currency';

  -- ===== stage weights =====
  insert into pipeline_stage_weights (org_id, stage, weight_pct) values (org, 'Sent', 60), (org, 'Review', 0), (org, 'Negotiating', 100);
  perform pg_temp.refused(format($q$insert into pipeline_stage_weights (org_id, stage, weight_pct) values (%L, 'Won', 100)$q$, org), 'check constraint');
  perform pg_temp.refused(format($q$insert into pipeline_stage_weights (org_id, stage, weight_pct) values (%L, 'Draft', 101)$q$, org), 'check constraint');
  perform pg_temp.refused(format($q$insert into pipeline_stage_weights (org_id, stage, weight_pct) values (%L, 'Draft', -1)$q$, org), 'check constraint');
  perform pg_temp.refused(format($q$insert into pipeline_stage_weights (org_id, stage, weight_pct) values (%L, 'Sent', 10)$q$, org), 'duplicate key');
  raise notice 'PASS a weight is 0–100 for an OPEN stage only (Won and Lost are outcomes, not forecasts), one per stage';

  -- ===== the signing date =====
  insert into deals (id, org_id) values (d1, org);
  insert into contracts (org_id, deal_id, final_amount, renewal_date, booked_on) values (org, d1, 75000, '2027-06-30', '2024-07-15');
  if (select booked_on from contracts where deal_id = d1) <> date '2024-07-15' then perform pg_temp.fail('a contract must keep the date it was signed'); end if;
  raise notice 'PASS a contract can carry the date it was actually signed, so a deal entered late is booked in the right month';

  -- ===== who can READ the plan and the weights =====
  create temp table seen7 (who text, p int, w int); grant all on seen7 to authenticated;
  perform set_config('request.jwt.claim.sub', uceo::text, true); set local role authenticated; insert into seen7 select 'ceo', (select count(*) from revenue_plan), (select count(*) from pipeline_stage_weights); reset role;
  perform set_config('request.jwt.claim.sub', umgr::text, true); set local role authenticated; insert into seen7 select 'manager', (select count(*) from revenue_plan), (select count(*) from pipeline_stage_weights); reset role;
  perform set_config('request.jwt.claim.sub', uteam::text, true); set local role authenticated; insert into seen7 select 'team', (select count(*) from revenue_plan), (select count(*) from pipeline_stage_weights); reset role;
  perform set_config('request.jwt.claim.sub', uag::text, true); set local role authenticated; insert into seen7 select 'agent', (select count(*) from revenue_plan), (select count(*) from pipeline_stage_weights); reset role;
  if (select (p, w)::text from seen7 where who = 'ceo') <> '(3,3)' or (select (p, w)::text from seen7 where who = 'manager') <> '(3,3)' then perform pg_temp.fail('CEO and Manager should read their own organisation''s 3 plan rows and 3 weights (not the other organisation''s): ' || (select string_agg(who || (p, w)::text, ' ') from seen7)); end if;
  if (select p + w from seen7 where who = 'team') <> 0 then perform pg_temp.fail('TEAM can read the revenue plan or weights'); end if;
  if (select p + w from seen7 where who = 'agent') <> 0 then perform pg_temp.fail('an AGENT can read the revenue plan or weights'); end if;
  drop table seen7;
  raise notice 'PASS CEO and Manager read their own organisation''s plan and weights; TEAM reads none of it, and neither does an agent';
end $$;
