-- ============================================================
-- Stage 3, live reports: L16–L21. Run AFTER 015_stage3_closure_casestudies.sql.
--
-- THIS IS THE FIRST EXTERNAL SURFACE: a brand opens a report with a link and NO login. So:
--   * the link token is never stored (only its SHA-256 hash), links expire, can be revoked, and every view is logged append-only;
--   * what a report may contain is decided by an allow-list in code (reportBuilder.ts), not by hiding columns;
--   * proof files are HIDDEN from reports until someone ticks them (report_visible defaults to false);
--   * external links are released by the REPORT_LINKS_ENABLED switch (off by default), like the agent portal.
-- ============================================================

-- Which proof the brand may see. Default: nothing. (A closed project's flags are locked with the rest of its record.)
alter table deliverable_proofs add column report_visible boolean not null default false;

-- ---------- per-project report settings: branding (L18) and snapshot cadence (L17) ----------
create table project_report_settings (
  project_id uuid primary key references projects(id) on delete cascade,
  org_id uuid not null,
  branding text not null default 'emergex' check (branding in ('emergex', 'agent', 'co_branded')),
  cadence text not null default 'manual' check (cadence in ('manual', 'daily', 'every_2_days', 'weekly', 'monthly')),
  title text check (title is null or char_length(btrim(title)) between 1 and 120),     -- optional brand-facing title (default: the project name)
  agent_id uuid references agents(id),                                                  -- whose NAME is shown for agent / co-branded (D17: name only)
  updated_by uuid references profiles(id),
  updated_at timestamptz default now(),
  check (branding = 'emergex' or agent_id is not null)
);

-- ---------- snapshots (L17): the report as it stood at one moment — frozen, never edited ----------
create table report_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null references projects(id),
  trigger text not null check (trigger in ('manual', 'cadence', 'closing')),
  period_date date not null,
  taken_at timestamptz not null default now(),
  taken_by uuid references profiles(id),                       -- null = taken automatically
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_hash text not null,
  leaks text[] not null default '{}'                           -- names that must not be in a report but were found; non-empty = never shown externally
);
create unique index report_snapshots_one_cadence_per_day on report_snapshots (project_id, period_date) where trigger = 'cadence';
create unique index report_snapshots_one_closing_per_day on report_snapshots (project_id, period_date) where trigger = 'closing';
create index report_snapshots_project_idx on report_snapshots (project_id, taken_at desc);

-- ---------- links (L19) ----------
create table report_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id uuid not null references projects(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),    -- SHA-256 of the token. The token itself is shown once and never stored.
  label text check (label is null or char_length(btrim(label)) between 1 and 120),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id),
  check (expires_at > created_at),
  check (expires_at <= created_at + interval '366 days'),                    -- a link cannot be made to last for years
  check ((revoked_at is null) = (revoked_by is null))
);
create index report_links_project_idx on report_links (project_id, created_at desc);

-- ---------- the view log (L19): every view, append-only ----------
create table report_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  link_id uuid not null references report_links(id),
  kind text not null check (kind in ('report', 'snapshot', 'proof', 'pdf')),
  snapshot_id uuid references report_snapshots(id),
  proof_id uuid references deliverable_proofs(id),
  viewed_at timestamptz not null default now(),
  ip_hash text,                                                -- a per-link hash: the raw address is never stored
  user_agent text check (user_agent is null or char_length(user_agent) <= 200)
);
create index report_views_link_idx on report_views (link_id, viewed_at desc);

-- ---------- immutability ----------
create or replace function guard_report_append_only() returns trigger language plpgsql as $$
begin raise exception '% is a record and cannot be edited or deleted', tg_table_name; end $$;
create trigger trg_report_views_append_only before update or delete on report_views for each row execute function guard_report_append_only();
create trigger trg_report_snapshots_append_only before update or delete on report_snapshots for each row execute function guard_report_append_only();

-- A link can be revoked (once, with a person) and nothing else about it can ever change — an expiry is never extended, a hash never swapped.
create or replace function guard_report_link() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Report links cannot be deleted; revoke them instead'; end if;
  if old.revoked_at is null and new.revoked_at is not null and new.revoked_by is not null
     and (to_jsonb(new) - 'revoked_at' - 'revoked_by') = (to_jsonb(old) - 'revoked_at' - 'revoked_by') then return new; end if;
  raise exception 'A report link cannot be edited. Revoke it and create a new one';
end $$;
create trigger trg_guard_report_link before update or delete on report_links for each row execute function guard_report_link();

alter table project_report_settings enable row level security;
alter table report_snapshots enable row level security;
alter table report_links enable row level security;
alter table report_views enable row level security;
create policy "staff read report settings" on project_report_settings for select using (org_id = current_org() and is_internal());
create policy "staff read report snapshots" on report_snapshots for select using (org_id = current_org() and is_internal());
create policy "staff read report links" on report_links for select using (org_id = current_org() and is_internal());
create policy "staff read report views" on report_views for select using (org_id = current_org() and is_internal());
-- No insert/update/delete policies: the service layer is the only writer. External visitors have NO database access at all —
-- the public routes use the service layer and the allow-list in code.
