\set ON_ERROR_STOP on
-- Finance guarantees, tested against a real database. Self-contained (makes its own org).
do $$
declare
  org uuid := gen_random_uuid(); u_team uuid := gen_random_uuid(); u_mgr uuid := gen_random_uuid();
  deal uuid := gen_random_uuid(); ctr uuid := gen_random_uuid();
  inv uuid := gen_random_uuid(); draft uuid := gen_random_uuid(); n int; msg text;
begin
  insert into organisations (id, name) values (org, 'FinanceOrg');
  insert into auth.users (id) values (u_team), (u_mgr);
  insert into profiles (id, org_id, full_name, role_key) values (u_team, org, 'team', 'team'), (u_mgr, org, 'mgr', 'manager');
  insert into deals (id, org_id) values (deal, org);
  insert into contracts (id, org_id, deal_id, final_amount, renewal_date) values (ctr, org, deal, 100, '2027-01-01');
  insert into invoices (id, org_id, contract_id, direction, counterparty_type, counterparty_name, amount, status, due_date)
    values (inv, org, ctr, 'receivable', 'brand', 'Blitz', 100.00, 'issued', '2020-01-01'),
           (draft, org, ctr, 'receivable', 'brand', 'Blitz', 50.00, 'draft', '2020-01-01');

  -- the trigger refuses a payment on a draft
  begin insert into payments (org_id, invoice_id, amount) values (org, draft, 10); raise exception 'FAIL: payment on a draft was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    if sqlerrm not like '%issued invoice%' then raise exception 'FAIL: wrong error: %', sqlerrm; end if;
    raise notice 'PASS payment on a draft invoice is refused by the database'; end;

  insert into payments (org_id, invoice_id, amount) values (org, inv, 60);
  raise notice 'PASS a partial payment is accepted';

  -- the trigger refuses an overpayment (60 already + 50 > 100)
  begin insert into payments (org_id, invoice_id, amount) values (org, inv, 50); raise exception 'FAIL: overpayment accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    if sqlerrm not like '%would exceed the invoice balance of 40%' then raise exception 'FAIL: wrong error: %', sqlerrm; end if;
    raise notice 'PASS overpayment is refused and the message names the real balance (40)'; end;

  -- exactly the remaining balance is fine
  insert into payments (org_id, invoice_id, amount) values (org, inv, 40);
  select count(*) into n from payments where invoice_id = inv;
  if n <> 2 then raise exception 'FAIL: expected 2 payments, found %', n; end if;
  raise notice 'PASS paying exactly the remaining balance is accepted (2 payments, no more)';

  -- zero / negative amounts and cross-org payments are refused
  begin insert into payments (org_id, invoice_id, amount) values (org, inv, 0); raise exception 'FAIL: zero payment accepted';
  exception when check_violation then raise notice 'PASS zero payment refused'; end;
  begin insert into payments (org_id, invoice_id, amount) values (gen_random_uuid(), inv, 1); raise exception 'FAIL: cross-org payment accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if; raise notice 'PASS a payment whose org does not match the invoice is refused'; end;

  -- an invoice with payments cannot be voided; one without can
  begin update invoices set status = 'void' where id = inv; raise exception 'FAIL: void with payments accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    if sqlerrm not like '%cannot be voided%' then raise exception 'FAIL: wrong error: %', sqlerrm; end if;
    raise notice 'PASS an invoice with payments cannot be voided'; end;
  update invoices set status = 'void' where id = draft;
  raise notice 'PASS an invoice with no payments can be voided';

  -- amount must be positive, and a receivable cannot have a vendor counterparty
  begin insert into invoices (org_id, contract_id, direction, counterparty_type, counterparty_name, amount) values (org, ctr, 'receivable', 'brand', 'x', 0);
    raise exception 'FAIL: zero-amount invoice accepted'; exception when check_violation then raise notice 'PASS zero-amount invoice refused'; end;
  begin insert into invoices (org_id, contract_id, direction, counterparty_type, counterparty_name, amount) values (org, ctr, 'receivable', 'vendor', 'x', 5);
    raise exception 'FAIL: receivable from a vendor accepted'; exception when check_violation then raise notice 'PASS a receivable from a vendor is refused'; end;

  -- display numbers come from the identity column, so two invoices can never share one
  select count(distinct seq_no) into n from invoices where org_id = org;
  if n <> (select count(*) from invoices where org_id = org) then raise exception 'FAIL: seq_no collision'; end if;
  raise notice 'PASS invoice sequence numbers are unique';

  -- RLS as real signed-in users: Manager sees finance rows, Team sees none (zero rows, not a hidden column)
  create temp table fres (who text, inv_n int, pay_n int, can_write text);
  grant all on fres to authenticated;
  perform set_config('request.jwt.claim.sub', u_team::text, true); set local role authenticated;
  begin insert into invoices (org_id, contract_id, direction, counterparty_type, counterparty_name, amount) values (org, ctr, 'receivable', 'brand', 'x', 5); msg := 'ALLOWED (bad)';
  exception when others then msg := 'denied'; end;
  insert into fres select 'team', (select count(*) from invoices), (select count(*) from payments), msg; reset role;
  perform set_config('request.jwt.claim.sub', u_mgr::text, true); set local role authenticated;
  begin insert into invoices (org_id, contract_id, direction, counterparty_type, counterparty_name, amount) values (org, ctr, 'receivable', 'brand', 'x', 5); msg := 'ALLOWED (bad)';
  exception when others then msg := 'denied'; end;
  insert into fres select 'manager', (select count(*) from invoices), (select count(*) from payments), msg; reset role;

  if (select inv_n from fres where who = 'team') <> 0 or (select pay_n from fres where who = 'team') <> 0 then raise exception 'FAIL: Team can read finance rows'; end if;
  if (select inv_n from fres where who = 'manager') < 1 or (select pay_n from fres where who = 'manager') <> 2 then raise exception 'FAIL: Manager cannot read finance rows'; end if;
  if exists (select 1 from fres where can_write <> 'denied') then raise exception 'FAIL: a signed-in user could write finance rows directly'; end if;
  raise notice 'PASS RLS: Team reads 0 invoices/payments, Manager reads them, and neither can write directly (service layer only)';
end $$;
