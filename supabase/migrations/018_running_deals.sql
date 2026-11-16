-- ============================================================
-- Entering a deal that is ALREADY RUNNING (signed before the system existed). Run AFTER 017_delivery_log.sql.
-- Such a deal never went Draft -> Sent -> Won here, so it is created directly as Won and MARKED, so that it is never
-- counted in win-rate or won/lost statistics (it would flatter them: it was never "pitched" in this system).
-- ============================================================
alter table proposals add column origin text not null default 'pipeline' check (origin in ('pipeline', 'running_deal'));
