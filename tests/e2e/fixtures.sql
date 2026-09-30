-- One org, three signed-in users. (auth.users is a stand-in table in the test harness.)
insert into organisations (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'E2E Org');
insert into auth.users (id) values
  ('11111111-0000-0000-0000-000000000001'), ('22222222-0000-0000-0000-000000000002'),
  ('33333333-0000-0000-0000-000000000003'), ('55555555-0000-0000-0000-000000000005');
insert into profiles (id, org_id, full_name, email, role_key) values
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'team user', 'team@e2e.test', 'team'),
  ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'manager user', 'manager@e2e.test', 'manager'),
  ('33333333-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'ceo user', 'ceo@e2e.test', 'ceo'),
  -- Spare CEO, used only by the "only a CEO can demote a CEO" test — keeping it separate from the
  -- real CEO fixture means that test can't accidentally change a role other tests depend on.
  ('55555555-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'spare ceo', 'spareceo@e2e.test', 'ceo');
