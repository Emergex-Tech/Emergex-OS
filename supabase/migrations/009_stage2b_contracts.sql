-- ============================================================
-- Stage 2B — foundation: B1 (contracts), B2 (deliverables), B4 (renewal dates)
-- Run AFTER 008_stage2a_block5.sql.
--
-- Scope note: this is deliberately NOT all of Stage 2B. Billing/invoicing/
-- payments (B6, B7, B9, B10), payables and accounting export (B8, B11),
-- agent logins (B12-B17), and price benchmarks/matching (B18-B22) are not
-- built — they're real, separate chunks of work, not oversights. This
-- migration lays the one piece everything else in 2B attaches to: a
-- contract record per won deal, with its deliverables.
-- ============================================================

create table contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  deal_id uuid not null references deals(id) on delete cascade,
  terms text,
  final_amount numeric,           -- brand-facing total at close — same visibility as pipeline's `value` (D10: not margin)
  currency text default 'USD',
  renewal_date date,
  status text not null default 'active', -- 'active' | 'expired' | 'renewed'
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (deal_id) -- one contract per deal
);

create table deliverables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  contract_id uuid not null references contracts(id) on delete cascade,
  description text not null,
  due_date date,
  owner_id uuid references profiles(id),
  status text not null default 'pending', -- 'pending' | 'done'
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

insert into permissions (key, description) values
  ('contract.manage', 'Create contracts and add/edit deliverables (Manager/CEO)')
on conflict (key) do nothing;
insert into role_permissions (role_key, permission_key) values
  ('manager', 'contract.manage'), ('ceo', 'contract.manage'), ('management', 'contract.manage')
on conflict do nothing;
-- Deliverable STATUS updates (marking done) deliberately use record.update, which Team already
-- holds — ticking off a delivered item is operational work, not a contract-terms change.

alter table contracts enable row level security;
alter table deliverables enable row level security;
create policy "org read contracts" on contracts for select using (org_id = current_org());
create policy "org read deliverables" on deliverables for select using (org_id = current_org());
-- No insert/update policy for anon/authenticated on either — service layer only, same pattern as audit_events.

create index deliverables_contract_idx on deliverables (contract_id);
create index contracts_renewal_idx on contracts (renewal_date) where status = 'active';
