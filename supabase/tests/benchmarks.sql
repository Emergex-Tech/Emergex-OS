\set ON_ERROR_STOP on
-- Benchmarks (B18) and shortlists/saved filters (B22), against a real database. Self-contained.
create or replace function pg_temp.fail(msg text) returns void language plpgsql as $$ begin raise exception 'FAIL: %', msg; end $$;

do $$
declare
  org uuid := gen_random_uuid(); org2 uuid := gen_random_uuid(); v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  i1 uuid := gen_random_uuid(); i2 uuid := gen_random_uuid(); i3 uuid := gen_random_uuid(); i4 uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); uag uuid := gen_random_uuid(); agco uuid := gen_random_uuid();
  sl1 uuid := gen_random_uuid(); sl2 uuid := gen_random_uuid(); sl3 uuid := gen_random_uuid();
  r record; k int; msg text;
begin
  insert into organisations (id, name) values (org, 'BenchOrg'), (org2, 'OtherBench');
  insert into categories (key, label, group_label, reconfirmation_rule) values ('ooh_led', 'OOH', 'Media', '60day'), ('player_athlete', 'Player', 'Talent', '60day') on conflict do nothing;
  insert into vendors (id, org_id, name) values (v1, org, 'V1'), (v2, org, 'V2');
  insert into properties (id, org_id, category_key, name, vendor_id, market, event_start) values
    (p1, org, 'ooh_led', 'P1', v1, 'UAE', current_date + 100), (p2, org, 'ooh_led', 'P2', v2, 'UK', null),
    (p3, org, 'player_athlete', 'P3', v1, 'UAE', null), (p4, org2, 'ooh_led', 'P4', null, 'UAE', null);
  insert into items (id, org_id, property_id, name) values (i1, org, p1, 'I1'), (i2, org, p2, 'I2'), (i3, org, p3, 'I3'), (i4, org2, p4, 'I4');
  insert into price_records (org_id, item_id, type, amount, currency, unit, price_date, days_to_event) values
    (org, i1, 'rack',       10000, 'USD', 'per_match', current_date - 10, 90),
    (org, i1, 'quote',      20000, 'USD', 'per_match', current_date - 20, 80),
    (org, i1, 'negotiated', 30000, 'USD', 'per_match', current_date - 30, null),   -- days derived: event_start - price_date = 130
    (org, i1, 'transacted', 40000, 'USD', 'per_match', current_date - 5, 200),
    (org, i1, 'rack',        5000, 'USD', 'flat',      current_date - 10, 90),     -- a different unit: must never mix in
    (org, i1, 'rack',         999, 'EUR', 'per_match', current_date - 10, 90),     -- a different currency: must never mix in
    (org, i1, 'market_intel',99999,'USD', 'per_match', current_date - 10, 90),     -- market intel is not a cost
    (org, i1, 'rack',           0, 'USD', 'per_match', current_date - 10, 90),     -- zero is not a price
    (org, i2, 'rack',       50000, 'USD', 'per_match', current_date - 10, null),
    (org, i3, 'rack',         777, 'USD', 'per_match', current_date - 10, null),
    (org2, i4,'rack',      123456, 'USD', 'per_match', current_date - 10, null);   -- another organisation
  begin insert into price_records (org_id, item_id, type, amount, currency, unit, price_date) values (org, i1, 'rack', null, 'USD', 'per_match', current_date); exception when not_null_violation then null; end;

  -- ===== B18: the statistics =====
  select count(*) into k from price_benchmark(org); if k <> 3 then perform pg_temp.fail('expected 3 (unit,currency) groups, got ' || k); end if;
  select * into r from price_benchmark(org) limit 1;
  if r.unit <> 'per_match' or r.currency <> 'USD' or r.n <> 6 then perform pg_temp.fail('largest group should be per_match/USD with 6 prices, got ' || r.unit || '/' || r.currency || '/' || r.n); end if;
  raise notice 'PASS prices are grouped by (unit, currency) and never mixed: per_match/USD, flat/USD and per_match/EUR are three separate groups';

  select * into r from price_benchmark(org, 'ooh_led', 'uae', null, 'per_match', 'USD');
  if r.n <> 4 or r.min_amount <> 10000 or r.p25 <> 17500 or r.median <> 25000 or r.p75 <> 32500 or r.max_amount <> 40000 then
    perform pg_temp.fail('statistics wrong: ' || row_to_json(r)::text); end if;
  if r.oldest <> current_date - 30 or r.newest <> current_date - 5 then perform pg_temp.fail('date range wrong'); end if;
  raise notice 'PASS hand-computed statistics: n=4, min 10,000, p25 17,500, median 25,000, p75 32,500, max 40,000 (market matched case-insensitively; zero, market-intel, other-unit and other-currency prices excluded)';

  select * into r from price_benchmark(org, null, null, v2, 'per_match', 'USD'); if r.n <> 1 or r.median <> 50000 then perform pg_temp.fail('vendor filter wrong'); end if;
  select * into r from price_benchmark(org, 'player_athlete', null, null, 'per_match', 'USD'); if r.n <> 1 or r.median <> 777 then perform pg_temp.fail('category filter wrong'); end if;
  select * into r from price_benchmark(org, 'ooh_led', 'UAE', null, 'per_match', 'USD', null, null, null, array['market_intel']); if r.n <> 1 or r.median <> 99999 then perform pg_temp.fail('market-intel series wrong'); end if;
  raise notice 'PASS vendor and category filters work, and market intel is available only as its own separate series';

  select * into r from price_benchmark(org, 'ooh_led', 'UAE', null, 'per_match', 'USD', 75, 100); if r.n <> 2 or r.median <> 15000 then perform pg_temp.fail('days 75-100 should keep the 90- and 80-day prices: ' || coalesce(row_to_json(r)::text, 'none')); end if;
  select * into r from price_benchmark(org, 'ooh_led', 'UAE', null, 'per_match', 'USD', 120, null); if r.n <> 2 or r.median <> 35000 then perform pg_temp.fail('days >=120 should keep the DERIVED 130 and the recorded 200: ' || coalesce(row_to_json(r)::text, 'none')); end if;
  raise notice 'PASS days-to-event filter: a recorded value is used as-is, and a missing one is derived from the event date (the negotiated price at 130 days was found)';
  select count(*) into k from price_benchmark(org, 'ooh_led', 'UK', null, 'per_match', 'USD', 0, null); if k <> 0 then perform pg_temp.fail('a price with no days AND no event date was guessed into a days filter'); end if;
  select * into r from price_benchmark(org, 'ooh_led', 'UK', null, 'per_match', 'USD'); if r.n <> 1 then perform pg_temp.fail('without a days filter that price should count'); end if;
  raise notice 'PASS a price with no days and no event date is left OUT of a days filter (never guessed) but still counts without one';

  select * into r from price_benchmark(org, 'ooh_led', 'UAE', null, 'per_match', 'USD', null, null, current_date - 12); if r.n <> 2 or r.median <> 25000 then perform pg_temp.fail('since filter wrong'); end if;
  select * into r from price_benchmark(org2); if r.n <> 1 or r.median <> 123456 then perform pg_temp.fail('org2 should see only its own price'); end if;
  select count(*) into k from price_benchmark(org) where median = 123456 or max_amount = 123456; if k <> 0 then perform pg_temp.fail('another organisation''s price leaked in'); end if;
  raise notice 'PASS the since-date filter works, and one organisation''s prices never appear in another''s benchmark';

  -- ===== B22: tables =====
  insert into auth.users (id) values (u1), (u2), (uag);
  insert into agents (id, org_id, name) values (agco, org, 'AgentCo');
  insert into profiles (id, org_id, full_name, role_key, agent_id) values (u1, org, 'u1', 'team', null), (u2, org, 'u2', 'team', null), (uag, org, 'ag', 'agent', agco);
  insert into saved_filters (org_id, owner_id, name, shared) values (org, u1, 'F1 private', false), (org, u1, 'F2 shared', true), (org, u2, 'F3 private', false);
  insert into shortlists (id, org_id, owner_id, name, shared) values (sl1, org, u1, 'S1', false), (sl2, org, u1, 'S2', true), (sl3, org, u2, 'S3', false);
  insert into shortlist_items (shortlist_id, item_id, org_id) values (sl1, i1, org), (sl2, i1, org), (sl3, i2, org);

  create temp table seen (who text, f int, s int, si int);
  grant all on seen to authenticated;
  perform set_config('request.jwt.claim.sub', u1::text, true); set local role authenticated;
  insert into seen select 'u1', (select count(*) from saved_filters), (select count(*) from shortlists), (select count(*) from shortlist_items); reset role;
  perform set_config('request.jwt.claim.sub', u2::text, true); set local role authenticated;
  insert into seen select 'u2', (select count(*) from saved_filters), (select count(*) from shortlists), (select count(*) from shortlist_items); reset role;
  perform set_config('request.jwt.claim.sub', uag::text, true); set local role authenticated;
  insert into seen select 'agent', (select count(*) from saved_filters), (select count(*) from shortlists), (select count(*) from shortlist_items); reset role;
  if (select (f, s, si) from seen where who = 'u1')::text <> '(2,2,2)' then perform pg_temp.fail('u1 should see own 2 + shared: ' || (select (f, s, si) from seen where who = 'u1')::text); end if;
  if (select (f, s, si) from seen where who = 'u2')::text <> '(2,2,2)' then perform pg_temp.fail('u2 should see own 1 + the one shared by u1: ' || (select (f, s, si) from seen where who = 'u2')::text); end if;
  if (select (f, s, si) from seen where who = 'agent')::text <> '(0,0,0)' then perform pg_temp.fail('an AGENT can read filters/shortlists'); end if;
  raise notice 'PASS you see your own filters/shortlists plus those others shared; never another person''s private ones; an agent sees none';

  perform set_config('request.jwt.claim.sub', u1::text, true); set local role authenticated;
  begin insert into shortlists (org_id, owner_id, name) values (org, u1, 'direct'); msg := 'ALLOWED'; exception when others then msg := 'denied'; end;
  update shortlists set name = 'hijack' where id = sl3; get diagnostics k = row_count; msg := msg || '/' || case when k = 0 then 'denied' else 'ALLOWED' end;
  delete from shortlists where id = sl3; get diagnostics k = row_count; msg := msg || '/' || case when k = 0 then 'denied' else 'ALLOWED' end;
  reset role;
  if msg <> 'denied/denied/denied' then perform pg_temp.fail('direct writes possible: ' || msg); end if;
  raise notice 'PASS nobody can write these tables directly (insert denied; update/delete of someone else''s list match 0 rows)';

  begin insert into shortlists (org_id, owner_id, name) values (org, u1, 's1'); perform pg_temp.fail('duplicate name (case-insensitive) accepted');
  exception when unique_violation then null; end;
  insert into shortlists (org_id, owner_id, name) values (org, u2, 'S1');   -- another person may reuse the name
  begin insert into shortlists (org_id, owner_id, name) values (org, u1, '   '); perform pg_temp.fail('blank name accepted'); exception when check_violation then null; end;
  begin insert into saved_filters (org_id, owner_id, name, criteria) values (org, u1, 'arr', '[1]'); perform pg_temp.fail('non-object criteria accepted'); exception when check_violation then null; end;
  begin insert into shortlist_items (shortlist_id, item_id, org_id) values (sl1, i4, org); perform pg_temp.fail('an item from another organisation was shortlisted');
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like '%same organisation%' then perform pg_temp.fail('wrong error: ' || sqlerrm); end if; end;
  begin insert into shortlist_items (shortlist_id, item_id, org_id) values (sl1, i1, org); perform pg_temp.fail('same item twice accepted'); exception when unique_violation then null; end;
  raise notice 'PASS names are unique per person (case-insensitive) but reusable across people; blank names, non-object criteria, cross-organisation items and duplicates are refused';

  delete from shortlists where id = sl3;
  select count(*) into k from shortlist_items where shortlist_id = sl3; if k <> 0 then perform pg_temp.fail('deleting a shortlist left its items behind'); end if;
  raise notice 'PASS deleting a shortlist removes its items';
end $$;
