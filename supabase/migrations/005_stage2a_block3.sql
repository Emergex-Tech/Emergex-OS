-- ============================================================
-- Stage 2A — Block 3: A15, A16, A18, A19, A20
-- Run AFTER 004_stage2a_block2.sql.
-- ============================================================

-- ---------- A15: proposal versions with a change record ----------
-- proposal_versions was created empty in Stage 1 (id, proposal_id, version_number).
-- The snapshot stores BRAND-FACING data only (item, quantity, sell price) —
-- never cost or margin — so this table can be readable by every internal role
-- without reopening the D10 decision (Team must not see margin).
alter table proposal_versions add column if not exists org_id uuid;
alter table proposal_versions add column if not exists snapshot jsonb;
alter table proposal_versions add column if not exists change_summary text;
alter table proposal_versions add column if not exists note text;
alter table proposal_versions add column if not exists created_by uuid references profiles(id);
create unique index if not exists proposal_versions_proposal_number_key on proposal_versions (proposal_id, version_number);
-- RLS was already enabled on this table in policies.sql, with no policy (deny all).
create policy "org read proposal_versions" on proposal_versions for select using (org_id = current_org());
-- No insert policy for anon/authenticated: written by the service layer only.

-- ---------- A16: negotiated prices saved back as price records ----------
-- Lets a price record point at the exact proposal line it came from, so a later
-- win (A30) or loss (A31) can resolve its outcome without guessing.
alter table price_records add column if not exists proposal_line_id uuid references proposal_lines(id) on delete set null;

-- ---------- A18/A19: exported files, chained per proposal with one marked current ----------
alter table files add column if not exists kind text;                -- e.g. 'proposal_export'
alter table files add column if not exists proposal_version_id uuid references proposal_versions(id);
