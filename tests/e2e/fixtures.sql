-- One org, three signed-in users. (auth.users is a stand-in table in the test harness.)
insert into organisations (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'E2E Org');
insert into auth.users (id) values ('11111111-0000-0000-0000-000000000001'), ('22222222-0000-0000-0000-000000000002'), ('33333333-0000-0000-0000-000000000003');
insert into profiles (id, org_id, full_name, role_key) values
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'team user', 'team'),
  ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'manager user', 'manager'),
  ('33333333-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'ceo user', 'ceo');
