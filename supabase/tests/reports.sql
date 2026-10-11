\set ON_ERROR_STOP on
-- Stage 3 live reports: links, the append-only view log, frozen snapshots, settings, proof visibility. Self-contained.
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
  -- the two token hashes are random so this test can be run again on the same database
  org uuid := gen_random_uuid(); org2 uuid := gen_random_uuid(); u uuid := gen_random_uuid(); uag uuid := gen_random_uuid(); agco uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); p1 uuid := gen_random_uuid(); del1 uuid := gen_random_uuid(); prf uuid := gen_random_uuid();
  l1 uuid := gen_random_uuid(); l2 uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); h1 text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text); h2 text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text); v_n int; v_def boolean;
begin
  insert into organisations (id, name) values (org, 'ReportsOrg'), (org2, 'Other');
  insert into auth.users (id) values (u), (uag);
  insert into profiles (id, org_id, full_name, role_key) values (u, org, 'u', 'team');
  insert into agents (id, org_id, name) values (agco, org, 'Meridian Sports');
  insert into deals (id, org_id) values (d1, org);
  insert into contracts (id, org_id, deal_id, final_amount, renewal_date) values (c1, org, d1, 1, '2027-01-01');
  insert into projects (id, org_id, deal_id, name, template_key) values (p1, org, d1, 'P', 'short');
  insert into deliverables (id, org_id, contract_id, description) values (del1, org, c1, 'D1');
  insert into deliverable_proofs (id, org_id, deliverable_id, kind, name, url) values (prf, org, del1, 'link', 'L', 'https://drive.google.com/file/d/1AbCdEfGhIjKl/view');

  -- ===== proof is hidden from reports unless someone ticks it =====
  select report_visible into v_def from deliverable_proofs where id = prf; if v_def is not false then perform pg_temp.fail('proof must default to NOT visible in reports'); end if;
  update deliverable_proofs set report_visible = true where id = prf; update deliverable_proofs set report_visible = false where id = prf;
  raise notice 'PASS proof is HIDDEN from reports by default; ticking it is an ordinary change while the project is open';

  -- ===== settings =====
  insert into project_report_settings (project_id, org_id) values (p1, org);
  update project_report_settings set cadence = 'weekly', title = 'A brand-facing title', updated_by = u where project_id = p1;
  perform pg_temp.refused(format($q$update project_report_settings set branding = 'agent' where project_id = %L$q$, p1), 'check constraint');
  update project_report_settings set branding = 'co_branded', agent_id = agco where project_id = p1;
  perform pg_temp.refused(format($q$update project_report_settings set cadence = 'hourly' where project_id = %L$q$, p1), 'check constraint');
  perform pg_temp.refused(format($q$update project_report_settings set branding = 'whitelabel' where project_id = %L$q$, p1), 'check constraint');
  perform pg_temp.refused(format($q$update project_report_settings set title = '  ' where project_id = %L$q$, p1), 'check constraint');
  perform pg_temp.refused(format($q$update project_report_settings set title = %L where project_id = %L$q$, repeat('t', 121), p1), 'check constraint');
  raise notice 'PASS agent or co-branded reporting needs an agent; cadence, branding and title are constrained';

  -- ===== links =====
  insert into report_links (id, org_id, project_id, token_hash, label, created_by, expires_at) values (l1, org, p1, h1, 'Blitz marketing', u, now() + interval '30 days');
  perform pg_temp.refused(format($q$insert into report_links (org_id, project_id, token_hash, expires_at) values (%L, %L, %L, now() + interval '1 day')$q$, org, p1, h1), 'duplicate key');
  perform pg_temp.refused(format($q$insert into report_links (org_id, project_id, token_hash, expires_at) values (%L, %L, 'not-a-hash', now() + interval '1 day')$q$, org, p1), 'check constraint');
  perform pg_temp.refused(format($q$insert into report_links (org_id, project_id, token_hash, expires_at) values (%L, %L, %L, now() + interval '1 day')$q$, org, p1, upper(h2)), 'check constraint');
  perform pg_temp.refused(format($q$insert into report_links (org_id, project_id, token_hash, expires_at) values (%L, %L, %L, now() - interval '1 day')$q$, org, p1, h2), 'check constraint');
  perform pg_temp.refused(format($q$insert into report_links (org_id, project_id, token_hash, expires_at) values (%L, %L, %L, now() + interval '400 days')$q$, org, p1, h2), 'check constraint');
  perform pg_temp.refused(format($q$insert into report_links (org_id, project_id, token_hash, label, expires_at) values (%L, %L, %L, %L, now() + interval '1 day')$q$, org, p1, h2, repeat('x', 121)), 'check constraint');
  perform pg_temp.refused(format($q$update report_links set expires_at = expires_at + interval '300 days' where id = %L$q$, l1), 'cannot be edited');
  perform pg_temp.refused(format($q$update report_links set token_hash = %L where id = %L$q$, h2, l1), 'cannot be edited');
  perform pg_temp.refused(format($q$update report_links set revoked_at = now() where id = %L$q$, l1), 'cannot be edited');   -- revoking without naming a person: the trigger refuses it first (the check constraint is the second layer)
  perform pg_temp.refused(format($q$update report_links set revoked_at = now(), revoked_by = %L, expires_at = now() + interval '5 days' where id = %L$q$, u, l1), 'cannot be edited');
  perform pg_temp.refused(format($q$delete from report_links where id = %L$q$, l1), 'cannot be deleted');
  raise notice 'PASS a link stores only a 64-hex hash; its lifetime is bounded (1 second – 366 days); its expiry/hash can never be changed or extended; it cannot be deleted';
  update report_links set revoked_at = now(), revoked_by = u where id = l1;
  perform pg_temp.refused(format($q$update report_links set revoked_at = null, revoked_by = null where id = %L$q$, l1), 'cannot be edited');
  perform pg_temp.refused(format($q$update report_links set revoked_by = %L where id = %L$q$, uag, l1), 'cannot be edited');
  raise notice 'PASS a link can be revoked ONCE, with a person, and revoking can never be undone';

  -- ===== snapshots =====
  insert into report_snapshots (id, org_id, project_id, trigger, period_date, content, content_hash) values (s1, org, p1, 'cadence', '2026-06-10', '{"title":"T"}', 'h');
  perform pg_temp.refused(format($q$insert into report_snapshots (org_id, project_id, trigger, period_date, content, content_hash) values (%L, %L, 'cadence', '2026-06-10', '{}', 'h')$q$, org, p1), 'duplicate key');
  insert into report_snapshots (org_id, project_id, trigger, period_date, content, content_hash) values (org, p1, 'cadence', '2026-06-11', '{}', 'h'), (org, p1, 'manual', '2026-06-10', '{}', 'h'), (org, p1, 'manual', '2026-06-10', '{}', 'h2'), (org, p1, 'closing', '2026-06-10', '{}', 'h');
  perform pg_temp.refused(format($q$insert into report_snapshots (org_id, project_id, trigger, period_date, content, content_hash) values (%L, %L, 'closing', '2026-06-10', '{}', 'h')$q$, org, p1), 'duplicate key');
  perform pg_temp.refused(format($q$insert into report_snapshots (org_id, project_id, trigger, period_date, content, content_hash) values (%L, %L, 'sometimes', '2026-06-10', '{}', 'h')$q$, org, p1), 'check constraint');
  perform pg_temp.refused(format($q$insert into report_snapshots (org_id, project_id, trigger, period_date, content, content_hash) values (%L, %L, 'manual', '2026-06-10', '[1,2]', 'h')$q$, org, p1), 'check constraint');
  perform pg_temp.refused(format($q$update report_snapshots set content = '{"title":"edited"}' where id = %L$q$, s1), 'cannot be edited');
  perform pg_temp.refused(format($q$update report_snapshots set leaks = '{}' where id = %L$q$, s1), 'cannot be edited');
  perform pg_temp.refused(format($q$delete from report_snapshots where id = %L$q$, s1), 'cannot be edited or deleted');
  raise notice 'PASS a snapshot is FROZEN (never edited, never deleted); one automatic snapshot per project per day, any number of manual ones';

  -- ===== the view log =====
  insert into report_views (org_id, link_id, kind, ip_hash, user_agent) values (org, l1, 'report', 'abc', 'Mozilla');
  insert into report_views (org_id, link_id, kind, snapshot_id) values (org, l1, 'snapshot', s1);
  insert into report_views (org_id, link_id, kind, proof_id) values (org, l1, 'proof', prf);
  insert into report_views (org_id, link_id, kind) values (org, l1, 'pdf');
  perform pg_temp.refused(format($q$insert into report_views (org_id, link_id, kind) values (%L, %L, 'download')$q$, org, l1), 'check constraint');
  perform pg_temp.refused(format($q$insert into report_views (org_id, link_id, kind, user_agent) values (%L, %L, 'report', %L)$q$, org, l1, repeat('u', 201)), 'check constraint');
  perform pg_temp.refused(format($q$insert into report_views (org_id, link_id, kind) values (%L, %L, 'report')$q$, org, gen_random_uuid()), 'foreign key');
  perform pg_temp.refused($q$update report_views set kind = 'pdf'$q$, 'cannot be edited or deleted');
  perform pg_temp.refused($q$delete from report_views$q$, 'cannot be edited or deleted');
  raise notice 'PASS every view is logged append-only: kinds are constrained, a log row cannot be altered or removed';

  -- ===== a closed project's report record is locked with the rest of its record =====
  update projects set status = 'closed', closed_at = now(), closed_by = u where id = p1;
  perform pg_temp.refused(format($q$update deliverable_proofs set report_visible = true where id = %L$q$, prf), 'This project is closed');
  update project_report_settings set cadence = 'manual' where project_id = p1;
  insert into report_views (org_id, link_id, kind) values (org, l1, 'report');
  raise notice 'PASS on a closed project the proof-visibility choices are locked (the final report is what it was); settings and the view log are not';

  -- ===== RLS =====
  insert into profiles (id, org_id, full_name, role_key, agent_id) values (uag, org, 'a', 'agent', agco);
  create temp table seen5 (who text, s int, l int, v int, c int); grant all on seen5 to authenticated;
  perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated;
  insert into seen5 select 'team', (select count(*) from report_snapshots), (select count(*) from report_links), (select count(*) from report_views), (select count(*) from project_report_settings); reset role;
  perform set_config('request.jwt.claim.sub', uag::text, true); set local role authenticated;
  insert into seen5 select 'agent', (select count(*) from report_snapshots), (select count(*) from report_links), (select count(*) from report_views), (select count(*) from project_report_settings); reset role;
  if (select (s, l, c)::text from seen5 where who = 'team') <> '(5,1,1)' then perform pg_temp.fail('staff should see this organisation''s 5 snapshots, 1 link, 1 settings row: ' || (select (s, l, c)::text from seen5 where who = 'team')); end if;
  if (select s + l + v + c from seen5 where who = 'agent') <> 0 then perform pg_temp.fail('an AGENT can read report data'); end if;
  raise notice 'PASS staff read their organisation''s report data; an agent (and so any outsider) reads none of it';
end $$;
