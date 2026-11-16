-- ============================================================
-- Tracker foundation: what three real trackers (a celebrity ambassador, a team sponsorship, an ad network) need that the system
-- could not hold. Run AFTER 016_stage3_reports.sql.
--   1. a dated DELIVERY LOG per deliverable (each post / match / day), from which the delivered quantity is DERIVED
--   2. social post links as proof, and proof attached to one log entry (a post's Instagram + Facebook + TikTok links)
--   3. a WAIVED status ("not wanted by the brand") — neither delivered nor missed
--   4. a period label ("Year 1", "per match") and 5. the VENDOR's guarantee alongside the brand's (internal only)
--   6. a segment on metric readings (region / ad type)
-- ============================================================

-- ---------- 3, 4, 5: deliverables ----------
alter table deliverables drop constraint deliverables_status_check;
alter table deliverables add constraint deliverables_status_check check (status in ('planned', 'delivered', 'partial', 'missed', 'replaced', 'waived'));
alter table deliverables drop constraint deliverables_quantity_status;
alter table deliverables add constraint deliverables_quantity_status check (
  (status = 'planned' and delivered_quantity = 0)
  or (status = 'partial' and delivered_quantity > 0 and delivered_quantity < planned_quantity)
  or (status = 'delivered' and delivered_quantity >= planned_quantity)
  or status in ('missed', 'replaced', 'waived'));
alter table deliverables add column waived_reason text check (waived_reason is null or char_length(btrim(waived_reason)) between 1 and 500);
alter table deliverables add constraint deliverables_waived_has_reason check ((status = 'waived') = (waived_reason is not null));   -- waiving always says why
alter table deliverables add column period_label text check (period_label is null or char_length(btrim(period_label)) between 1 and 40);
-- What the VENDOR guaranteed us, when it differs from what we guaranteed the brand (planned_quantity). INTERNAL: never in a brand report.
alter table deliverables add column vendor_quantity numeric(14,2) check (vendor_quantity is null or vendor_quantity > 0);

-- ---------- 1: the delivery log ----------
create table deliverable_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  deliverable_id uuid not null references deliverables(id),
  occurred_on date not null,
  quantity numeric(14,2) not null default 1 check (quantity > 0),
  label text check (label is null or char_length(btrim(label)) between 1 and 200),        -- "vs Jaffna Kings, 17 Jul", "Diwali reel"
  note text check (note is null or char_length(note) <= 500),
  source text not null default 'manual' check (source in ('manual', 'tracker_import')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 500),
  check ((voided_at is null) = (void_reason is null))
);
create index deliverable_events_idx on deliverable_events (deliverable_id, occurred_on) where voided_at is null;

-- An entry is a record: it can be VOIDED (once, with a person and a reason) and nothing else about it can change.
create or replace function guard_event_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Delivery-log entries cannot be deleted; void the entry with a reason instead'; end if;
  if old.voided_at is null and new.voided_at is not null and new.voided_by is not null and new.void_reason is not null
     and (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason') = (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then return new; end if;
  raise exception 'A delivery-log entry cannot be edited. Void it with a reason and add a new one';
end $$;
create trigger trg_guard_event_immutable before update or delete on deliverable_events for each row execute function guard_event_immutable();

create or replace function guard_event_insert() returns trigger language plpgsql as $$
declare d deliverables%rowtype;
begin
  select * into d from deliverables where id = new.deliverable_id;
  if d.org_id is distinct from new.org_id then raise exception 'The log entry and its deliverable must belong to the same organisation'; end if;
  if d.status = 'replaced' then raise exception 'This deliverable has been replaced by a make-good; log the delivery against the make-good instead'; end if;
  if d.status = 'waived' then raise exception 'This deliverable was waived by the brand; reinstate it before logging a delivery'; end if;
  return new;
end $$;
create trigger trg_guard_event_insert before insert on deliverable_events for each row execute function guard_event_insert();

-- THE RULE: once a deliverable has a log, its delivered quantity IS the sum of the log, and its status follows — kept true by the
-- database on every insert and void, so no route or importer can leave the number and the log disagreeing.
create or replace function sync_delivered_from_log() returns trigger language plpgsql as $$
declare d deliverables%rowtype; total numeric; st text;
begin
  select * into d from deliverables where id = new.deliverable_id for update;
  if d.status in ('replaced', 'waived') then return null; end if;
  select coalesce(sum(quantity), 0) into total from deliverable_events where deliverable_id = d.id and voided_at is null;
  st := case when total >= d.planned_quantity then 'delivered' when total > 0 then 'partial' when d.status = 'missed' then 'missed' else 'planned' end;
  update deliverables set delivered_quantity = total, status = st,
         invoice_adjustment = case when st = 'missed' then invoice_adjustment else false end,
         adjustment_note = case when st = 'missed' then adjustment_note else null end, updated_at = now()
   where id = d.id;
  return null;
end $$;
create trigger trg_sync_delivered_from_log after insert or update on deliverable_events for each row execute function sync_delivered_from_log();

-- …and the number cannot be typed over while a log exists.
create or replace function guard_delivered_matches_log() returns trigger language plpgsql as $$
declare total numeric; n int;
begin
  select count(*), coalesce(sum(quantity), 0) into n, total from deliverable_events where deliverable_id = new.id and voided_at is null;
  if n > 0 and new.delivered_quantity <> total then
    raise exception 'This deliverable is tracked by its delivery log (% logged). Add or void a log entry instead of typing the number', total;
  end if;
  return new;
end $$;
create trigger trg_guard_delivered_matches_log before update of delivered_quantity on deliverables for each row execute function guard_delivered_matches_log();

-- ---------- 2: proof ----------
alter table deliverable_proofs add column event_id uuid references deliverable_events(id);
alter table deliverable_proofs add column platform text check (platform is null or platform in ('drive', 'instagram', 'facebook', 'x', 'tiktok', 'youtube'));
create or replace function guard_proof_event() returns trigger language plpgsql as $$
begin
  if new.event_id is not null and (select deliverable_id from deliverable_events where id = new.event_id) is distinct from new.deliverable_id then
    raise exception 'A proof can only be attached to a log entry of its own deliverable';
  end if;
  return new;
end $$;
create trigger trg_guard_proof_event before insert or update of event_id on deliverable_proofs for each row execute function guard_proof_event();

-- ---------- 6: metric segment ----------
alter table project_metrics add column segment text check (segment is null or char_length(btrim(segment)) between 1 and 60);

-- ---------- the closed-project lock now covers the delivery log too ----------
create or replace function guard_project_locked() returns trigger language plpgsql as $$
declare is_closed boolean := false;
begin
  if tg_table_name in ('project_checklist_items', 'project_parties', 'project_metrics') then
    select status = 'closed' into is_closed from projects where id = new.project_id;
  elsif tg_table_name = 'deliverables' then
    is_closed := project_is_closed_for_contract(new.contract_id);
  elsif tg_table_name in ('deliverable_proofs', 'deliverable_events') then
    select project_is_closed_for_contract(d.contract_id) into is_closed from deliverables d where d.id = new.deliverable_id;
  end if;
  if coalesce(is_closed, false) then
    raise exception 'This project is closed, so its delivery record is locked. Reopen the project to change it.';
  end if;
  return new;
end $$;
create trigger trg_lock_events before insert or update on deliverable_events for each row execute function guard_project_locked();

alter table deliverable_events enable row level security;
create policy "org read deliverable events" on deliverable_events for select using (org_id = current_org() and is_internal());
-- No insert/update/delete policies: the service layer is the only writer.
