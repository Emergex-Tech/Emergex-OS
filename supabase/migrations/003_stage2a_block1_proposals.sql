-- ============================================================
-- Stage 2A — Block 1, remainder: A2, A3, A4, A6, A9, A12
-- Run AFTER 002_stage2a_role_split.sql.
--
-- D10 (PRD's own flagged decision, undecided in the doc): does Team see
-- sell prices/margins on a proposal, or cost only?
--
-- IMPROVISED DEFAULT — flagged, not silently assumed:
--   Team sees the brand-facing sell price on every line (they need it to
--   build and send proposals — PRD 4 explicitly lists "build proposals"
--   as a Team capability from Stage 2A). Team does NOT see the margin
--   stack breakdown (cost -> EmergeX margin -> agent cut -> net margin) —
--   that's split into its own table, following the exact pattern already
--   used for brand_tier and property_edge: no RLS policy at all for Team,
--   not a hidden column.
--
-- This is a judgment call, not a requirement from the PRD text — reverse
-- it with a one-line RLS policy addition (see the commented-out
-- alternative policy at the bottom of this file) if the real decision
-- goes the other way. Nothing about the schema itself depends on which
-- way this goes; only the RLS policy on proposal_line_pricing does.
-- ============================================================

-- ---------- A7 (agent cut methods) pulled forward: proposal_lines needs it ----------
alter table agents add column if not exists cut_method text default 'none'; -- 'onTop' | 'outOf' | 'fixedFee' | 'none'
alter table agents add column if not exists cut_pct numeric default 0;
alter table agents add column if not exists fixed_fee numeric default 0;

-- ---------- A3: flesh out the proposal record ----------
alter table proposals add column if not exists contact_id uuid references contacts(id);
alter table proposals add column if not exists brief text;
alter table proposals add column if not exists budget numeric;
alter table proposals add column if not exists currency text default 'USD';
alter table proposals add column if not exists markets text;
alter table proposals add column if not exists event_start date;
alter table proposals add column if not exists event_end date;
alter table proposals add column if not exists created_by uuid references profiles(id);
alter table proposals add column if not exists updated_at timestamptz default now();
alter table proposals alter column stage set default 'Draft';

-- New permission for the two new margin-related endpoints/views.
insert into permissions (key, description) values
  ('margin.view', 'View a proposal line''s margin stack breakdown (cost, EmergeX margin, agent cut, net margin)')
on conflict (key) do nothing;
insert into role_permissions (role_key, permission_key) values
  ('manager', 'margin.view'), ('ceo', 'margin.view'), ('management', 'margin.view')
on conflict do nothing;
-- Deliberately no row for 'team' — see the D10 note above.

-- ---------- A4/A6/A9: proposal lines, split by the D10 decision ----------

-- Visible to every internal role (Team included): what's on the proposal
-- and what the brand will be quoted. No cost, no margin, no agent cut here.
create table proposal_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  proposal_id uuid references proposals(id) on delete cascade,
  item_id uuid references items(id),
  quantity numeric default 1,
  sell_price numeric,          -- brand-facing price — the only price figure Team sees
  pricing_mechanic text,       -- 'fee' | 'commission' | 'markup' (A8, recorded now, not yet used in calc)
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table proposal_lines enable row level security;
create policy "org read proposal_lines" on proposal_lines for select using (org_id = current_org());

-- Management-only, same pattern as property_edge/brand_tier: Team has NO
-- policy on this table at all, so a query from Team returns zero rows,
-- not a hidden column a client could still request.
create table proposal_line_pricing (
  proposal_line_id uuid primary key references proposal_lines(id) on delete cascade,
  org_id uuid not null,
  cost_used numeric,
  cost_source_price_record_id uuid references price_records(id),
  margin_pct numeric,
  agent_cut_amount numeric,
  net_margin_emx numeric,
  net_margin_pct numeric,
  set_by uuid references profiles(id),
  updated_at timestamptz default now()
);
alter table proposal_line_pricing enable row level security;
create policy "management-tier read proposal_line_pricing" on proposal_line_pricing
  for select using (org_id = current_org() and has_permission('margin.view'));

-- ---------- A12: approval chain, one row per layer action ----------
create table proposal_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  proposal_line_id uuid references proposal_lines(id) on delete cascade,
  layer text not null,          -- 'team' | 'manager' | 'ceo'
  action text not null,         -- 'cost_recorded' | 'margin_set' | 'confirmed' | 'overridden'
  snapshot jsonb,               -- the relevant numbers at the time of this action
  actor_id uuid references profiles(id),
  created_at timestamptz default now()
);
alter table proposal_approvals enable row level security;
create policy "org read proposal_approvals" on proposal_approvals for select using (org_id = current_org());
-- No insert policy for anon/authenticated — written by the service layer only, same as audit_events.

-- ============================================================
-- REVERSING D10 (if the real decision turns out to be "Team sees everything"):
-- drop policy "management-tier read proposal_line_pricing" on proposal_line_pricing;
-- create policy "org read proposal_line_pricing" on proposal_line_pricing
--   for select using (org_id = current_org());
-- (and give 'team' the margin.view permission row too, for consistency)
-- ============================================================
