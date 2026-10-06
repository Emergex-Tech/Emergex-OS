\set ON_ERROR_STOP on
-- Stage 3 database guarantees. Self-contained.
create or replace function pg_temp.fail(msg text) returns void language plpgsql as $$ begin raise exception 'FAIL: %', msg; end $$;
-- run a statement that MUST be refused; it fails the test if accepted, or if the refusal isn't the expected one
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
  org uuid := gen_random_uuid(); org2 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); d4 uuid := gen_random_uuid(); d5 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid(); p5 uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid(); pl1 uuid := gen_random_uuid(); mg1 uuid := gen_random_uuid(); party1 uuid := gen_random_uuid();
  req uuid := gen_random_uuid(); upd uuid := gen_random_uuid(); uTeam uuid := gen_random_uuid(); uAg uuid := gen_random_uuid(); agco uuid := gen_random_uuid();
  v_n int;
begin
  insert into organisations (id, name) values (org, 'ProjOrg'), (org2, 'ProjOrg2');
  insert into deals (id, org_id) values (d1, org), (d2, org), (d3, org), (d4, org), (d5, org2);
  insert into contracts (id, org_id, deal_id, final_amount, renewal_date) values (c1, org, d1, 100, '2027-01-01'), (c2, org, d2, 100, '2027-01-01');

  -- ===== templates =====
  -- The REQUIRED phases must exist. This is deliberately NOT an exact match: templates are data that Management edits
  -- (the end-to-end suite itself adds a phase), so an exact comparison would fail on any database where someone has used them.
  for v_n in 1..4 loop if not exists (select 1 from checklist_template_items where template_key = 'full' and phase_no = v_n) then perform pg_temp.fail('the Full template is missing phase ' || v_n); end if; end loop;
  for v_n in 1..3 loop if not exists (select 1 from checklist_template_items where template_key = 'short' and phase_no = v_n) then perform pg_temp.fail('the Short template is missing phase ' || v_n); end if; end loop;
  select count(*) into v_n from checklist_template_items where template_key = 'full' and phase_no = 1 and side = 'brand'; if v_n < 3 then perform pg_temp.fail('Full phase 1 needs brand-side items'); end if;
  select count(*) into v_n from checklist_template_items where template_key = 'full' and phase_no = 1 and side = 'team'; if v_n < 1 then perform pg_temp.fail('Full phase 1 needs team-side items'); end if;
  perform pg_temp.refused($q$insert into checklist_template_items (template_key, phase_no, phase_name, side, title, auto_rule) values ('full', 1, 'x', 'brand', 'x', 'made_up_rule')$q$, null);
  perform pg_temp.refused($q$insert into checklist_template_items (template_key, phase_no, phase_name, side, title) values ('full', 1, 'x', 'vendor', 'x')$q$, null);
  raise notice 'PASS both templates are seeded (Full phases 1-4, Short phases 1-3, brand and team sides), and an unknown rule or side is refused';

  -- ===== projects: one per deal, upsell links cannot loop =====
  insert into projects (id, org_id, deal_id, name, template_key) values (p1, org, d1, 'P1', 'full'), (p2, org, d2, 'P2', 'short'), (p3, org, d3, 'P3', 'short'), (p4, org, d4, 'P4', 'short');
  perform pg_temp.refused(format($q$insert into projects (org_id, deal_id, name, template_key) values (%L, %L, 'dup', 'full')$q$, org, d1), null);
  update projects set parent_project_id = p1 where id = p2;
  perform pg_temp.refused(format($q$update projects set parent_project_id = %L where id = %L$q$, p2, p3), 'itself an upsell');
  perform pg_temp.refused(format($q$update projects set parent_project_id = %L where id = %L$q$, p3, p1), 'already has upsells');
  perform pg_temp.refused(format($q$update projects set parent_project_id = %L where id = %L$q$, p1, p1), 'own upsell parent');
  insert into projects (id, org_id, deal_id, name, template_key) values (p5, org2, d5, 'OtherOrg', 'full');
  perform pg_temp.refused(format($q$update projects set parent_project_id = %L where id = %L$q$, p1, p5), 'same organisation');
  perform pg_temp.refused($q$update projects set status = 'archived' where name = 'P1'$q$, null);
  raise notice 'PASS one project per deal; an upsell can point only at an ORIGINAL (no chains, no loops, no self, no cross-organisation)';

  -- ===== checklist =====
  insert into project_checklist_items (org_id, project_id, phase_no, phase_name, side, title) values (org, p1, 1, 'P', 'brand', 'item');
  perform pg_temp.refused(format($q$update project_checklist_items set status = 'na' where project_id = %L$q$, p1), null);
  perform pg_temp.refused(format($q$update project_checklist_items set status = 'na', na_reason = '   ' where project_id = %L$q$, p1), null);
  update project_checklist_items set status = 'na', na_reason = 'Not applicable to this brand' where project_id = p1;
  perform pg_temp.refused(format($q$update project_checklist_items set status = 'finished' where project_id = %L$q$, p1), null);
  raise notice 'PASS an item can only be skipped (N/A) with a reason on record, and only the three statuses exist';

  -- ===== parties =====
  insert into project_parties (id, org_id, project_id, role, side, name, ref_type, ref_id) values (party1, org, p1, 'vendor', 'delivery', 'V', 'vendor', c1);
  perform pg_temp.refused(format($q$insert into project_parties (org_id, project_id, role, side, name, ref_type, ref_id) values (%L, %L, 'vendor', 'delivery', 'V again', 'vendor', %L)$q$, org, p1, c1), null);
  update project_parties set archived_at = now() where id = party1;
  insert into project_parties (org_id, project_id, role, side, name, ref_type, ref_id) values (org, p1, 'vendor', 'delivery', 'V again', 'vendor', c1);
  perform pg_temp.refused(format($q$insert into project_parties (org_id, project_id, role, side, name) values (%L, %L, 'regulator', 'brand', 'x')$q$, org, p1), null);
  raise notice 'PASS the same party cannot be listed twice in a role while active (archiving frees it); unknown roles refused';

  -- ===== communication log =====
  insert into project_communications (id, org_id, project_id, direction, channel, kind, summary, status, waiting_on) values (req, org, p1, 'outbound', 'whatsapp', 'request', 'Please send the assets', 'open', 'them');
  insert into project_communications (id, org_id, project_id, direction, channel, kind, summary) values (upd, org, p1, 'inbound', 'email', 'update', 'Assets received');
  perform pg_temp.refused(format($q$insert into project_communications (org_id, project_id, direction, channel, kind, summary, status, waiting_on) values (%L, %L, 'inbound', 'email', 'update', 'x', 'open', 'us')$q$, org, p1), null);
  perform pg_temp.refused(format($q$insert into project_communications (org_id, project_id, direction, channel, kind, summary, status) values (%L, %L, 'inbound', 'email', 'request', 'x', 'open')$q$, org, p1), null);
  perform pg_temp.refused(format($q$insert into project_communications (org_id, project_id, direction, channel, kind, summary, related_type) values (%L, %L, 'inbound', 'email', 'update', 'x', 'deliverable')$q$, org, p1), null);
  perform pg_temp.refused(format($q$insert into project_communications (org_id, project_id, direction, channel, kind, summary) values (%L, %L, 'inbound', 'carrier_pigeon', 'update', 'x')$q$, org, p1), null);
  raise notice 'PASS only a REQUEST can be open and it must say who is waiting; a related item needs both its type and id; unknown channels refused';
  perform pg_temp.refused(format($q$update project_communications set summary = 'rewritten' where id = %L$q$, req), 'cannot be edited');
  perform pg_temp.refused(format($q$update project_communications set summary = 'rewritten' where id = %L$q$, upd), 'cannot be edited');
  perform pg_temp.refused(format($q$delete from project_communications where id = %L$q$, upd), 'cannot be deleted');
  perform pg_temp.refused(format($q$update project_communications set status = 'done', waiting_on = null, resolved_at = now(), summary = 'sneaky' where id = %L$q$, req), 'cannot be edited');
  perform pg_temp.refused(format($q$update project_communications set status = 'done', waiting_on = null where id = %L$q$, req), 'cannot be edited');
  update project_communications set status = 'done', waiting_on = null, resolved_at = now(), resolution_note = 'Received' where id = req;
  perform pg_temp.refused(format($q$update project_communications set status = 'open', waiting_on = 'them' where id = %L$q$, req), 'cannot be edited');
  perform pg_temp.refused(format($q$update project_communications set resolution_note = 'changed my mind' where id = %L$q$, req), 'cannot be edited');
  raise notice 'PASS the log cannot be edited or deleted — the ONLY permitted change is resolving an open request (with a timestamp), once, and not smuggling any other edit with it';

  -- ===== deliverables: status and quantity can never contradict each other =====
  insert into deliverables (id, org_id, contract_id, description, planned_quantity, delivered_quantity, status) values (pl1, org, c1, 'planned', 10, 0, 'planned'), (m1, org, c1, 'missed', 5, 0, 'missed');
  insert into deliverables (org_id, contract_id, description, planned_quantity, delivered_quantity, status) values (org, c1, 'partial', 10, 4, 'partial'), (org, c1, 'delivered', 10, 10, 'delivered'), (org, c1, 'over', 10, 12, 'delivered');
  for v_n in 1..6 loop
    perform pg_temp.refused(format($q$insert into deliverables (org_id, contract_id, description, planned_quantity, delivered_quantity, status) values (%L, %L, 'bad', %s)$q$, org, c1,
      (array['10, 3, ''planned''', '10, 0, ''partial''', '10, 10, ''partial''', '10, 9, ''delivered''', '0, 0, ''planned''', '10, 0, ''pending'''])[v_n]), null);
  end loop;
  perform pg_temp.refused(format($q$insert into deliverables (org_id, contract_id, description, planned_quantity, delivered_quantity, status) values (%L, %L, 'neg', 10, -1, 'missed')$q$, org, c1), null);
  raise notice 'PASS status and quantity cannot contradict: planned needs 0 delivered; partial needs some but not all; delivered needs the full amount (over-delivery fine); zero planned, negatives and the retired "pending" status are refused';
  perform pg_temp.refused(format($q$update deliverables set invoice_adjustment = true where id = %L$q$, pl1), null);
  update deliverables set invoice_adjustment = true, adjustment_note = 'Credit 1 unit' where id = m1;
  perform pg_temp.refused(format($q$update deliverables set status = 'partial', delivered_quantity = 2 where id = %L$q$, m1), null);
  update deliverables set invoice_adjustment = false, adjustment_note = null where id = m1;
  raise notice 'PASS an invoice adjustment can only be flagged on a MISSED deliverable (and moving it on requires clearing the flag first)';

  -- ===== make-goods =====
  insert into deliverables (id, org_id, contract_id, description, planned_quantity, make_good_of) values (mg1, org, c1, 'make-good', 5, m1);
  perform pg_temp.refused(format($q$insert into deliverables (org_id, contract_id, description, make_good_of) values (%L, %L, 'x', %L)$q$, org, c1, pl1), 'Only a missed deliverable');
  perform pg_temp.refused(format($q$insert into deliverables (org_id, contract_id, description, make_good_of) values (%L, %L, 'x', %L)$q$, org, c2, m1), 'same contract');
  update deliverables set status = 'replaced' where id = m1;
  perform pg_temp.refused(format($q$insert into deliverables (org_id, contract_id, description, make_good_of) values (%L, %L, 'x', %L)$q$, org, c1, mg1), 'cannot itself be replaced');
  raise notice 'PASS a make-good must replace a MISSED deliverable on the SAME contract, and cannot itself be replaced';

  -- ===== RLS =====
  insert into auth.users (id) values (uTeam), (uAg);
  insert into agents (id, org_id, name) values (agco, org, 'AgentCo');
  insert into profiles (id, org_id, full_name, role_key, agent_id) values (uTeam, org, 't', 'team', null), (uAg, org, 'a', 'agent', agco);
  create temp table pseen (who text, a int, b int, c int, d int, e int, f int);
  grant all on pseen to authenticated;
  perform set_config('request.jwt.claim.sub', uTeam::text, true); set local role authenticated;
  insert into pseen select 'team', (select count(*) from projects), (select count(*) from project_checklist_items), (select count(*) from project_parties), (select count(*) from project_communications), (select count(*) from checklist_template_items), (select count(*) from deliverables); reset role;
  perform set_config('request.jwt.claim.sub', uAg::text, true); set local role authenticated;
  insert into pseen select 'agent', (select count(*) from projects), (select count(*) from project_checklist_items), (select count(*) from project_parties), (select count(*) from project_communications), (select count(*) from checklist_template_items), (select count(*) from deliverables); reset role;
  if (select (a, b, c, d) from pseen where who = 'team')::text <> '(4,1,2,2)' then perform pg_temp.fail('staff should see this organisation''s project data: ' || (select (a, b, c, d) from pseen where who = 'team')::text); end if;
  if (select e from pseen where who = 'team') < 30 then perform pg_temp.fail('staff cannot read the templates'); end if;
  if (select (a + b + c + d + e + f) from pseen where who = 'agent') <> 0 then perform pg_temp.fail('an AGENT can read project data: ' || (select row_to_json(x)::text from pseen x where who = 'agent')); end if;
  raise notice 'PASS staff read their organisation''s project data (and not another''s); an agent reads none of it, including the templates and deliverables';
end $$;
