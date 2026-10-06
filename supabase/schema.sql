-- ============================================================
-- EmergeX OS — Stage 1 schema (PRD v2.0)
-- Organisation-scoped from day one. Roles: team, management only —
-- Manager/CEO split, agent, and brand roles are added in later stages
-- by inserting new rows into `roles`/`role_permissions`, not by
-- changing this schema.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm; -- for duplicate-candidate similarity matching

-- ---------- organisations & permissions ----------
create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- Roles are data, not code: Stage 1 seeds 'team' and 'management' only.
-- Stage 2A adds 'manager'/'ceo', Stage 2B adds 'agent', Stage 4 adds 'brand' —
-- each a seed insert, never a schema or code change.
create table roles (
  key text primary key,
  label text not null
);
insert into roles (key, label) values ('team', 'Team'), ('management', 'Management');

create table permissions (
  key text primary key,
  description text
);
insert into permissions (key, description) values
  ('record.create', 'Create vendors/properties/items/routes/intel'),
  ('record.update', 'Update existing records'),
  ('price.record_cost', 'Record a cost-side price'),
  ('route.score', 'Set a route strength/reliability score (pending review)'),
  ('route.score.approve', 'Approve a pending route score change'),
  ('override.set', 'Set a re-confirmation override'),
  ('override.lengthen.approve', 'Approve a lengthening override'),
  ('brand.tier.view', 'View brand tier (Management-only field)'),
  ('brand.tier.set', 'Set brand tier'),
  ('property.edge.view', 'View property pricing edge (Management-only field)'),
  ('property.edge.set', 'Set property pricing edge'),
  ('duplicate.merge', 'Merge a duplicate candidate'),
  ('user.manage', 'Manage users and roles'),
  ('category.manage', 'Manage category schemas');

create table role_permissions (
  role_key text references roles(key),
  permission_key text references permissions(key),
  primary key (role_key, permission_key)
);
-- Team: create/update, record cost, score routes (pending), set overrides (pending for lengthening)
insert into role_permissions values
  ('team', 'record.create'), ('team', 'record.update'), ('team', 'price.record_cost'),
  ('team', 'route.score'), ('team', 'override.set');
-- Management: everything Team can do, plus the gated stuff
insert into role_permissions select 'management', key from permissions;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organisations(id),
  full_name text,
  role_key text not null references roles(key) default 'team',
  created_at timestamptz default now()
);

create or replace function current_org() returns uuid as $$
  select org_id from profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function current_role_key() returns text as $$
  select role_key from profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function has_permission(perm text) returns boolean as $$
  select exists (
    select 1 from role_permissions rp
    join profiles p on p.role_key = rp.role_key
    where p.id = auth.uid() and rp.permission_key = perm
  );
$$ language sql security definer stable;

-- ---------- audit (universal, append-only) ----------
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_id uuid references profiles(id),
  action text not null,             -- 'create' | 'update' | 'confirm' | 'override' | 'score_change' | 'share' | 'merge' | ...
  entity_type text not null,
  entity_id uuid not null,
  before jsonb,
  after jsonb,
  created_at timestamptz default now()
);
alter table audit_events enable row level security;
create policy "read own org audit" on audit_events for select using (org_id = current_org());
-- No insert policy for anon/authenticated: audit rows are written ONLY by the
-- service layer using the service-role key, which bypasses RLS by design.

-- ---------- universal versioning (every record type funnels through this) ----------
create table record_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  version_number int not null,
  diff_summary text,
  snapshot jsonb not null,
  changed_by uuid references profiles(id),
  created_at timestamptz default now()
);
alter table record_versions enable row level security;
create policy "read own org versions" on record_versions for select using (org_id = current_org());

create table duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_type text not null,
  entity_id_a uuid not null,
  entity_id_b uuid not null,
  similarity_score numeric,
  status text default 'pending', -- 'pending' | 'merged' | 'dismissed'
  reviewed_by uuid references profiles(id),
  created_at timestamptz default now()
);
alter table duplicate_candidates enable row level security;
create policy "internal read duplicates" on duplicate_candidates for select using (org_id = current_org());

-- ---------- categories (schema itself, not org-scoped — shared reference data) ----------
create table categories (
  key text primary key,
  label text not null,
  group_label text,
  reconfirmation_rule text not null,   -- 'sponsorship' | '60day' | '90day'
  property_label text,
  item_label text,
  property_fields jsonb not null default '[]',
  item_fields jsonb not null default '[]',
  price_unit_options jsonb not null default '[]'
);
-- Populated by scripts/load-categories.ts from categories.json at setup time.

-- ---------- vendors ----------
create table vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  type text,                    -- free text
  markets text,
  status text default 'Recurring', -- 'Recurring' | 'Opportunistic'
  owner_id uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  vendor_id uuid references vendors(id) on delete cascade,
  name text, role text, email text, phone text
);

-- ---------- properties & items (the two-level inventory model) ----------
create table properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  category_key text not null references categories(key),
  vendor_id uuid references vendors(id),
  name text not null,
  market text,
  event_start date,
  event_end date,
  attributes jsonb not null default '{}',   -- category-specific property_fields
  delivery_side_agent_id uuid,               -- set when this property comes via an intermediary
  is_stale boolean default false,
  next_reconfirmation_at date,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Management-only field, split into its own table so it's not just hidden
-- in the UI — Team has no policy on this table at all.
create table property_edge (
  property_id uuid primary key references properties(id) on delete cascade,
  org_id uuid not null,
  is_edge boolean default false,
  edge_reason text,
  set_by uuid references profiles(id),
  updated_at timestamptz default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid references properties(id) on delete cascade,
  name text not null,
  attributes jsonb not null default '{}',   -- category-specific item_fields
  availability text default 'available',    -- available|on_hold|proposed|sold|expired
  offer_expiry date,
  is_stale boolean default false,
  next_reconfirmation_at date,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- confirmations & overrides ----------
create table confirmations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_type text not null,  -- 'property' | 'item' | 'route'
  entity_id uuid not null,
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz default now()
);

create table reconfirmation_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  period_days int not null,
  reason text not null,
  direction text not null,       -- 'shorten' | 'lengthen'
  status text default 'active',  -- 'pending' | 'active' | 'rejected' | 'ended'
  set_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  ends_on date,
  ends_on_availability_change boolean default true,
  created_at timestamptz default now()
);

-- ---------- brands, groups, agents, routes ----------
create table brand_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null
);
create table brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  brand_group_id uuid references brand_groups(id),
  name text not null,
  markets text,
  status text,
  created_at timestamptz default now()
);
-- Management-only field, same pattern as property_edge.
create table brand_tier (
  brand_id uuid primary key references brands(id) on delete cascade,
  org_id uuid not null,
  tier text default 'standard', -- 'preferred' | 'standard' | 'non_preferred'
  margin_band_low numeric,
  margin_band_high numeric,
  set_by uuid references profiles(id),
  updated_at timestamptz default now()
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  markets text
);
create table contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  agent_id uuid references agents(id),
  name text, email text, phone text
);

create table routes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  brand_id uuid references brands(id) on delete cascade,
  route_type text not null,      -- 'direct' | 'via_agent' | 'via_sub_agent' | 'via_partner'
  agent_id uuid references agents(id),
  contact_id uuid references contacts(id),
  contact_type text,             -- 'decision_maker' | 'marketing_lead' | 'appointed_agent' | 'freelance_agent' | 'affiliate_manager' | 'consultant' | 'other'
  market text,
  description text,
  strength int check (strength between 1 and 5),
  reliability int check (reliability between 1 and 5),
  status text default 'active', -- 'active' | 'ended'
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Score changes by Team are pending until Management reviews — agents (Stage 2B)
-- never see their own scores, enforced by never giving agents a policy on this table.
create table route_score_changes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  route_id uuid references routes(id) on delete cascade,
  field text not null,           -- 'strength' | 'reliability'
  old_value int,
  new_value int,
  status text default 'pending', -- 'pending' | 'approved' | 'rejected'
  changed_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ---------- price records (cost-side; sell-side/proposal fields reserved for 2A) ----------
create table price_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  item_id uuid references items(id) on delete cascade,
  type text not null,           -- 'rack' | 'quote' | 'negotiated' | 'transacted' | 'market_intel'
  amount numeric,
  currency text default 'USD',
  unit text,
  price_date date default current_date,
  validity_days int,
  days_to_event int,
  source text,
  brand_id uuid references brands(id),
  route_id uuid references routes(id),
  reusable boolean default false,     -- for negotiated rates that survive a lost deal
  -- Reserved for Stage 2A — nullable, unused until proposals exist:
  proposal_id uuid,
  outcome text,
  recorded_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ---------- intel ----------
create table intel_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  linked_type text,    -- 'brand' | 'brand_group' | 'agent' | 'vendor' | 'property' | 'item' | 'market'
  linked_id uuid,
  source text,         -- 'ceo' | 'team' | 'agent' | 'vendor' | 'partner' | 'public'
  submitted_by_agent_id uuid references agents(id), -- set only if an agent submitted it (Stage 2B); never shown to other agents
  reliability text default 'likely', -- 'confirmed' | 'likely' | 'rumour'
  note_type text,
  confidentiality text default 'internal',
  note text not null,
  submitted_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ---------- shares (simple log in Stage 1; conflict checks arrive in 2A) ----------
create table shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  item_id uuid references items(id),
  brand_id uuid references brands(id),
  route_id uuid references routes(id),
  channel text,
  occurred_at timestamptz default now(),
  logged_by uuid references profiles(id),
  logged_after_the_fact boolean default false,
  -- Reserved for Stage 2A:
  proposal_version_id uuid,
  created_at timestamptz default now()
);

-- ---------- capture ----------
create table captures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  raw_input text,
  attachment_file_ids uuid[],
  ai_output jsonb,
  status text default 'pending_review', -- 'pending_review' | 'confirmed' | 'discarded'
  created_record_refs jsonb,  -- [{entity_type, entity_id}] once confirmed
  ai_model text,
  submitted_by uuid references profiles(id),
  reviewed_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ---------- files (Drive metadata only) ----------
create table files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  linked_type text,
  linked_id uuid,
  drive_file_id text,
  drive_folder_id text,
  name text,
  version int default 1,
  is_current boolean default true,
  uploaded_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ============================================================
-- RESERVED EMPTY TABLES for Stage 2A/2B/3, per the PRD's sequencing rule:
-- "Stage 1 creates empty proposal and deal tables ... so later stages
-- attach without migrating data." Created now, unused until then.
-- ============================================================
create table proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  brand_id uuid references brands(id),
  route_id uuid references routes(id),
  stage text,
  created_at timestamptz default now()
);
create table proposal_versions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references proposals(id) on delete cascade,
  version_number int,
  created_at timestamptz default now()
);
create table deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  proposal_id uuid references proposals(id),
  parent_deal_id uuid references deals(id), -- upsells, Stage 3
  created_at timestamptz default now()
);

alter table price_records add constraint fk_price_proposal foreign key (proposal_id) references proposals(id);
alter table shares add constraint fk_share_proposal_version foreign key (proposal_version_id) references proposal_versions(id);
