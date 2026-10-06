-- ============================================================
-- Stage 2B — finance: B6 (billing schedule), B7 (receivables), B8 (payables),
-- B9 (payments), B10 (overdue + chasing). Export (B11) is code only.
-- Run AFTER 009_stage2b_contracts.sql.
--
-- Access: ALL finance data is gated by one permission, finance.manage (Manager/CEO).
-- Team sees none of it — not hidden in the UI, but no RLS policy for them at all, same
-- pattern as brand_tier and proposal_line_pricing. Payables also expose vendor cost and
-- agent cuts, which is exactly the margin-side data Team is already kept away from (D10).
-- ============================================================

insert into permissions (key, description) values
  ('finance.manage', 'View and manage invoices, payments, payables and finance exports (Manager/CEO)')
on conflict (key) do nothing;
insert into role_permissions (role_key, permission_key) values
  ('manager', 'finance.manage'), ('ceo', 'finance.manage'), ('management', 'finance.manage')
on conflict do nothing;

-- One table for both directions: a receivable is money owed TO EmergeX (brand or agent),
-- a payable is money EmergeX owes (vendor or agent).
create table invoices (
  id uuid primary key default gen_random_uuid(),
  seq_no bigint generated always as identity,   -- display number is derived from this, so it can't collide
  org_id uuid not null,
  contract_id uuid not null references contracts(id),
  direction text not null check (direction in ('receivable', 'payable')),
  counterparty_type text not null check (counterparty_type in ('brand', 'agent', 'vendor')),
  counterparty_id uuid,
  counterparty_name text not null,              -- denormalised: the counterparty can be a brand, agent or vendor
  description text,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'USD',
  issue_date date,
  due_date date,
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check ((direction = 'receivable' and counterparty_type in ('brand', 'agent'))
      or (direction = 'payable'    and counterparty_type in ('vendor', 'agent')))
);
-- "Paid / part paid / overdue" are DERIVED from payments and the due date, never stored,
-- so they cannot drift out of sync with what was actually recorded.

create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null references invoices(id),
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text,
  reference text,
  recorded_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table invoice_chases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null references invoices(id) on delete cascade,
  note text,
  chased_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- The database itself refuses an overpayment or a payment on a non-issued invoice, so a bug
-- or a race in the app can't corrupt the books. The row lock serialises two payments arriving
-- at once for the same invoice (otherwise both could pass the check and together overpay).
create or replace function guard_payment() returns trigger language plpgsql as $$
declare inv invoices%rowtype; already numeric;
begin
  select * into inv from invoices where id = new.invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if inv.org_id <> new.org_id then raise exception 'Payment organisation does not match the invoice'; end if;
  if inv.status <> 'issued' then
    raise exception 'Payments can only be recorded against an issued invoice (this one is %)', inv.status;
  end if;
  select coalesce(sum(amount), 0) into already from payments where invoice_id = new.invoice_id;
  if already + new.amount > inv.amount then
    raise exception 'Payment of % would exceed the invoice balance of %', new.amount, inv.amount - already;
  end if;
  return new;
end $$;
create trigger trg_guard_payment before insert on payments for each row execute function guard_payment();

-- An invoice that already has money recorded against it can't be voided.
create or replace function guard_invoice_void() returns trigger language plpgsql as $$
begin
  if new.status = 'void' and old.status <> 'void'
     and exists (select 1 from payments where invoice_id = old.id) then
    raise exception 'This invoice has payments recorded against it and cannot be voided';
  end if;
  return new;
end $$;
create trigger trg_guard_invoice_void before update on invoices for each row execute function guard_invoice_void();

alter table invoices enable row level security;
alter table payments enable row level security;
alter table invoice_chases enable row level security;
create policy "finance read invoices" on invoices for select using (org_id = current_org() and has_permission('finance.manage'));
create policy "finance read payments" on payments for select using (org_id = current_org() and has_permission('finance.manage'));
create policy "finance read chases" on invoice_chases for select using (org_id = current_org() and has_permission('finance.manage'));
-- No insert/update policy for anon/authenticated: the service layer is the only writer.

create index invoices_org_dir_status_idx on invoices (org_id, direction, status);
create index invoices_contract_idx on invoices (contract_id);
create index payments_invoice_idx on payments (invoice_id);
