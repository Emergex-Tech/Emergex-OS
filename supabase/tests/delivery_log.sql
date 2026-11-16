\set ON_ERROR_STOP on
-- The delivery log, waived status, proof on a log entry, and the lock. Self-contained and re-runnable.
create or replace function pg_temp.fail(msg text) returns void language plpgsql as $$ begin raise exception 'FAIL: %', msg; end $$;
create or replace function pg_temp.refused(stmt text, expect text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: this was accepted but must be refused: %', stmt;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if expect is not null and sqlerrm not like '%' || expect || '%' then raise exception 'FAIL: refused for the wrong reason (wanted "%", got "%") for: %', expect, sqlerrm, stmt; end if;
end $$;
create or replace function pg_temp.state(p uuid) returns text language sql as $$ select delivered_quantity::numeric(14,0) || ' ' || status || ' ' || invoice_adjustment from deliverables where id = p $$;

do $$
declare
  org uuid := gen_random_uuid(); org2 uuid := gen_random_uuid(); u uuid := gen_random_uuid(); uag uuid := gen_random_uuid(); agco uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); p1 uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); w uuid := gen_random_uuid(); r uuid := gen_random_uuid(); legacy uuid := gen_random_uuid();
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid(); eb uuid := gen_random_uuid(); xw uuid := gen_random_uuid(); exw uuid := gen_random_uuid(); v_n int;
begin
  insert into organisations (id, name) values (org, 'LogOrg'), (org2, 'Other');
  insert into auth.users (id) values (u), (uag);
  insert into profiles (id, org_id, full_name, role_key) values (u, org, 'u', 'team');
  insert into deals (id, org_id) values (d1, org);
  insert into contracts (id, org_id, deal_id, final_amount, renewal_date) values (c1, org, d1, 1, '2027-01-01');
  insert into projects (id, org_id, deal_id, name, template_key) values (p1, org, d1, 'P', 'short');
  insert into deliverables (id, org_id, contract_id, description, planned_quantity) values (a, org, c1, 'Posts', 4), (b, org, c1, 'Missed thing', 3), (c, org, c1, 'Closed-test', 2), (legacy, org, c1, 'No log', 5);
  insert into deliverables (id, org_id, contract_id, description, status, waived_reason) values (w, org, c1, 'Meet and greet', 'waived', 'Not wanted by the brand');
  insert into deliverables (id, org_id, contract_id, description, status) values (r, org, c1, 'Replaced', 'replaced');

  -- ===== the delivered number is DERIVED from the log =====
  insert into deliverable_events (id, org_id, deliverable_id, occurred_on, label, created_by) values (e1, org, a, '2026-07-17', 'vs Jaffna Kings', u);
  if pg_temp.state(a) <> '1 partial false' then perform pg_temp.fail('one entry of 4 planned should read 1 / partial: ' || pg_temp.state(a)); end if;
  insert into deliverable_events (id, org_id, deliverable_id, occurred_on, quantity) values (e2, org, a, '2026-07-18', 2), (e3, org, a, '2026-07-22', 1);
  if pg_temp.state(a) <> '4 delivered false' then perform pg_temp.fail('4 of 4 should be delivered: ' || pg_temp.state(a)); end if;
  insert into deliverable_events (org_id, deliverable_id, occurred_on, quantity) values (org, a, '2026-07-23', 1.5);
  if (select delivered_quantity from deliverables where id = a) <> 5.5 or (select status from deliverables where id = a) <> 'delivered' then perform pg_temp.fail('over-delivery stays delivered with the true total'); end if;
  raise notice 'PASS each log entry moves the delivered quantity and the status by itself: partial, delivered, and over-delivery keeps the true total';

  -- ===== voiding recalculates; the entry itself is immutable =====
  perform pg_temp.refused(format($q$update deliverable_events set quantity = 9 where id = %L$q$, e1), 'cannot be edited');
  perform pg_temp.refused(format($q$update deliverable_events set occurred_on = '2020-01-01' where id = %L$q$, e1), 'cannot be edited');
  perform pg_temp.refused(format($q$delete from deliverable_events where id = %L$q$, e1), 'cannot be deleted');
  perform pg_temp.refused(format($q$update deliverable_events set voided_at = now(), void_reason = 'x' where id = %L$q$, e1), 'cannot be edited');
  perform pg_temp.refused(format($q$update deliverable_events set voided_at = now(), voided_by = %L, void_reason = 'x', quantity = 3 where id = %L$q$, u, e1), 'cannot be edited');
  update deliverable_events set voided_at = now(), voided_by = u, void_reason = 'Logged twice' where id = e2;
  if (select delivered_quantity from deliverables where id = a) <> 3.5 or (select status from deliverables where id = a) <> 'partial' then perform pg_temp.fail('voiding an entry must recalculate: ' || pg_temp.state(a)); end if;
  perform pg_temp.refused(format($q$update deliverable_events set voided_at = null, voided_by = null, void_reason = null where id = %L$q$, e2), 'cannot be edited');
  update deliverable_events set voided_at = now(), voided_by = u, void_reason = 'reset' where deliverable_id = a and voided_at is null;
  if pg_temp.state(a) <> '0 planned false' then perform pg_temp.fail('all entries voided should be back to planned: ' || pg_temp.state(a)); end if;
  raise notice 'PASS an entry can only be voided (once, with a person and a reason) — and voiding recalculates the delivered quantity, all the way back to planned';

  -- ===== the number cannot be typed over while a log exists =====
  insert into deliverable_events (org_id, deliverable_id, occurred_on, quantity) values (org, a, '2026-08-01', 2);
  perform pg_temp.refused(format($q$update deliverables set delivered_quantity = 4, status = 'delivered' where id = %L$q$, a), 'tracked by its delivery log');
  update deliverables set delivered_quantity = 2 where id = a;                                    -- the same number is not a contradiction
  update deliverables set delivered_quantity = 3, status = 'partial' where id = legacy;            -- a deliverable WITHOUT a log still works the old way
  update deliverables set description = 'Posts (renamed)' where id = a;
  raise notice 'PASS once a log exists the delivered number cannot be typed over; deliverables without a log still take a typed number';

  -- ===== missed + log =====
  update deliverables set status = 'missed', invoice_adjustment = true, adjustment_note = 'credit' where id = b;
  insert into deliverable_events (id, org_id, deliverable_id, occurred_on, quantity) values (eb, org, b, '2026-08-02', 1);
  if pg_temp.state(b) <> '1 partial false' then perform pg_temp.fail('a late delivery on a MISSED deliverable should make it partial and clear the invoice flag: ' || pg_temp.state(b)); end if;
  update deliverables set status = 'missed' where id = b; update deliverable_events set voided_at = now(), voided_by = u, void_reason = 'wrong' where id = eb;
  if pg_temp.state(b) <> '0 missed false' then perform pg_temp.fail('a missed deliverable whose only entry is voided stays MISSED, not planned: ' || pg_temp.state(b)); end if;
  raise notice 'PASS a late delivery turns a missed deliverable partial and clears its invoice-adjustment flag; with nothing logged, missed stays missed';

  -- ===== bad entries =====
  perform pg_temp.refused(format($q$insert into deliverable_events (org_id, deliverable_id, occurred_on, quantity) values (%L, %L, '2026-08-01', 0)$q$, org, a), 'check constraint');
  perform pg_temp.refused(format($q$insert into deliverable_events (org_id, deliverable_id, occurred_on, quantity) values (%L, %L, '2026-08-01', -1)$q$, org, a), 'check constraint');
  perform pg_temp.refused(format($q$insert into deliverable_events (org_id, deliverable_id, quantity) values (%L, %L, 1)$q$, org, a), 'null value');
  perform pg_temp.refused(format($q$insert into deliverable_events (org_id, deliverable_id, occurred_on, source) values (%L, %L, '2026-08-01', 'telepathy')$q$, org, a), 'check constraint');
  perform pg_temp.refused(format($q$insert into deliverable_events (org_id, deliverable_id, occurred_on) values (%L, %L, '2026-08-01')$q$, org2, a), 'same organisation');
  perform pg_temp.refused(format($q$insert into deliverable_events (org_id, deliverable_id, occurred_on) values (%L, %L, '2026-08-01')$q$, org, r), 'replaced by a make-good');
  perform pg_temp.refused(format($q$insert into deliverable_events (org_id, deliverable_id, occurred_on) values (%L, %L, '2026-08-01')$q$, org, w), 'waived by the brand');
  raise notice 'PASS zero or negative quantities, a missing date, another organisation, and replaced or waived deliverables all refuse a log entry';

  -- ===== waived =====
  perform pg_temp.refused(format($q$update deliverables set status = 'waived' where id = %L$q$, legacy), 'check constraint');
  perform pg_temp.refused(format($q$update deliverables set waived_reason = 'x' where id = %L$q$, legacy), 'check constraint');
  perform pg_temp.refused(format($q$update deliverables set invoice_adjustment = true where id = %L$q$, w), 'check constraint');
  perform pg_temp.refused(format($q$update deliverables set status = 'cancelled' where id = %L$q$, legacy), 'check constraint');
  update deliverables set status = 'waived', waived_reason = 'Brand dropped it' where id = legacy;       -- keeps the 3 that were delivered
  if (select delivered_quantity from deliverables where id = legacy) <> 3 then perform pg_temp.fail('waiving must keep what was delivered'); end if;
  update deliverables set status = 'partial', waived_reason = null where id = legacy;
  perform pg_temp.refused(format($q$update deliverables set period_label = '  ' where id = %L$q$, a), 'check constraint');
  perform pg_temp.refused(format($q$update deliverables set vendor_quantity = 0 where id = %L$q$, a), 'check constraint');
  update deliverables set period_label = 'Year 1', vendor_quantity = 4000000 where id = a;
  raise notice 'PASS waived always carries its reason (and only waived does), keeps what was delivered, and can be reinstated; period and vendor quantity are constrained';

  -- ===== proof on a log entry; metric segment =====
  insert into deliverable_proofs (org_id, deliverable_id, kind, name, url, event_id, platform) values (org, a, 'link', 'Instagram', 'https://www.instagram.com/p/abc/', e1, 'instagram');
  perform pg_temp.refused(format($q$insert into deliverable_proofs (org_id, deliverable_id, kind, name, url, event_id) values (%L, %L, 'link', 'x', 'https://www.instagram.com/p/zzz/', %L)$q$, org, b, e1), 'its own deliverable');
  perform pg_temp.refused(format($q$insert into deliverable_proofs (org_id, deliverable_id, kind, name, url, platform) values (%L, %L, 'link', 'x', 'https://x.test/1', 'myspace')$q$, org, a), 'check constraint');
  insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source, segment) values (org, p1, 'digital_publisher_app', 'impressions', 100, current_date, 's', 'IN · Banner');
  perform pg_temp.refused(format($q$insert into project_metrics (org_id, project_id, category_key, metric_key, value, recorded_on, source, segment) values (%L, %L, 'digital_publisher_app', 'impressions', 1, current_date, 's', %L)$q$, org, p1, repeat('x', 61)), 'check constraint');
  raise notice 'PASS a proof can hang on one log entry of its own deliverable only; platforms and metric segments are constrained';

  -- ===== the closed-project lock covers the log =====
  insert into deliverable_events (org_id, deliverable_id, occurred_on) values (org, c, '2026-08-01');
  -- a deliverable that was logged and THEN waived: voiding its entry recalculates nothing, so only the log's own lock protects it
  insert into deliverables (id, org_id, contract_id, description, planned_quantity) values (xw, org, c1, 'Logged then waived', 2);
  insert into deliverable_events (id, org_id, deliverable_id, occurred_on) values (exw, org, xw, '2026-08-01');
  update deliverables set status = 'waived', waived_reason = 'Brand dropped it' where id = xw;
  update projects set status = 'closed', closed_at = now(), closed_by = u where id = p1;
  perform pg_temp.refused(format($q$update deliverable_events set voided_at = now(), voided_by = %L, void_reason = 'late' where id = %L$q$, u, exw), 'This project is closed');
  perform pg_temp.refused(format($q$insert into deliverable_events (org_id, deliverable_id, occurred_on) values (%L, %L, '2026-08-02')$q$, org, c), 'This project is closed');
  perform pg_temp.refused(format($q$update deliverable_events set voided_at = now(), voided_by = %L, void_reason = 'late' where deliverable_id = %L$q$, u, c), 'This project is closed');
  if pg_temp.state(c) <> '1 partial false' then perform pg_temp.fail('a closed project''s delivered number must not move: ' || pg_temp.state(c)); end if;
  update projects set status = 'active', closed_at = null, closed_by = null where id = p1;
  insert into deliverable_events (org_id, deliverable_id, occurred_on) values (org, c, '2026-08-02');
  if pg_temp.state(c) <> '2 delivered false' then perform pg_temp.fail('reopened: the log works again'); end if;
  raise notice 'PASS on a closed project the delivery log is locked (no new entry, no void) and unlocks on reopening';

  -- ===== RLS =====
  insert into agents (id, org_id, name) values (agco, org, 'AC'); insert into profiles (id, org_id, full_name, role_key, agent_id) values (uag, org, 'a', 'agent', agco);
  create temp table seen6 (who text, n int); grant all on seen6 to authenticated;
  perform set_config('request.jwt.claim.sub', u::text, true); set local role authenticated; insert into seen6 select 'team', count(*) from deliverable_events; reset role;
  perform set_config('request.jwt.claim.sub', uag::text, true); set local role authenticated; insert into seen6 select 'agent', count(*) from deliverable_events; reset role;
  if (select n from seen6 where who = 'team') < 5 or (select n from seen6 where who = 'agent') <> 0 then perform pg_temp.fail('delivery-log visibility is wrong'); end if;
  drop table seen6;
  raise notice 'PASS staff read their organisation''s delivery log; an agent reads none';
end $$;
