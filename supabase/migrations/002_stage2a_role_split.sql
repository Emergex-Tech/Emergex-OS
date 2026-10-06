-- ============================================================
-- Stage 2A — A1: split Management into Manager and CEO
-- Run this AFTER schema.sql / policies.sql / functions.sql are already live.
--
-- PRD 4 (Users and roles by stage): "Manager splits in two. Manager sets
-- margins and sell prices and approves sending. CEO: Final pricing
-- authority, overrides, CEO view."
--
-- Reading: Manager inherits everything Management could do, plus the new
-- selling permissions. CEO inherits everything Manager can do, plus final
-- override authority and the CEO view. Team is untouched.
--
-- This is deliberately additive: the old 'management' role and its
-- profiles are left in place so nothing breaks mid-transition. The last
-- section of this file is a commented-out cleanup step — run it only
-- once every profile with role_key = 'management' has been manually
-- reassigned to 'manager' or 'ceo' (a per-person decision this migration
-- cannot make for you).
-- ============================================================

insert into roles (key, label) values
  ('manager', 'Manager'),
  ('ceo', 'CEO')
on conflict (key) do nothing;

-- New Stage 2A permissions. Rows only — nothing here builds the actual
-- proposal/margin features yet (that's A2/A6/A9/A12), but the permission
-- split is settled now so those features don't have to guess at it later.
insert into permissions (key, description) values
  ('margin.set', 'Set a proposal line''s margin away from the brand tier default'),
  ('sell_price.set', 'Set a proposal line''s brand-facing sell price directly'),
  ('proposal.approve_send', 'Approve a proposal for sending to the brand'),
  ('pricing.override', 'CEO override of a Manager-set price or a warning'),
  ('ceo_view.access', 'View the CEO view dashboard (PRD 6.14)')
on conflict (key) do nothing;

-- Manager = everything 'management' already had, plus the three new selling permissions.
insert into role_permissions (role_key, permission_key)
select 'manager', permission_key from role_permissions where role_key = 'management'
on conflict do nothing;
insert into role_permissions (role_key, permission_key) values
  ('manager', 'margin.set'),
  ('manager', 'sell_price.set'),
  ('manager', 'proposal.approve_send')
on conflict do nothing;

-- CEO = everything Manager has, plus final override authority and the CEO view.
insert into role_permissions (role_key, permission_key)
select 'ceo', permission_key from role_permissions where role_key = 'manager'
on conflict do nothing;
insert into role_permissions (role_key, permission_key) values
  ('ceo', 'pricing.override'),
  ('ceo', 'ceo_view.access')
on conflict do nothing;

-- Back-fill the three new permissions onto the legacy 'management' role too,
-- so nobody loses capability while profiles are being reassigned one at a time.
insert into role_permissions (role_key, permission_key) values
  ('management', 'margin.set'),
  ('management', 'sell_price.set'),
  ('management', 'proposal.approve_send'),
  ('management', 'pricing.override'),
  ('management', 'ceo_view.access')
on conflict do nothing;

-- The intel_notes RLS policy hardcoded 'management' as the internal-visibility
-- role. Recreate it so Manager and CEO see everything Team and (legacy)
-- Management already could.
drop policy if exists "org read intel, agents see only their own" on intel_notes;
create policy "org read intel, agents see only their own" on intel_notes
  for select using (
    org_id = current_org()
    and (
      submitted_by_agent_id is null
      or current_role_key() in ('management', 'manager', 'ceo', 'team')
      -- Stage 2B adds: or submitted_by_agent_id = (select agent_id from profiles where id = auth.uid())
    )
  );

-- ============================================================
-- CLEANUP — run this yourself, per person, once ready:
--
-- update profiles set role_key = 'manager' where id = '<uuid of whoever runs day-to-day pricing>';
-- update profiles set role_key = 'ceo'     where id = '<uuid of whoever has final authority>';
--
-- Only after EVERY profile with role_key = 'management' has been reassigned,
-- optionally retire the legacy role:
--
-- delete from role_permissions where role_key = 'management';
-- delete from roles where key = 'management';
--
-- (This will fail loudly via the roles/profiles foreign key if any profile
-- still references 'management' — that's intentional, not a bug.)
-- ============================================================
