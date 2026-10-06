\set ON_ERROR_STOP on
-- fixtures (as superuser, bypasses RLS)
insert into organisations (id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','OrgA'),('bbbbbbbb-0000-0000-0000-000000000002','OrgB');
insert into auth.users (id) values ('11111111-0000-0000-0000-000000000001'),('22222222-0000-0000-0000-000000000002'),('33333333-0000-0000-0000-000000000003'),('44444444-0000-0000-0000-000000000004');
insert into profiles (id,org_id,full_name,role_key) values
 ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','team user','team'),
 ('22222222-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','manager user','manager'),
 ('33333333-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','ceo user','ceo'),
 ('44444444-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000002','other org manager','manager');
insert into categories (key,label,group_label,reconfirmation_rule) values ('ooh_led','OOH','Media','60day');
insert into brands (id,org_id,name) values ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Blitz');
insert into brand_tier (brand_id,org_id,tier,margin_band_low,margin_band_high) values ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','preferred',18,24);
insert into properties (id,org_id,category_key,name) values ('d0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','ooh_led','LED network');
insert into property_edge (property_id,org_id,is_edge,edge_reason) values ('d0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',true,'exclusive');
insert into items (id,org_id,property_id,name) values ('e0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Slot');
insert into proposals (id,org_id,brand_id) values ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');
insert into proposal_lines (id,org_id,proposal_id,item_id,sell_price) values ('a1000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',59270);
insert into proposal_line_pricing (proposal_line_id,org_id,cost_used,margin_pct) values ('a1000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',42000,26);

create temp table results (who text, brand_tier int, property_edge int, pricing int, lines int, may_view_margin bool, may_override bool);
grant all on results to authenticated;
do $$
declare u record; r results%rowtype;
begin
  for u in select * from (values ('team','11111111-0000-0000-0000-000000000001'),('manager','22222222-0000-0000-0000-000000000002'),
                                  ('ceo','33333333-0000-0000-0000-000000000003'),('other-org manager','44444444-0000-0000-0000-000000000004')) v(n,id) loop
    perform set_config('request.jwt.claim.sub', u.id, true);
    set local role authenticated;
    insert into results select u.n, (select count(*) from brand_tier), (select count(*) from property_edge),
      (select count(*) from proposal_line_pricing), (select count(*) from proposal_lines),
      has_permission('margin.view'), has_permission('pricing.override');
    reset role;
  end loop;
end $$;
select * from results;

\echo '--- actor columns the service layer writes vs what really exists ---'
select t.table_name,
  bool_or(c.column_name='created_by') as has_created_by,
  bool_or(c.column_name='recorded_by') as has_recorded_by,
  bool_or(c.column_name='logged_by') as has_logged_by,
  bool_or(c.column_name='submitted_by') as has_submitted_by
from (values ('vendors'),('brands'),('agents'),('properties'),('items'),('routes'),('proposals'),('price_records'),('intel_notes'),('shares')) t(table_name)
join information_schema.columns c on c.table_name=t.table_name and c.table_schema='public'
group by t.table_name order by 1;
\set ON_ERROR_STOP on
set role service_role;   -- what the service layer uses: bypasses RLS, but NOT column names or constraints
-- createRecord() shapes, one per table, with the actor column the ACTOR_COLUMN map now picks
insert into vendors (name,type,markets,status,owner_id,org_id) values ('V','t','UAE','Recurring','11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001');
insert into brands (name,brand_group_id,markets,status,org_id) values ('B',null,'UAE',null,'aaaaaaaa-0000-0000-0000-000000000001');
insert into agents (name,markets,org_id) values ('A','UAE','aaaaaaaa-0000-0000-0000-000000000001');
insert into properties (category_key,vendor_id,name,market,event_start,event_end,attributes,delivery_side_agent_id,org_id,created_by) values ('ooh_led',null,'P2','UAE',null,null,'{}',null,'aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
insert into items (property_id,name,attributes,availability,offer_expiry,org_id,created_by) values ('d0000000-0000-0000-0000-000000000001','I2','{}','available',null,'aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
insert into routes (brand_id,route_type,agent_id,contact_id,contact_type,market,description,strength,reliability,status,org_id,created_by) values ('c0000000-0000-0000-0000-000000000001','direct',null,null,null,'UAE',null,3,3,'active','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
insert into proposals (brand_id,route_id,contact_id,brief,budget,currency,markets,event_start,event_end,stage,org_id,created_by) values ('c0000000-0000-0000-0000-000000000001',null,null,'b',1000,'USD','UAE',null,null,'Draft','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
insert into price_records (item_id,type,amount,currency,unit,source,org_id,recorded_by) values ('e0000000-0000-0000-0000-000000000001','rack',42000,'USD','per_match','s','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
insert into intel_notes (linked_type,linked_id,source,reliability,note_type,confidentiality,note,org_id,submitted_by) values (null,null,'team','likely',null,'internal','n','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
insert into shares (item_id,brand_id,route_id,channel,occurred_at,logged_after_the_fact,org_id,logged_by) values ('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',null,'Email',now(),false,'aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
-- audit + versioning shapes
insert into audit_events (org_id,actor_id,action,entity_type,entity_id,before,after) values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','create','vendor','a1000000-0000-0000-0000-000000000001',null,'{"x":1}');
insert into record_versions (org_id,entity_type,entity_id,version_number,snapshot,changed_by,diff_summary) values ('aaaaaaaa-0000-0000-0000-000000000001','vendor','a1000000-0000-0000-0000-000000000001',1,'{}','11111111-0000-0000-0000-000000000001','Initial creation');

-- Block 3 shapes: version, negotiated price (A16), export share (A20), filed export (A19)
insert into proposal_versions (org_id,proposal_id,version_number,snapshot,change_summary,note,created_by) values ('aaaaaaaa-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',1,'{"currency":"USD","total":59270,"lines":[]}','Initial version','Export','22222222-0000-0000-0000-000000000002');
insert into price_records (item_id,type,amount,currency,unit,validity_days,source,brand_id,route_id,proposal_id,proposal_line_id,reusable,org_id,recorded_by) values ('e0000000-0000-0000-0000-000000000001','negotiated',38000,'USD','per_match',30,'Negotiated on proposal','c0000000-0000-0000-0000-000000000001',null,'f0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',false,'aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000002');
insert into shares (org_id,item_id,brand_id,route_id,channel,proposal_version_id,logged_by,logged_after_the_fact) select 'aaaaaaaa-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',null,'Proposal export',id,'22222222-0000-0000-0000-000000000002',false from proposal_versions limit 1;
update files set is_current=false where org_id='aaaaaaaa-0000-0000-0000-000000000001' and linked_type='proposal' and kind='proposal_export';
insert into files (org_id,linked_type,linked_id,kind,drive_file_id,drive_folder_id,name,version,is_current,uploaded_by,proposal_version_id) select 'aaaaaaaa-0000-0000-0000-000000000001','proposal','f0000000-0000-0000-0000-000000000001','proposal_export','fileid','folderid','x.xlsx',1,true,'22222222-0000-0000-0000-000000000002',id from proposal_versions limit 1;
insert into proposal_approvals (org_id,proposal_line_id,layer,action,snapshot,actor_id) values ('aaaaaaaa-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','manager','cost_updated','{}','22222222-0000-0000-0000-000000000002');
reset role;
\echo 'PASS: every insert shape the code uses is accepted by the real schema'

-- version numbers must be unique per proposal (guards against two exports racing)
do $$ begin
  insert into proposal_versions (org_id,proposal_id,version_number) values ('aaaaaaaa-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',1);
  raise exception 'FAIL: duplicate version number was accepted';
exception when unique_violation then raise notice 'PASS: duplicate (proposal, version_number) rejected'; end $$;

-- proposal_versions security: readable in-org by Team (brand-facing snapshot), invisible cross-org, not writable by signed-in users
create temp table vres (who text, can_read int, can_insert text);
grant all on vres to authenticated;
do $$ declare u record; ins text;
begin
  for u in select * from (values ('team','11111111-0000-0000-0000-000000000001'),('other-org','44444444-0000-0000-0000-000000000004')) v(n,id) loop
    perform set_config('request.jwt.claim.sub', u.id, true);
    set local role authenticated;
    begin
      insert into proposal_versions (org_id,proposal_id,version_number) values ('aaaaaaaa-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001',99);
      ins := 'ALLOWED (bad)';
    exception when others then ins := 'denied';
    end;
    insert into vres select u.n, (select count(*) from proposal_versions), ins;
    reset role;
  end loop;
end $$;
select * from vres;
