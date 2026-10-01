-- ============================================================
-- Stage 2A — Block 5: A26, A27, A28, A30, A31, A32, A33
-- Run AFTER 007_admin_managed_users.sql.
-- ============================================================

-- A30: a proposal line can only have ONE transacted price record. Without this, calling the
-- Won transition twice (a double-click, a retry after a timeout) would insert a duplicate
-- "transacted" row instead of being a no-op — the ON CONFLICT upsert in the stage route needs
-- this exact constraint to target.
create unique index if not exists price_records_line_transacted_key
  on price_records (proposal_line_id, type) where type = 'transacted';

-- Supports the won/lost analysis (A28) and pipeline (A27) queries, which both filter/group by stage.
create index if not exists proposal_stage_history_proposal_idx on proposal_stage_history (proposal_id, created_at);
