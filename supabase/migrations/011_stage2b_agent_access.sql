-- ============================================================
-- Stage 2B — B3 (contract files), B12–B17 (agent access).
-- Run AFTER 010_stage2b_finance.sql.
--
-- READ THIS FIRST. Until now every signed-in user was internal staff, so the database only
-- asked "same organisation?". Adding an external 'agent' role to the same organisation would
-- have let an agent read prices, vendors and other agents' notes straight from the browser.
-- So this migration makes everything DENY-BY-DEFAULT for external roles:
--   1. roles.is_external marks which roles are outside the company;
--   2. EVERY existing SELECT policy is rewritten to also require is_internal();
--   3. agents then get data ONLY through a few server routes that return a hand-picked set of fields.
-- Per PRD 6.16 the agent portal is "released only after a security review" — the app enforces that
-- with AGENT_ACCESS_ENABLED (off by default), see src/lib/agentAccess.ts.
-- ============================================================

alter table roles add column if not exists is_external boolean not null default false;
insert into roles (key, label, is_external) values ('agent', 'Agent', true)
on conflict (key) do update set is_external = true;

insert into permissions (key, description) values
  ('agent.portal.use',   'Use the white-labelled agent portal (external agents only)'),
  ('agent.share.manage', 'Mark inventory shareable with an agent, revoke it, and read agent activity (Manager/CEO)'),
  ('agent.intel.review', 'Review market intel submitted by agents (Manager/CEO)')
on conflict (key) do nothing;
insert into role_permissions (role_key, permission_key) values
  ('agent', 'agent.portal.use'),
  ('manager', 'agent.share.manage'), ('ceo', 'agent.share.manage'), ('management', 'agent.share.manage'),
  ('manager', 'agent.intel.review'), ('ceo', 'agent.intel.review'), ('management', 'agent.intel.review')
on conflict do nothing;

-- An agent USER belongs to an agent COMPANY. Exactly the agent role has one, enforced by the database.
alter table profiles add column if not exists agent_id uuid references agents(id);
alter table profiles add constraint profiles_agent_link check ((role_key = 'agent') = (agent_id is not null));
create or replace function guard_profile_agent() returns trigger language plpgsql as $$
begin
  if new.agent_id is not null and (select org_id from agents where id = new.agent_id) is distinct from new.org_id then
    raise exception 'An agent user must belong to an agent in the same organisation';
  end if;
  return new;
end $$;
create trigger trg_guard_profile_agent before insert or update of agent_id, org_id on profiles for each row execute function guard_profile_agent();

-- Helper used by every policy. Harden the existing SECURITY DEFINER helpers while here: pin their search_path.
alter function current_org() set search_path = public, pg_temp;
alter function current_role_key() set search_path = public, pg_temp;
alter function has_permission(text) set search_path = public, pg_temp;
create or replace function is_internal() returns boolean language sql security definer stable set search_path = public, pg_temp as $$
  select coalesce((select not r.is_external from profiles p join roles r on r.key = p.role_key where p.id = auth.uid()), false)
$$;

-- Rewrite EVERY existing select policy to also require is_internal(). Done from the catalog rather
-- than policy-by-policy so none can be missed; supabase/tests/agent_access.sql asserts none ever lacks it.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname, qual from pg_policies where schemaname = 'public' and cmd = 'SELECT' loop
    if r.qual not like '%is_internal()%' then
      execute format('alter policy %I on %I.%I using ((%s) and is_internal())', r.policyname, r.schemaname, r.tablename, r.qual);
    end if;
  end loop;
end $$;

-- An external user can read exactly their own profile row (the app shell needs it) and nothing else.
create policy "read own profile" on profiles for select using (id = auth.uid());

-- organisations had no RLS at all: anyone holding the public anon key could list every tenant's name.
alter table organisations enable row level security;
create policy "read own organisation" on organisations for select using (id = current_org() and is_internal());

-- Contract files (B3) are contract.manage-only: the rows hold filenames and Drive ids for documents that can contain agent cuts.
drop policy "org read files" on files;
create policy "org read files" on files for select using (
  org_id = current_org() and is_internal() and (kind is distinct from 'contract_file' or has_permission('contract.manage'))
);

-- ---------- B13: explicit grants of an item to an agent ----------
create table shareable_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  agent_id uuid not null references agents(id),
  item_id uuid not null references items(id),
  display_title text,                        -- white-label name shown INSTEAD of the real property/item names
  indicative_price numeric(14,2) check (indicative_price is null or indicative_price >= 0),  -- typed by management; never derived from cost
  price_currency text default 'USD',
  granted_by uuid references profiles(id),
  granted_at timestamptz default now(),
  revoked_by uuid references profiles(id),
  revoked_at timestamptz
);
create unique index shareable_grants_active_key on shareable_grants (agent_id, item_id) where revoked_at is null;
create index shareable_grants_agent_idx on shareable_grants (agent_id) where revoked_at is null;
create or replace function guard_grant() returns trigger language plpgsql as $$
begin
  if (select org_id from agents where id = new.agent_id) is distinct from new.org_id
     or (select org_id from items where id = new.item_id) is distinct from new.org_id then
    raise exception 'The agent and the item must both belong to the grant''s organisation';
  end if;
  return new;
end $$;
create trigger trg_guard_grant before insert on shareable_grants for each row execute function guard_grant();

-- ---------- B17: every agent view is logged, and the log cannot be altered ----------
create table agent_activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  agent_id uuid not null references agents(id),
  user_id uuid references profiles(id),
  action text not null check (action in ('view_inventory', 'view_item', 'submit_intel', 'view_intel')),
  item_id uuid references items(id),
  created_at timestamptz not null default now()
);
create index agent_activity_idx on agent_activity (org_id, agent_id, created_at desc);
create or replace function agent_activity_append_only() returns trigger language plpgsql as $$
begin raise exception 'agent_activity is append-only'; end $$;
create trigger trg_agent_activity_immutable before update or delete on agent_activity for each row execute function agent_activity_append_only();

alter table shareable_grants enable row level security;
alter table agent_activity enable row level security;
create policy "manage read grants" on shareable_grants for select using (org_id = current_org() and is_internal() and has_permission('agent.share.manage'));
create policy "manage read activity" on agent_activity for select using (org_id = current_org() and is_internal() and has_permission('agent.share.manage'));

-- ---------- B16: agent-submitted intel lands UNRATED and pending ----------
alter table intel_notes add column if not exists review_status text not null default 'reviewed' check (review_status in ('pending', 'reviewed', 'rejected'));
alter table intel_notes add column if not exists reviewed_by uuid references profiles(id);
alter table intel_notes add column if not exists reviewed_at timestamptz;
alter table intel_notes add column if not exists claimed_price numeric(14,2);   -- a price the agent CLAIMS; becomes a market_intel record only if a reviewer accepts it
alter table intel_notes add column if not exists claimed_currency text;
create index intel_agent_pending_idx on intel_notes (submitted_by_agent_id, review_status);

-- ---------- B3: contract files, versioned, one marked current ----------
alter table files add column if not exists doc_title text;
alter table files add column if not exists version_note text;
alter table files add column if not exists size_bytes bigint;
alter table files add column if not exists mime_type text;
alter table files add column if not exists sha256 text;
create unique index files_contract_version_key on files (linked_id, doc_title, version) where linked_type = 'contract' and kind = 'contract_file';
create unique index files_contract_current_key on files (linked_id, doc_title) where linked_type = 'contract' and kind = 'contract_file' and is_current;
