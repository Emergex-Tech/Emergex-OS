\set ON_ERROR_STOP on
-- Stage 3 proof + metrics database guarantees. Self-contained.
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
declare
  org uuid := gen_random_uuid(); org2 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); proj uuid := gen_random_uuid();
  del uuid := gen_random_uuid(); del2 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid(); pr1 uuid := gen_random_uuid(); uTeam uuid := gen_random_uuid(); uAg uuid := gen_random_uuid(); agco uuid := gen_random_uuid(); v_n int; v_cats text;
begin
  insert into organisations (id, name) values (org, 'PM'), (org2, 'PM2');
  insert into auth.users (id) values (uTeam), (uAg);
  insert into profiles (id, org_id, full_name, role_key) values (uTeam, org, 't', 'team');   -- needed up front: voiding an entry records WHO voided it
  insert into deals (id, org_id) values (d1, org), (d2, org2);
  insert into contracts (id, org_id, deal_id, final_amount, renewal_date) values (c1, org, d1, 1, '2027-01-01'), (c2, org2, d2, 1, '2027-01-01');
  insert into projects (id, org_id, deal_id, name, template_key) values (proj, org, d1, 'P', 'short');
  insert into deliverables (id, org_id, contract_id, description) values (del, org, c1, 'D'), (del2, org2, c2, 'D2');

  -- ===== metric definitions =====
  select string_agg(distinct category_key, ',' order by category_key) into v_cats from metric_definitions where active;
  if v_cats <> 'broadcast_streaming,celebrity_talent,content_production,digital_publisher_app,events_activations,influencer_creator,ip_shows,league_tournament,ooh_led,player_athlete,team,transit_vehicle' then perform pg_temp.fail('every one of the 12 categories needs a metric set, got: ' || v_cats); end if;
  select count(*) into v_n from (select category_key from metric_definitions group by 1 having count(*) < 3) x; if v_n <> 0 then perform pg_temp.fail('a category has fewer than 3 metrics'); end if;
  select count(*) into v_n from metric_definitions where key like '%rate' or key = 'ctr'; if v_n < 1 or exists (select 1 from metric_definitions where (key like '%rate' or key = 'ctr') and (aggregation <> 'avg' or unit <> '%')) then perform pg_temp.fail('rates must average and be in %'); end if;
  perform pg_temp.refused($q$insert into metric_definitions (category_key, key, label) values ('ooh_led', 'sites_live', 'dup')$q$, 'duplicate key');
  perform pg_temp.refused($q$insert into metric_definitions (category_key, key, label) values ('ooh_led', 'Bad Key!', 'x')$q$, null);
  perform pg_temp.refused($q$insert into metric_definitions (category_key, key, label, aggregation) values ('ooh_led', 'median_thing', 'x', 'median')$q$, null);
  raise notice 'PASS all 12 categories have a metric set (rates average and are in %%); duplicate or badly-formed definitions are refused';

  -- ===== metric entries =====
  insert into project_metrics (id, org_id, project_id, deliverable_id, category_key, metric_key, value, recorded_on, source) values (m1, org, proj, del, 'ooh_led', 'sites_live', 12, '2026-06-01', 'Vendor report');
  insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source, source_ref) values (org, proj, 'ooh_led', 'est_impressions', 1500000.5, '2026-06-01', 'Estimate', 'https://example.test/report');
  perform pg_temp.refused(format($q$insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source) values (%L, %L, 'ooh_led', 'made_up_metric', 1, '2026-06-01', 's')$q$, org, proj), 'foreign key');
  perform pg_temp.refused(format($q$insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source) values (%L, %L, 'ooh_led', 'views', 1, '2026-06-01', 's')$q$, org, proj), 'foreign key');
  perform pg_temp.refused(format($q$insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source) values (%L, %L, 'ooh_led', 'sites_live', -1, '2026-06-01', 's')$q$, org, proj), 'check constraint');
  perform pg_temp.refused(format($q$insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source) values (%L, %L, 'ooh_led', 'sites_live', 1, '2026-06-01', '  ')$q$, org, proj), 'check constraint');
  perform pg_temp.refused(format($q$insert into project_metrics (org_id, project_id, category_key, metric_key, value, source) values (%L, %L, 'ooh_led', 'sites_live', 1, 's')$q$, org, proj), 'null value');
  perform pg_temp.refused(format($q$insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source, voided_at) values (%L, %L, 'ooh_led', 'sites_live', 1, '2026-06-01', 's', now())$q$, org, proj), 'check constraint');
  raise notice 'PASS only a DEFINED metric for the right category can be recorded; negative values, blank sources and a missing date are refused';
  perform pg_temp.refused(format($q$update project_metrics set value = 99 where id = %L$q$, m1), 'cannot be edited');
  perform pg_temp.refused(format($q$update project_metrics set source = 'changed' where id = %L$q$, m1), 'cannot be edited');
  perform pg_temp.refused(format($q$delete from project_metrics where id = %L$q$, m1), 'cannot be deleted');
  perform pg_temp.refused(format($q$update project_metrics set voided_at = now(), voided_by = %L, void_reason = 'typo', value = 1 where id = %L$q$, uTeam, m1), 'cannot be edited');
  perform pg_temp.refused(format($q$update project_metrics set voided_at = now(), void_reason = 'typo' where id = %L$q$, m1), 'cannot be edited');
  update project_metrics set voided_at = now(), voided_by = uTeam, void_reason = 'Wrong deliverable' where id = m1;
  perform pg_temp.refused(format($q$update project_metrics set void_reason = 'rewritten history' where id = %L$q$, m1), 'cannot be edited');
  perform pg_temp.refused(format($q$update project_metrics set voided_at = null, void_reason = null where id = %L$q$, m1), 'cannot be edited');
  raise notice 'PASS a metric entry can never be edited or deleted — the one permitted change is voiding it, once, with a reason and a person, and nothing else may change with it';

  -- ===== proofs =====
  insert into deliverable_proofs (id, org_id, deliverable_id, kind, name, drive_file_id, sha256) values (pr1, org, del, 'upload', 'shot.png', 'file1', 'abc');
  insert into deliverable_proofs (org_id, deliverable_id, kind, name, url) values (org, del, 'link', 'Insights', 'https://drive.google.com/file/d/1AbCdEfGhIjKl/view');
  perform pg_temp.refused(format($q$insert into deliverable_proofs (org_id, deliverable_id, kind, name) values (%L, %L, 'upload', 'no file')$q$, org, del), 'check constraint');
  perform pg_temp.refused(format($q$insert into deliverable_proofs (org_id, deliverable_id, kind, name) values (%L, %L, 'link', 'no url')$q$, org, del), 'check constraint');
  perform pg_temp.refused(format($q$insert into deliverable_proofs (org_id, deliverable_id, kind, name, url) values (%L, %L, 'screenshot', 'x', 'https://drive.google.com/x')$q$, org, del), 'check constraint');
  perform pg_temp.refused(format($q$insert into deliverable_proofs (org_id, deliverable_id, kind, name, drive_file_id, sha256) values (%L, %L, 'upload', 'again.png', 'file2', 'abc')$q$, org, del), 'duplicate key');
  perform pg_temp.refused(format($q$insert into deliverable_proofs (org_id, deliverable_id, kind, name, url) values (%L, %L, 'link', 'same link', 'https://drive.google.com/file/d/1AbCdEfGhIjKl/view')$q$, org, del), 'duplicate key');
  perform pg_temp.refused(format($q$insert into deliverable_proofs (org_id, deliverable_id, kind, name, drive_file_id) values (%L, %L, 'upload', 'x', 'f')$q$, org2, del), 'same organisation');
  update deliverable_proofs set archived_at = now() where id = pr1;
  insert into deliverable_proofs (org_id, deliverable_id, kind, name, drive_file_id, sha256) values (org, del, 'upload', 're-upload.png', 'file3', 'abc');
  insert into deliverable_proofs (org_id, deliverable_id, kind, name, drive_file_id, sha256) values (org2, del2, 'upload', 'other.png', 'f4', 'abc');   -- same hash on ANOTHER deliverable is fine
  raise notice 'PASS an upload needs its Drive file and a link needs its URL; the same file or link cannot be attached twice to one deliverable (archiving frees it); proof must share its deliverable''s organisation';

  -- ===== RLS =====
  insert into agents (id, org_id, name) values (agco, org, 'AC');
  insert into profiles (id, org_id, full_name, role_key, agent_id) values (uAg, org, 'a', 'agent', agco);
  create temp table seen3 (who text, a int, b int, c int);
  grant all on seen3 to authenticated;
  perform set_config('request.jwt.claim.sub', uTeam::text, true); set local role authenticated;
  insert into seen3 select 'team', (select count(*) from project_metrics), (select count(*) from deliverable_proofs), (select count(*) from metric_definitions); reset role;
  perform set_config('request.jwt.claim.sub', uAg::text, true); set local role authenticated;
  insert into seen3 select 'agent', (select count(*) from project_metrics), (select count(*) from deliverable_proofs), (select count(*) from metric_definitions); reset role;
  if (select (a, b)::text from seen3 where who = 'team') <> '(2,3)' then perform pg_temp.fail('staff should see their organisation''s 2 metric entries and 3 proofs (one archived; not org2''s): ' || (select (a, b)::text from seen3 where who = 'team')); end if;
  if (select c from seen3 where who = 'team') < 30 then perform pg_temp.fail('staff cannot read the metric definitions'); end if;
  if (select (a + b + c) from seen3 where who = 'agent') <> 0 then perform pg_temp.fail('an AGENT can read metrics or proof'); end if;
  raise notice 'PASS staff read their own organisation''s metrics and proof (not another''s); an agent reads none of it';
end $$;
