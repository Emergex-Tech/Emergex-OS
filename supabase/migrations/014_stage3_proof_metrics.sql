-- ============================================================
-- Stage 3, continued: L11 (proof per deliverable), L13–L14 (metric sets and dated entries). Run AFTER 013.
-- The project parts of the CEO view and notifications (L26–L27) are code only.
--
-- Not built: L15 (AI reads metrics from screenshots — the PRD's own cut-list allows manual entry instead),
-- and reports, snapshots and the brand link (L16–L21).
-- ============================================================

-- ---------- metric sets per category (D15 is OPEN in the PRD: these are a DRAFT, editable by Manager/CEO) ----------
-- Deliberately no foreign key to `categories`: that table is filled by seed_categories.sql, which runs AFTER the migrations.
create table metric_definitions (
  category_key text not null,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  unit text check (unit is null or char_length(unit) <= 20),
  aggregation text not null default 'sum' check (aggregation in ('sum', 'avg')),   -- counts add up across deliverables; rates are averaged
  position int not null default 0,
  active boolean not null default true,
  primary key (category_key, key)
);
insert into metric_definitions (category_key, key, label, unit, aggregation, position) values
  ('influencer_creator', 'views', 'Views', null, 'sum', 10), ('influencer_creator', 'reach', 'Reach', null, 'sum', 20), ('influencer_creator', 'likes', 'Likes', null, 'sum', 30),
  ('influencer_creator', 'comments', 'Comments', null, 'sum', 40), ('influencer_creator', 'shares', 'Shares', null, 'sum', 50), ('influencer_creator', 'saves', 'Saves', null, 'sum', 60),
  ('influencer_creator', 'engagement_rate', 'Engagement rate', '%', 'avg', 70),
  ('ooh_led', 'sites_live', 'Sites live', null, 'sum', 10), ('ooh_led', 'days_live', 'Days live', 'days', 'sum', 20), ('ooh_led', 'est_impressions', 'Estimated impressions', null, 'sum', 30),
  ('digital_publisher_app', 'impressions', 'Impressions', null, 'sum', 10), ('digital_publisher_app', 'clicks', 'Clicks', null, 'sum', 20), ('digital_publisher_app', 'ctr', 'Click-through rate', '%', 'avg', 30),
  ('transit_vehicle', 'vehicles_live', 'Vehicles live', null, 'sum', 10), ('transit_vehicle', 'days_live', 'Days live', 'days', 'sum', 20), ('transit_vehicle', 'est_impressions', 'Estimated impressions', null, 'sum', 30),
  ('player_athlete', 'posts', 'Posts', null, 'sum', 10), ('player_athlete', 'impressions', 'Impressions', null, 'sum', 20), ('player_athlete', 'engagement_rate', 'Engagement rate', '%', 'avg', 30), ('player_athlete', 'appearances', 'Appearances', null, 'sum', 40),
  ('celebrity_talent', 'posts', 'Posts', null, 'sum', 10), ('celebrity_talent', 'impressions', 'Impressions', null, 'sum', 20), ('celebrity_talent', 'engagement_rate', 'Engagement rate', '%', 'avg', 30), ('celebrity_talent', 'appearances', 'Appearances', null, 'sum', 40),
  ('content_production', 'pieces_delivered', 'Pieces delivered', null, 'sum', 10), ('content_production', 'views', 'Views', null, 'sum', 20), ('content_production', 'engagement_rate', 'Engagement rate', '%', 'avg', 30);
-- Sponsorship-type categories share one set (PRD 6.20: matches, exposure, broadcast reach, team posts).
insert into metric_definitions (category_key, key, label, unit, aggregation, position)
select c, k, l, null, 'sum', p from unnest(array['league_tournament', 'team', 'broadcast_streaming', 'ip_shows', 'events_activations']) c,
  (values ('matches', 'Matches', 10), ('exposure', 'Exposure', 20), ('broadcast_reach', 'Broadcast reach', 30), ('team_posts', 'Team posts', 40)) v(k, l, p);

-- ---------- metric entries (L14): dated, per deliverable (or project-wide), with a source ----------
-- Each entry is the CUMULATIVE TOTAL AS OF its date, not an increment; the summary uses the latest per deliverable and metric.
create table project_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null references projects(id) on delete cascade,
  deliverable_id uuid references deliverables(id),            -- null = a project-wide figure
  category_key text not null,
  metric_key text not null,
  value numeric(18,4) not null check (value >= 0),
  recorded_on date not null,
  source text not null check (char_length(btrim(source)) between 1 and 200),
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  recorded_by uuid references profiles(id),
  created_at timestamptz default now(),
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 500),
  foreign key (category_key, metric_key) references metric_definitions (category_key, key),   -- only a defined metric can be recorded
  check ((voided_at is null) = (void_reason is null))
);
create index project_metrics_idx on project_metrics (project_id, metric_key, recorded_on desc) where voided_at is null;
create or replace function guard_metric_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Metric entries are a record and cannot be deleted; void an entry with a reason instead'; end if;
  if old.voided_at is null and new.voided_at is not null and new.voided_by is not null and new.void_reason is not null
     and (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason') = (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    return new;   -- the ONE permitted change: voiding an entry, with a reason, once
  end if;
  raise exception 'A metric entry cannot be edited. Void it with a reason and record a new one';
end $$;
create trigger trg_guard_metric_immutable before update or delete on project_metrics for each row execute function guard_metric_immutable();

-- ---------- proof per deliverable (L11): an uploaded file in the project's Drive folder, or a link to an existing Drive file ----------
create table deliverable_proofs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  deliverable_id uuid not null references deliverables(id),
  kind text not null check (kind in ('upload', 'link')),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  drive_file_id text,
  drive_folder_id text,
  url text check (url is null or char_length(url) <= 600),
  mime_type text,
  size_bytes bigint,
  sha256 text,
  note text check (note is null or char_length(note) <= 500),
  added_by uuid references profiles(id),
  created_at timestamptz default now(),
  archived_at timestamptz,                                    -- archive, never delete
  archived_by uuid references profiles(id),
  check ((kind = 'upload' and drive_file_id is not null) or (kind = 'link' and url is not null))
);
create unique index deliverable_proofs_sha_key on deliverable_proofs (deliverable_id, sha256) where sha256 is not null and archived_at is null;
create unique index deliverable_proofs_link_key on deliverable_proofs (deliverable_id, url) where kind = 'link' and archived_at is null;
create index deliverable_proofs_idx on deliverable_proofs (deliverable_id) where archived_at is null;
create or replace function guard_proof_org() returns trigger language plpgsql as $$
begin
  if (select org_id from deliverables where id = new.deliverable_id) is distinct from new.org_id then raise exception 'The proof and its deliverable must belong to the same organisation'; end if;
  return new;
end $$;
create trigger trg_guard_proof_org before insert on deliverable_proofs for each row execute function guard_proof_org();

alter table metric_definitions enable row level security;
alter table project_metrics enable row level security;
alter table deliverable_proofs enable row level security;
create policy "staff read metric definitions" on metric_definitions for select using (is_internal());
create policy "org read project metrics" on project_metrics for select using (org_id = current_org() and is_internal());
create policy "org read deliverable proofs" on deliverable_proofs for select using (org_id = current_org() and is_internal());
-- No insert/update/delete policies: the service layer is the only writer.
