-- ============================================================
-- Stage 3, blocks 11–12: L1–L10, L28, L29. Run AFTER 012_stage2b_benchmarks_shortlists.sql.
--
-- NOT in this migration (later turns): metrics (L13–15), live reports and brand links (L16–21), closure and
-- case studies (L22–25), CEO view and notifications (L26–27), chat capture into the log (L30), and the tracker
-- import (L12 — it needs a sample of the real tracker sheet; its layout isn't in any document I have).
-- ============================================================

insert into permissions (key, description) values
  ('project.manage', 'Create/repair projects, link upsells, assign the EmergeX owner, edit parties, mark deliverables missed, make-goods and invoice adjustments (Manager/CEO)'),
  ('project.template.manage', 'Edit the checklist templates (Manager/CEO)')
on conflict (key) do nothing;
insert into role_permissions (role_key, permission_key) values
  ('manager', 'project.manage'), ('ceo', 'project.manage'), ('management', 'project.manage'),
  ('manager', 'project.template.manage'), ('ceo', 'project.template.manage'), ('management', 'project.template.manage')
on conflict do nothing;

-- ---------- checklist templates (data, so Management can change them without a release) ----------
-- Shared reference data like `categories`. A project gets its OWN COPY of the items when it is created, so editing a
-- template later never rewrites a live project. (Multi-agency, Stage 4, will need these per organisation.)
create table checklist_templates (
  key text primary key,
  name text not null,
  description text
);
create table checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_key text not null references checklist_templates(key),
  phase_no int not null check (phase_no between 1 and 9),
  phase_name text not null check (char_length(btrim(phase_name)) between 1 and 80),
  side text not null check (side in ('brand', 'team')),   -- brand-side and team-side trails are tracked separately
  title text not null check (char_length(btrim(title)) between 1 and 200),
  auto_rule text check (auto_rule is null or auto_rule in ('contract_exists', 'contract_file_uploaded', 'billing_schedule_created', 'first_invoice_issued', 'first_invoice_paid', 'all_invoices_paid')),
  position int not null default 0,
  active boolean not null default true
);
create index checklist_template_items_idx on checklist_template_items (template_key, phase_no, position);

insert into checklist_templates (key, name, description) values
  ('full', 'Full', 'DRAFT — follows the PRD phase names (6.18) but the items are a starting point, NOT the real EmergeX execution checklist. Replace them on the Templates page.'),
  ('short', 'Short', 'DRAFT — follows the PRD phase names (6.18) but the items are a starting point, NOT the real EmergeX execution checklist. Replace them on the Templates page.');
insert into checklist_template_items (template_key, phase_no, phase_name, side, title, auto_rule, position) values
  ('full', 1, 'Paperwork and commercial gate', 'brand', 'Contract created', 'contract_exists', 10),
  ('full', 1, 'Paperwork and commercial gate', 'brand', 'Signed contract filed', 'contract_file_uploaded', 20),
  ('full', 1, 'Paperwork and commercial gate', 'brand', 'Billing schedule set up', 'billing_schedule_created', 30),
  ('full', 1, 'Paperwork and commercial gate', 'brand', 'First invoice issued', 'first_invoice_issued', 40),
  ('full', 1, 'Paperwork and commercial gate', 'brand', 'First payment received', 'first_invoice_paid', 50),
  ('full', 1, 'Paperwork and commercial gate', 'brand', 'Brand purchase order or written approval received', null, 60),
  ('full', 1, 'Paperwork and commercial gate', 'team', 'Vendor or talent agreement signed', null, 70),
  ('full', 1, 'Paperwork and commercial gate', 'team', 'Vendor payment terms confirmed', null, 80),
  ('full', 1, 'Paperwork and commercial gate', 'team', 'Rights, usage and exclusivity confirmed with the vendor', null, 90),
  ('full', 2, 'Onboarding and asset delivery', 'brand', 'Brand assets and guidelines received', null, 10),
  ('full', 2, 'Onboarding and asset delivery', 'brand', 'Kick-off call held', null, 20),
  ('full', 2, 'Onboarding and asset delivery', 'brand', 'Brand approval contacts confirmed', null, 30),
  ('full', 2, 'Onboarding and asset delivery', 'team', 'Vendor or talent briefed', null, 40),
  ('full', 2, 'Onboarding and asset delivery', 'team', 'Creative and assets produced', null, 50),
  ('full', 2, 'Onboarding and asset delivery', 'brand', 'Assets approved by the brand', null, 60),
  ('full', 2, 'Onboarding and asset delivery', 'team', 'Assets delivered to the vendor or talent', null, 70),
  ('full', 3, 'Activation and live', 'brand', 'Go-live date confirmed with the brand', null, 10),
  ('full', 3, 'Activation and live', 'team', 'Go-live confirmed with the vendor or talent', null, 20),
  ('full', 3, 'Activation and live', 'team', 'Proof being collected against deliverables', null, 30),
  ('full', 3, 'Activation and live', 'brand', 'Mid-campaign check-in with the brand', null, 40),
  ('full', 4, 'Closure and renewal', 'team', 'Final proof compiled', null, 10),
  ('full', 4, 'Closure and renewal', 'brand', 'Final report sent to the brand', null, 20),
  ('full', 4, 'Closure and renewal', 'team', 'Make-goods settled', null, 30),
  ('full', 4, 'Closure and renewal', 'brand', 'All invoices paid', 'all_invoices_paid', 40),
  ('full', 4, 'Closure and renewal', 'brand', 'Renewal conversation opened', null, 50),
  ('short', 1, 'Confirm and brief', 'team', 'Booking confirmed with the vendor', null, 10),
  ('short', 1, 'Confirm and brief', 'team', 'Brief sent to the vendor', null, 20),
  ('short', 1, 'Confirm and brief', 'brand', 'Plan approved by the brand', null, 30),
  ('short', 1, 'Confirm and brief', 'brand', 'Contract created', 'contract_exists', 40),
  ('short', 1, 'Confirm and brief', 'brand', 'First invoice issued', 'first_invoice_issued', 50),
  ('short', 2, 'Live', 'team', 'Go-live date confirmed', null, 10),
  ('short', 2, 'Live', 'team', 'Live and running', null, 20),
  ('short', 2, 'Live', 'brand', 'Mid-way check-in with the brand', null, 30),
  ('short', 3, 'Proof and close', 'team', 'Proof collected', null, 10),
  ('short', 3, 'Proof and close', 'brand', 'Report sent to the brand', null, 20),
  ('short', 3, 'Proof and close', 'brand', 'All invoices paid', 'all_invoices_paid', 30);

-- ---------- projects (L1, L2): one per won deal; an upsell points at the ORIGINAL ----------
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  deal_id uuid not null unique references deals(id),            -- one project per deal, enforced here, not just in code
  parent_project_id uuid references projects(id),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  template_key text not null references checklist_templates(key),
  status text not null default 'active' check (status in ('active', 'closed')),   -- closing (final report, renewal) arrives with L22
  owner_id uuid references profiles(id),
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  closed_at timestamptz
);
create index projects_parent_idx on projects (parent_project_id);
create or replace function guard_project_parent() returns trigger language plpgsql as $$
begin
  if new.parent_project_id is null then return new; end if;
  if new.parent_project_id = new.id then raise exception 'A project cannot be its own upsell parent'; end if;
  if (select org_id from projects where id = new.parent_project_id) is distinct from new.org_id then raise exception 'The parent project must be in the same organisation'; end if;
  if (select parent_project_id from projects where id = new.parent_project_id) is not null then raise exception 'That project is itself an upsell — link to the original project instead'; end if;
  if exists (select 1 from projects where parent_project_id = new.id) then raise exception 'This project already has upsells of its own, so it cannot become an upsell'; end if;
  return new;
end $$;
create trigger trg_guard_project_parent before insert or update of parent_project_id on projects for each row execute function guard_project_parent();

-- ---------- checklist items (L5): a COPY of the template, plus custom items ----------
create table project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null references projects(id) on delete cascade,
  template_item_id uuid references checklist_template_items(id),   -- null = a custom item added to this project
  phase_no int not null,
  phase_name text not null,
  side text not null check (side in ('brand', 'team')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  auto_rule text check (auto_rule is null or auto_rule in ('contract_exists', 'contract_file_uploaded', 'billing_schedule_created', 'first_invoice_issued', 'first_invoice_paid', 'all_invoices_paid')),
  status text not null default 'open' check (status in ('open', 'done', 'na')),
  owner_id uuid references profiles(id),
  due_date date,
  notes text check (notes is null or char_length(notes) <= 2000),
  na_reason text check (na_reason is null or char_length(na_reason) <= 500),
  position int not null default 0,
  completed_at timestamptz,
  completed_by uuid references profiles(id),
  archived_at timestamptz,                                          -- "archive instead of delete" (Appendix B)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (status <> 'na' or char_length(btrim(coalesce(na_reason, ''))) > 0)   -- skipping a step needs a reason on record
);
create index project_checklist_items_idx on project_checklist_items (project_id) where archived_at is null;

-- ---------- parties (L28) ----------
create table project_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (role in ('brand', 'brand_route', 'emergex_owner', 'delivery_agent', 'vendor', 'talent', 'other')),
  side text not null check (side in ('brand', 'delivery', 'emergex')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  ref_type text check (ref_type is null or ref_type in ('brand', 'agent', 'vendor', 'profile')),
  ref_id uuid,
  contact text check (contact is null or char_length(contact) <= 300),
  notes text check (notes is null or char_length(notes) <= 1000),
  archived_at timestamptz,
  created_at timestamptz default now()
);
create unique index project_parties_ref_key on project_parties (project_id, role, ref_id) where ref_id is not null and archived_at is null;
create index project_parties_project_idx on project_parties (project_id) where archived_at is null;

-- ---------- communication log (L29): a record of what happened, so it cannot be rewritten or deleted ----------
create table project_communications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null references projects(id) on delete cascade,
  party_id uuid references project_parties(id),
  direction text not null check (direction in ('inbound', 'outbound')),
  channel text not null check (channel in ('whatsapp', 'telegram', 'email', 'call', 'meeting', 'other')),
  kind text not null check (kind in ('request', 'approval', 'update', 'proof', 'other')),
  occurred_at timestamptz not null default now(),
  summary text not null check (char_length(btrim(summary)) between 1 and 2000),
  related_type text check (related_type is null or related_type in ('deliverable', 'checklist_item', 'report')),
  related_id uuid,
  status text not null default 'done' check (status in ('open', 'done')),
  waiting_on text check (waiting_on is null or waiting_on in ('us', 'them')),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  check ((related_type is null) = (related_id is null)),
  -- only a REQUEST can be open, and an open request always says who is waiting on whom
  check ((status = 'open' and kind = 'request' and waiting_on is not null) or (status = 'done' and waiting_on is null))
);
create index project_communications_idx on project_communications (project_id, status, occurred_at desc);
create or replace function guard_comm_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'The communication log is a record and cannot be deleted'; end if;
  if old.status = 'open' and new.status = 'done'
     and (to_jsonb(new) - 'status' - 'waiting_on' - 'resolved_at' - 'resolved_by' - 'resolution_note')
       = (to_jsonb(old) - 'status' - 'waiting_on' - 'resolved_at' - 'resolved_by' - 'resolution_note')
     and new.resolved_at is not null then
    return new;   -- the ONE permitted change: an open request being resolved
  end if;
  raise exception 'A log entry cannot be edited. Only an open request can be resolved; record corrections as a new entry';
end $$;
create trigger trg_guard_comm_immutable before update or delete on project_communications for each row execute function guard_comm_immutable();

-- ---------- delivery tracking (L7–L10): the 2B deliverables gain quantities and the five statuses ----------
alter table deliverables add column planned_quantity numeric(14,2) not null default 1 check (planned_quantity > 0);
alter table deliverables add column delivered_quantity numeric(14,2) not null default 0 check (delivered_quantity >= 0);
alter table deliverables add column unit text check (unit is null or char_length(unit) <= 40);
alter table deliverables add column make_good_of uuid references deliverables(id);
alter table deliverables add column invoice_adjustment boolean not null default false;
alter table deliverables add column adjustment_note text check (adjustment_note is null or char_length(adjustment_note) <= 500);
-- Existing 2B rows: pending → planned; done → delivered in full.
update deliverables set status = 'planned' where status = 'pending';
update deliverables set status = 'delivered', delivered_quantity = planned_quantity where status = 'done';
alter table deliverables alter column status set default 'planned';
alter table deliverables add constraint deliverables_status_check check (status in ('planned', 'delivered', 'partial', 'missed', 'replaced'));
-- Status and quantity can never contradict each other, whatever the app does.
alter table deliverables add constraint deliverables_quantity_status check (
  (status = 'planned' and delivered_quantity = 0)
  or (status = 'partial' and delivered_quantity > 0 and delivered_quantity < planned_quantity)
  or (status = 'delivered' and delivered_quantity >= planned_quantity)
  or status in ('missed', 'replaced'));
alter table deliverables add constraint deliverables_adjustment_only_missed check (not invoice_adjustment or status = 'missed');
create or replace function guard_make_good() returns trigger language plpgsql as $$
declare orig deliverables%rowtype;
begin
  if new.make_good_of is null then return new; end if;
  if new.make_good_of = new.id then raise exception 'A deliverable cannot be its own make-good'; end if;
  select * into orig from deliverables where id = new.make_good_of;
  if orig.contract_id <> new.contract_id or orig.org_id <> new.org_id then raise exception 'A make-good must be on the same contract as the deliverable it replaces'; end if;
  if orig.make_good_of is not null then raise exception 'A make-good cannot itself be replaced'; end if;
  if orig.status not in ('missed', 'replaced') then raise exception 'Only a missed deliverable can have a make-good (this one is %)', orig.status; end if;
  return new;
end $$;
create trigger trg_guard_make_good before insert or update of make_good_of on deliverables for each row execute function guard_make_good();

-- ---------- access: staff only, like every business table (see 011) ----------
alter table checklist_templates enable row level security;
alter table checklist_template_items enable row level security;
alter table projects enable row level security;
alter table project_checklist_items enable row level security;
alter table project_parties enable row level security;
alter table project_communications enable row level security;
create policy "staff read templates" on checklist_templates for select using (is_internal());
create policy "staff read template items" on checklist_template_items for select using (is_internal());
create policy "org read projects" on projects for select using (org_id = current_org() and is_internal());
create policy "org read project checklist" on project_checklist_items for select using (org_id = current_org() and is_internal());
create policy "org read project parties" on project_parties for select using (org_id = current_org() and is_internal());
create policy "org read project communications" on project_communications for select using (org_id = current_org() and is_internal());
-- No insert/update/delete policies: the service layer is the only writer.
