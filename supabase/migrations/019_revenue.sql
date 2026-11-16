-- ============================================================
-- Revenue management (PRD 6.23): booked / invoiced / collected, margin by dimension, a weighted-pipeline forecast and variance
-- against plan. Run AFTER 018_running_deals.sql. The figures themselves are CALCULATED from what is already recorded (contracts,
-- invoices, payments, proposal lines); this migration only adds the two things a person must supply — the plan and the stage weights —
-- plus the date a contract was actually signed.
-- ============================================================

insert into permissions (key, description) values
  ('revenue.view', 'See the revenue view: booked, invoiced and collected revenue, margins by dimension, forecast and variance'),
  ('revenue.plan', 'Set the revenue plan and the pipeline stage weights used for the forecast')
on conflict (key) do nothing;
insert into role_permissions (role_key, permission_key) values
  ('ceo', 'revenue.view'), ('manager', 'revenue.view'), ('management', 'revenue.view'),
  ('ceo', 'revenue.plan')
on conflict do nothing;

-- When the deal was actually signed. A deal entered as "already running" was signed long before its row was created, and booking
-- it in the month it was typed in would put years of revenue in the wrong period. Null = the day the contract was created here.
alter table contracts add column booked_on date;

-- The plan: one target per month and currency. Currencies are never added together.
create table revenue_plan (
  org_id uuid not null,
  period date not null check (extract(day from period) = 1),                 -- always the first day of a month
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  booked_target numeric(14,2) not null check (booked_target >= 0),
  collected_target numeric(14,2) check (collected_target is null or collected_target >= 0),
  note text check (note is null or char_length(note) <= 300),
  set_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, period, currency)
);

-- How likely a proposal at each stage is to be won, for the forecast. Absent rows fall back to the defaults in code.
create table pipeline_stage_weights (
  org_id uuid not null,
  stage text not null check (stage in ('Draft', 'Review', 'Approved', 'Sent', 'Negotiating')),   -- the OPEN stages; Won and Lost are outcomes, not forecasts
  weight_pct numeric(5,2) not null check (weight_pct >= 0 and weight_pct <= 100),
  set_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, stage)
);

alter table revenue_plan enable row level security;
alter table pipeline_stage_weights enable row level security;
-- Margin and plan are management information: readable only with revenue.view, never by Team, never by an external agent.
create policy "revenue plan readable with revenue.view" on revenue_plan for select using (org_id = current_org() and is_internal() and has_permission('revenue.view'));
create policy "stage weights readable with revenue.view" on pipeline_stage_weights for select using (org_id = current_org() and is_internal() and has_permission('revenue.view'));
-- No insert/update/delete policies: the service layer is the only writer.
