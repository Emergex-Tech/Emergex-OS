\set ON_ERROR_STOP on
-- Conflict-check scenarios (A21–A24) against a real database. Self-contained: makes its own org.
create or replace function pg_temp.n(p_org uuid, p_item uuid, p_brand uuid, p_route uuid, p_type text default null)
returns int language sql as $$
  select count(*)::int from check_share_conflicts(p_org, p_item, p_brand, p_route) where p_type is null or conflict_type = p_type $$;
create or replace function pg_temp.expect(p_name text, p_actual int, p_expected int) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then raise exception 'FAIL %: expected %, got %', p_name, p_expected, p_actual; end if;
  raise notice 'PASS %', p_name;
end $$;

do $$
declare
  org uuid := gen_random_uuid(); org2 uuid := gen_random_uuid();
  grp uuid := gen_random_uuid();
  blitz uuid := gen_random_uuid(); spin uuid := gen_random_uuid(); king uuid := gen_random_uuid();
  rival uuid := gen_random_uuid(); motion uuid := gen_random_uuid();
  mer uuid := gen_random_uuid();
  r_blitz_direct uuid := gen_random_uuid(); r_blitz_mer uuid := gen_random_uuid(); r_king_mer uuid := gen_random_uuid();
  r_spin uuid := gen_random_uuid(); r_rival_uae uuid := gen_random_uuid(); r_rival_uk uuid := gen_random_uuid();
  r_rival_null uuid := gen_random_uuid(); r_motion uuid := gen_random_uuid();
  prop uuid := gen_random_uuid();
  i uuid;
begin
  insert into organisations (id, name) values (org, 'ConflictOrg'), (org2, 'OtherOrg');
  insert into categories (key, label, group_label, reconfirmation_rule) values ('ooh_led', 'OOH', 'Media', '60day') on conflict do nothing;
  insert into brand_groups (id, org_id, name) values (grp, org, 'Group');
  insert into brands (id, org_id, name, brand_group_id) values
    (blitz, org, 'Blitz', grp), (spin, org, 'Spin', grp), (king, org, 'Kingfish', null), (rival, org, 'Rival', null), (motion, org, 'Motion', null);
  insert into agents (id, org_id, name) values (mer, org, 'Meridian');
  insert into routes (id, org_id, brand_id, route_type, agent_id, market) values
    (r_blitz_direct, org, blitz, 'direct', null, 'UAE'), (r_blitz_mer, org, blitz, 'via_agent', mer, 'UAE'),
    (r_king_mer, org, king, 'via_agent', mer, 'UAE'), (r_spin, org, spin, 'direct', null, 'UAE'),
    (r_rival_uae, org, rival, 'direct', null, 'UAE'), (r_rival_uk, org, rival, 'direct', null, 'UK'),
    (r_rival_null, org, rival, 'direct', null, null), (r_motion, org, motion, 'direct', null, 'UAE');
  insert into properties (id, org_id, category_key, name) values (prop, org, 'ooh_led', 'Prop');

  -- S0 nothing shared yet
  i := gen_random_uuid(); insert into items (id, org_id, property_id, name) values (i, org, prop, 'S0');
  perform pg_temp.expect('S0 no prior shares -> no conflicts', pg_temp.n(org, i, blitz, r_blitz_direct), 0);

  -- S1 A21 same brand, other route
  i := gen_random_uuid(); insert into items (id, org_id, property_id, name) values (i, org, prop, 'S1');
  insert into shares (org_id, item_id, brand_id, route_id, channel) values (org, i, blitz, r_blitz_direct, 'Email');
  perform pg_temp.expect('A21 same brand via a DIFFERENT route is flagged', pg_temp.n(org, i, blitz, r_blitz_mer, 'same_brand_other_route'), 1);
  perform pg_temp.expect('A21 re-sending via the SAME route is NOT a conflict', pg_temp.n(org, i, blitz, r_blitz_direct), 0);
  perform pg_temp.expect('A21 unrecorded route vs a recorded prior route is flagged', pg_temp.n(org, i, blitz, null, 'same_brand_other_route'), 1);

  -- S2 A23 same brand group
  i := gen_random_uuid(); insert into items (id, org_id, property_id, name) values (i, org, prop, 'S2');
  insert into shares (org_id, item_id, brand_id, route_id, channel) values (org, i, blitz, r_blitz_direct, 'Email');
  perform pg_temp.expect('A23 another brand in the same group is flagged', pg_temp.n(org, i, spin, r_spin, 'same_brand_group'), 1);
  perform pg_temp.expect('A23 ...and nothing else fires for it', pg_temp.n(org, i, spin, r_spin), 1);

  -- S3 A22 agent's other brands
  i := gen_random_uuid(); insert into items (id, org_id, property_id, name) values (i, org, prop, 'S3');
  insert into shares (org_id, item_id, brand_id, route_id, channel) values (org, i, blitz, r_blitz_mer, 'WhatsApp');
  perform pg_temp.expect('A22 same agent, different brand is flagged', pg_temp.n(org, i, king, r_king_mer, 'agent_other_brand'), 1);
  perform pg_temp.expect('A22 no agent on the route -> not flagged', pg_temp.n(org, i, king, null, 'agent_other_brand'), 0);

  -- S4 A24 competing brand, same market
  i := gen_random_uuid(); insert into items (id, org_id, property_id, name) values (i, org, prop, 'S4');
  insert into shares (org_id, item_id, brand_id, route_id, channel) values (org, i, blitz, r_blitz_direct, 'Email');
  perform pg_temp.expect('A24 with NO competitor links configured, it never fires', pg_temp.n(org, i, rival, r_rival_uae, 'competing_brand_same_market'), 0);
  insert into competitor_links (org_id, a_type, a_id, b_type, b_id) values (org, 'brand', blitz, 'brand', rival);
  perform pg_temp.expect('A24 competing brand in the same market is flagged', pg_temp.n(org, i, rival, r_rival_uae, 'competing_brand_same_market'), 1);
  perform pg_temp.expect('A24 competing brand in a DIFFERENT market is not flagged', pg_temp.n(org, i, rival, r_rival_uk, 'competing_brand_same_market'), 0);
  perform pg_temp.expect('A24 market not recorded -> flagged (conservative)', pg_temp.n(org, i, rival, r_rival_null, 'competing_brand_same_market'), 1);
  i := gen_random_uuid(); insert into items (id, org_id, property_id, name) values (i, org, prop, 'S4b');
  insert into shares (org_id, item_id, brand_id, route_id, channel) values (org, i, rival, r_rival_uae, 'Email');
  perform pg_temp.expect('A24 link is symmetric (stored blitz->rival, checked from blitz)', pg_temp.n(org, i, blitz, r_blitz_direct, 'competing_brand_same_market'), 1);

  -- S5 A24 group-level competitor link
  i := gen_random_uuid(); insert into items (id, org_id, property_id, name) values (i, org, prop, 'S5');
  insert into competitor_links (org_id, a_type, a_id, b_type, b_id) values (org, 'brand_group', grp, 'brand', motion);
  insert into shares (org_id, item_id, brand_id, route_id, channel) values (org, i, spin, r_spin, 'Email');
  perform pg_temp.expect('A24 group<->brand link: brand in the group counts as competing', pg_temp.n(org, i, motion, r_motion, 'competing_brand_same_market'), 1);

  -- S6 isolation
  perform pg_temp.expect('org isolation: another org cannot see or trigger this org''s conflicts', pg_temp.n(org2, i, spin, r_spin), 0);

  -- S7/S8 constraints
  begin
    insert into competitor_links (org_id, a_type, a_id, b_type, b_id) values (org, 'brand', rival, 'brand', blitz);
    raise exception 'FAIL: reversed duplicate link was accepted';
  exception when unique_violation then raise notice 'PASS reversed duplicate competitor link rejected'; end;
  begin
    insert into competitor_links (org_id, a_type, a_id, b_type, b_id) values (org, 'brand', blitz, 'brand', blitz);
    raise exception 'FAIL: self-link was accepted';
  exception when check_violation then raise notice 'PASS self-link rejected'; end;
end $$;
