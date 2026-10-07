-- ============================================================
-- Stage 3, closure and case studies: L22–L25 and L30. Run AFTER 014_stage3_proof_metrics.sql.
--
-- Not built: the "final report locked" half of L22 — live reports (L16) don't exist yet, so closing locks the project's
-- DELIVERY RECORD (what the report would be built from) instead; the report lock becomes one more step on the same action later.
-- The case-study draft (L23) is generated from the records by fixed rules, not by AI (the PRD's cut-list allows a template).
-- ============================================================

-- ---------- closure (L22): who closed it, why, and exactly what was still open at that moment ----------
alter table projects add column closed_by uuid references profiles(id);
alter table projects add column closure_note text check (closure_note is null or char_length(closure_note) <= 1000);
alter table projects add column closure_warnings jsonb not null default '[]' check (jsonb_typeof(closure_warnings) = 'array');
alter table projects add constraint projects_closed_consistent check ((status = 'closed') = (closed_at is not null));
alter table projects add constraint projects_closed_by_set check (status <> 'closed' or closed_by is not null);

-- A renewal proposal is linked to the project it renews. One per project, so closing twice can never make two.
alter table proposals add column renewal_of_project_id uuid references projects(id);
create unique index proposals_one_renewal_per_project on proposals (renewal_of_project_id) where renewal_of_project_id is not null;

-- ---------- THE LOCK: a closed project's delivery record cannot be changed — by anyone, through any route ----------
-- Enforced here (not route by route) so a route added later cannot forget it. The communication log is deliberately NOT locked.
create or replace function project_is_closed_for_contract(p_contract uuid) returns boolean language sql stable as $$
  select exists (select 1 from contracts c join projects p on p.deal_id = c.deal_id where c.id = p_contract and p.status = 'closed')
$$;
create or replace function guard_project_locked() returns trigger language plpgsql as $$
declare is_closed boolean := false;
begin
  if tg_table_name in ('project_checklist_items', 'project_parties', 'project_metrics') then
    select status = 'closed' into is_closed from projects where id = new.project_id;
  elsif tg_table_name = 'deliverables' then
    is_closed := project_is_closed_for_contract(new.contract_id);
  elsif tg_table_name = 'deliverable_proofs' then
    select project_is_closed_for_contract(d.contract_id) into is_closed from deliverables d where d.id = new.deliverable_id;
  end if;
  if coalesce(is_closed, false) then
    raise exception 'This project is closed, so its delivery record is locked. Reopen the project to change it.';
  end if;
  return new;
end $$;
create trigger trg_lock_checklist before insert or update on project_checklist_items for each row execute function guard_project_locked();
create trigger trg_lock_parties before insert or update on project_parties for each row execute function guard_project_locked();
create trigger trg_lock_metrics before insert or update on project_metrics for each row execute function guard_project_locked();
create trigger trg_lock_deliverables before insert or update on deliverables for each row execute function guard_project_locked();
create trigger trg_lock_proofs before insert or update on deliverable_proofs for each row execute function guard_project_locked();

-- ---------- chat import (L30): remember which log entries were imported, so the origin is never in doubt ----------
alter table project_communications add column source text not null default 'manual' check (source in ('manual', 'chat_import'));

-- ---------- case studies (L23, L24) ----------
create table case_studies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null unique references projects(id),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  results jsonb not null default '[]' check (jsonb_typeof(results) = 'array'),     -- headline figures, copied from the metrics at drafting time
  delivery_pct numeric(5,1),
  brand_id uuid references brands(id),
  brand_name text not null,
  category_keys text[] not null default '{}',                                       -- the tags: derived from the project, not typed
  markets text[] not null default '{}',
  property_names text[] not null default '{}',
  hidden_names text[] not null default '{}',                                        -- every name the anonymised version must NOT contain
  anonymised_title text,
  anonymised_body text,
  named_use_approved boolean not null default false,                                -- D16: the brand has agreed to being named. Default: anonymised only.
  drafted_by uuid references profiles(id),
  drafted_at timestamptz default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz default now(),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  check (status <> 'approved' or (approved_at is not null and approved_by is not null and anonymised_title is not null and anonymised_body is not null)),
  check (not named_use_approved or status = 'approved')
);
create index case_studies_org_idx on case_studies (org_id, status);

-- The database refuses to approve an anonymised version that still names the brand or a partner — whatever the app does.
create or replace function guard_case_study_anonymised() returns trigger language plpgsql as $$
declare n text; hay text;
begin
  if new.status = 'approved' then
    hay := lower(coalesce(new.anonymised_title, '') || E'\n' || coalesce(new.anonymised_body, ''));
    foreach n in array new.hidden_names loop
      if char_length(btrim(n)) >= 3 and position(lower(btrim(n)) in hay) > 0 then
        raise exception 'The anonymised version still contains "%", so it cannot be approved', btrim(n);
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger trg_guard_case_study_anonymised before insert or update on case_studies for each row execute function guard_case_study_anonymised();

alter table case_studies enable row level security;
create policy "org read case studies" on case_studies for select using (org_id = current_org() and is_internal());
-- No insert/update/delete policies: the service layer is the only writer.
