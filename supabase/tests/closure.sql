\set ON_ERROR_STOP on
-- Stage 3 closure, the delivery-record lock, renewal links and case-study guards. Self-contained.
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
  org uuid := gen_random_uuid(); u uuid := gen_random_uuid(); uag uuid := gen_random_uuid(); agco uuid := gen_random_uuid(); brand uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); d3 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  del1 uuid := gen_random_uuid(); del2 uuid := gen_random_uuid(); ci uuid := gen_random_uuid(); pty uuid := gen_random_uuid(); met uuid := gen_random_uuid(); prf uuid := gen_random_uuid(); req uuid := gen_random_uuid();
  pr1 uuid := gen_random_uuid(); pr2 uuid := gen_random_uuid(); v_n int; msg text := 'This project is closed';
begin
  insert into organisations (id, name) values (org, 'ClosureOrg');
  insert into auth.users (id) values (u), (uag);
  insert into profiles (id, org_id, full_name, role_key) values (u, org, 'u', 'team');
  insert into brands (id, org_id, name) values (brand, org, 'B');
  insert into deals (id, org_id) values (d1, org), (d2, org), (d3, org);
  insert into contracts (id, org_id, deal_id, final_amount, renewal_date) values (c1, org, d1, 1, '2027-01-01'), (c2, org, d2, 1, '2027-01-01');   -- d3 has a project but NO contract
  insert into projects (id, org_id, deal_id, name, template_key) values (p1, org, d1, 'Closing', 'short'), (p2, org, d2, 'Neighbour', 'short'), (p3, org, d3, 'No contract', 'short');
  insert into deliverables (id, org_id, contract_id, description) values (del1, org, c1, 'D1'), (del2, org, c2, 'D2');
  insert into project_checklist_items (id, org_id, project_id, phase_no, phase_name, side, title) values (ci, org, p1, 1, 'P', 'team', 'step');
  insert into project_parties (id, org_id, project_id, role, side, name) values (pty, org, p1, 'vendor', 'delivery', 'V');
  insert into project_metrics (id, org_id, project_id, category_key, metric_key, value, recorded_on, source) values (met, org, p1, 'ooh_led', 'sites_live', 3, current_date, 's');
  insert into deliverable_proofs (id, org_id, deliverable_id, kind, name, url) values (prf, org, del1, 'link', 'L', 'https://drive.google.com/file/d/1AbCdEfGhIjKl/view');
  insert into project_communications (id, org_id, project_id, direction, channel, kind, summary, status, waiting_on) values (req, org, p1, 'inbound', 'email', 'request', 'open ask', 'open', 'us');

  -- ===== closing: the project row's own rules =====
  perform pg_temp.refused(format($q$update projects set status = 'closed' where id = %L$q$, p1), 'check constraint');
  perform pg_temp.refused(format($q$update projects set closed_at = now() where id = %L$q$, p1), 'check constraint');
  perform pg_temp.refused(format($q$update projects set status = 'closed', closed_at = now() where id = %L$q$, p1), 'check constraint');
  perform pg_temp.refused(format($q$update projects set closure_warnings = '{}'::jsonb where id = %L$q$, p1), 'check constraint');
  raise notice 'PASS a project is closed only with a closing time AND a person; "closed" and "closed_at" can never disagree';

  -- ===== BEFORE closing, everything is editable (so the lock below proves something) =====
  update project_checklist_items set notes = 'before' where id = ci; update project_parties set contact = 'before' where id = pty; update deliverables set description = 'D1 before' where id = del1;
  insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source) values (org, p1, 'ooh_led', 'sites_live', 4, current_date, 's');
  insert into deliverable_proofs (id, org_id, deliverable_id, kind, name, url) values (pr1, org, del1, 'link', 'L2', 'https://drive.google.com/file/d/2AbCdEfGhIjKl/view');

  update projects set status = 'closed', closed_at = now(), closed_by = u, closure_note = 'Done', closure_warnings = '[{"code":"steps_open","count":1}]' where id = p1;

  -- ===== THE LOCK =====
  perform pg_temp.refused(format($q$update project_checklist_items set notes = 'after' where id = %L$q$, ci), msg);
  perform pg_temp.refused(format($q$insert into project_checklist_items (org_id, project_id, phase_no, phase_name, side, title) values (%L, %L, 1, 'P', 'team', 'new step')$q$, org, p1), msg);
  perform pg_temp.refused(format($q$update project_checklist_items set archived_at = now() where id = %L$q$, ci), msg);
  perform pg_temp.refused(format($q$update project_parties set contact = 'after' where id = %L$q$, pty), msg);
  perform pg_temp.refused(format($q$insert into project_parties (org_id, project_id, role, side, name) values (%L, %L, 'other', 'brand', 'new')$q$, org, p1), msg);
  perform pg_temp.refused(format($q$insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source) values (%L, %L, 'ooh_led', 'sites_live', 9, current_date, 's')$q$, org, p1), msg);
  perform pg_temp.refused(format($q$update project_metrics set voided_at = now(), voided_by = %L, void_reason = 'late change' where id = %L$q$, u, met), msg);
  perform pg_temp.refused(format($q$update deliverables set delivered_quantity = 1, status = 'delivered' where id = %L$q$, del1), msg);
  perform pg_temp.refused(format($q$insert into deliverables (org_id, contract_id, description) values (%L, %L, 'late addition')$q$, org, c1), msg);
  perform pg_temp.refused(format($q$insert into deliverable_proofs (org_id, deliverable_id, kind, name, url) values (%L, %L, 'link', 'late', 'https://drive.google.com/file/d/3AbCdEfGhIjKl/view')$q$, org, del1), msg);
  perform pg_temp.refused(format($q$update deliverable_proofs set archived_at = now() where id = %L$q$, prf), msg);
  raise notice 'PASS once closed, checklist, parties, metrics (including voiding), deliverables and proof are ALL locked — by the database, so no route can bypass it';

  -- ===== what the lock must NOT touch =====
  insert into project_communications (org_id, project_id, direction, channel, kind, summary) values (org, p1, 'inbound', 'email', 'update', 'a late message');
  update project_communications set status = 'done', waiting_on = null, resolved_at = now(), resolved_by = u where id = req;
  update deliverables set description = 'neighbour edited' where id = del2;
  insert into project_checklist_items (org_id, project_id, phase_no, phase_name, side, title) values (org, p2, 1, 'P', 'team', 'neighbour step');
  insert into deliverables (org_id, contract_id, description) values (org, c2, 'neighbour new');
  update projects set name = 'Closing (renamed)' where id = p1;
  raise notice 'PASS the communication log stays open on a closed project (and its requests can still be resolved); a NEIGHBOURING project is unaffected; renaming is allowed';

  -- ===== reopening restores everything =====
  update projects set status = 'active', closed_at = null, closed_by = null where id = p1;
  update project_checklist_items set notes = 'reopened' where id = ci; update deliverables set description = 'D1 reopened' where id = del1;
  insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source) values (org, p1, 'ooh_led', 'sites_live', 5, current_date, 's');
  update deliverable_proofs set archived_at = now() where id = prf; update project_parties set contact = 'reopened' where id = pty;
  raise notice 'PASS reopening a project unlocks it again';

  -- a project whose deal has no contract has nothing to lock on the contract side
  update projects set status = 'closed', closed_at = now(), closed_by = u where id = p3;
  update projects set status = 'active', closed_at = null, closed_by = null where id = p3;

  -- ===== one renewal proposal per project =====
  insert into proposals (id, org_id, brand_id, renewal_of_project_id) values (pr2, org, brand, p1);
  perform pg_temp.refused(format($q$insert into proposals (org_id, brand_id, renewal_of_project_id) values (%L, %L, %L)$q$, org, brand, p1), 'duplicate key');
  insert into proposals (org_id, brand_id, renewal_of_project_id) values (org, brand, p2);
  insert into proposals (org_id, brand_id) values (org, brand); insert into proposals (org_id, brand_id) values (org, brand);
  raise notice 'PASS a project can have only ONE renewal proposal (closing twice cannot make two); ordinary proposals are unlimited';

  -- ===== chat-import marker =====
  select count(*) into v_n from project_communications where source = 'manual'; if v_n < 1 then perform pg_temp.fail('log entries should default to source manual'); end if;
  perform pg_temp.refused(format($q$insert into project_communications (org_id, project_id, direction, channel, kind, summary, source) values (%L, %L, 'inbound', 'email', 'update', 'x', 'telepathy')$q$, org, p1), 'check constraint');
  insert into project_communications (org_id, project_id, direction, channel, kind, summary, source) values (org, p1, 'inbound', 'whatsapp', 'update', 'imported', 'chat_import');
  perform pg_temp.refused(format($q$update project_communications set source = 'manual' where summary = 'imported' and project_id = %L$q$, p1), 'cannot be edited');
  raise notice 'PASS log entries record whether they were typed or imported from a chat, and that cannot be altered afterwards';

  -- ===== case studies =====
  insert into case_studies (org_id, project_id, title, body, brand_name, hidden_names) values (org, p1, 'T', 'B', 'Blitz Casino', array['Blitz Casino', 'Blitz', 'Apex']);
  perform pg_temp.refused(format($q$insert into case_studies (org_id, project_id, title, body, brand_name) values (%L, %L, 'T2', 'B2', 'x')$q$, org, p1), 'duplicate key');
  perform pg_temp.refused(format($q$update case_studies set status = 'approved' where project_id = %L$q$, p1), 'check constraint');
  perform pg_temp.refused(format($q$update case_studies set named_use_approved = true where project_id = %L$q$, p1), 'check constraint');
  perform pg_temp.refused(format($q$update case_studies set status = 'approved', approved_at = now(), approved_by = %L, anonymised_title = 'A case', anonymised_body = 'Delivered with BLITZ in the UAE' where project_id = %L$q$, u, p1), 'still contains "Blitz');
  perform pg_temp.refused(format($q$update case_studies set status = 'approved', approved_at = now(), approved_by = %L, anonymised_title = 'Case with apex', anonymised_body = 'clean' where project_id = %L$q$, u, p1), 'still contains "Apex"');
  update case_studies set status = 'approved', approved_at = now(), approved_by = u, anonymised_title = 'A case', anonymised_body = 'Delivered for the brand with a partner in the UAE' where project_id = p1;
  update case_studies set named_use_approved = true where project_id = p1;
  perform pg_temp.refused(format($q$update case_studies set anonymised_body = 'Blitz returned' where project_id = %L$q$, p1), 'still contains');
  update case_studies set hidden_names = array['ab', ''], status = 'draft', approved_at = null, approved_by = null, named_use_approved = false where project_id = p1;
  raise notice 'PASS a case study cannot be approved unless anonymised fields exist, and the DATABASE refuses an approval whose anonymised text still contains a hidden name (any case, anywhere in the text) — even on a later edit';

  -- ===== RLS =====
  insert into agents (id, org_id, name) values (agco, org, 'AC'); insert into profiles (id, org_id, full_name, role_key, agent_id) values (uag, org, 'a', 'agent', agco);
  create temp table seen4 (who text, a int); grant all on seen4 to authenticated;
  perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; insert into seen4 select 'team', count(*) from case_studies; reset role;
  perform set_config('request.jwt.claim.sub', uag::text, true); set local role authenticated; insert into seen4 select 'agent', count(*) from case_studies; reset role;
  if (select a from seen4 where who = 'team') <> 1 or (select a from seen4 where who = 'agent') <> 0 then perform pg_temp.fail('case-study visibility is wrong'); end if;
  raise notice 'PASS staff read their organisation''s case studies; an agent reads none';
end $$;
