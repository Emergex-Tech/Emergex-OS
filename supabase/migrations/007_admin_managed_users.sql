-- ============================================================
-- Admin-managed accounts, replacing Google OAuth as the only sign-in path.
--
-- PRD 6.1 specifies Google Workspace sign-in; this is a deliberate deviation
-- requested directly — Management/CEO create every account instead of anyone
-- with a Google account self-signing-in. Nothing about the permission model
-- changes: user.manage already exists (schema.sql) and is already held by
-- Manager and CEO via migration 002's additive design.
-- ============================================================

alter table profiles add column if not exists email text;
alter table profiles add column if not exists disabled boolean not null default false;
create unique index if not exists profiles_org_email_key on profiles (org_id, lower(email));
