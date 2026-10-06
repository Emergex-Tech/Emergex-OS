-- ============================================================
-- Stage 2A — Block 2: A7, A8, A10, A11, A13, A14, A29
-- Run AFTER 003_stage2a_block1_proposals.sql.
-- ============================================================

-- ---------- A7: agent cut methods PER ROUTE, not just per agent ----------
-- PRD: "Agent cut methods per route on the proposal" — the same agent can
-- have a different arrangement on a different deal chain. These are
-- nullable: null means "use this route's agent's own default config"
-- (already on the agents table from Block 1). A route only needs its own
-- row here when this specific deal's arrangement differs from the agent's
-- usual one.
alter table routes add column if not exists cut_method text; -- null | 'onTop' | 'outOf' | 'fixedFee' | 'none'
alter table routes add column if not exists cut_pct numeric;
alter table routes add column if not exists fixed_fee numeric;

-- ---------- A14: proposal stage history (append-only) ----------
create table proposal_stage_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  proposal_id uuid references proposals(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  reason text, -- required in practice for 'Lost', optional otherwise — enforced in the API, not the DB
  changed_by uuid references profiles(id),
  created_at timestamptz default now()
);
alter table proposal_stage_history enable row level security;
create policy "org read proposal_stage_history" on proposal_stage_history for select using (org_id = current_org());
-- No insert policy for anon/authenticated — service layer only, same as audit_events.
