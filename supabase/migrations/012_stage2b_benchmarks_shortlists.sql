-- ============================================================
-- Stage 2B — B18/B19/B20 (price benchmarks) and B22 (saved filters + shortlists).
-- Run AFTER 011_stage2b_agent_access.sql.
--
-- B21 (matching suggestions from a brief) is deliberately NOT built: the PRD says it comes last "once
-- there is enough history", and its own cut-list says to drop it in favour of saved filters and shortlists.
-- ============================================================

-- A benchmark compares like with like: it NEVER mixes currencies or pricing units, so a per-match price is
-- never averaged with a flat season fee. Results come back one row per (unit, currency).
-- Percentiles use percentile_cont (linear interpolation), which src/lib/benchmarks.ts reproduces exactly.
-- "Days to event" uses the value recorded on the price, or — if none was recorded — event_start minus the
-- price date. A price with neither is left out whenever a days filter is applied, never guessed.
-- Runs with the CALLER's rights (not SECURITY DEFINER), so row-level security still applies to anyone who calls it directly.
create or replace function price_benchmark(
  p_org uuid,
  p_category text default null, p_market text default null, p_vendor uuid default null,
  p_unit text default null, p_currency text default null,
  p_min_days int default null, p_max_days int default null, p_since date default null,
  p_types text[] default array['rack', 'quote', 'negotiated', 'transacted']
) returns table (unit text, currency text, n bigint, min_amount numeric, p25 numeric, median numeric, p75 numeric, max_amount numeric, oldest date, newest date)
language sql stable as $$
  select pr.unit, pr.currency, count(*),
         min(pr.amount),
         percentile_cont(0.25) within group (order by pr.amount),
         percentile_cont(0.50) within group (order by pr.amount),
         percentile_cont(0.75) within group (order by pr.amount),
         max(pr.amount), min(pr.price_date), max(pr.price_date)
  from price_records pr
  join items i on i.id = pr.item_id
  join properties p on p.id = i.property_id
  where pr.org_id = p_org
    and pr.amount is not null and pr.amount > 0
    and pr.type = any (p_types)
    and (p_category is null or p.category_key = p_category)
    and (p_market   is null or lower(p.market) = lower(p_market))
    and (p_vendor   is null or p.vendor_id = p_vendor)
    and (p_unit     is null or pr.unit = p_unit)
    and (p_currency is null or pr.currency = p_currency)
    and (p_since    is null or pr.price_date >= p_since)
    and (p_min_days is null or coalesce(pr.days_to_event, case when p.event_start is not null then p.event_start - pr.price_date end) >= p_min_days)
    and (p_max_days is null or coalesce(pr.days_to_event, case when p.event_start is not null then p.event_start - pr.price_date end) <= p_max_days)
  group by pr.unit, pr.currency
  order by count(*) desc, pr.unit, pr.currency
$$;

-- ---------- B22: saved filters and shortlists — a person's own workspace, optionally shared read-only ----------
create table saved_filters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_id uuid not null references profiles(id),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  criteria jsonb not null default '{}' check (jsonb_typeof(criteria) = 'object'),
  shared boolean not null default false,
  created_at timestamptz default now()
);
create unique index saved_filters_owner_name_key on saved_filters (owner_id, lower(name));

create table shortlists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  owner_id uuid not null references profiles(id),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  note text check (note is null or char_length(note) <= 500),
  shared boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index shortlists_owner_name_key on shortlists (owner_id, lower(name));

create table shortlist_items (
  shortlist_id uuid not null references shortlists(id) on delete cascade,
  item_id uuid not null references items(id),
  org_id uuid not null,
  added_by uuid references profiles(id),
  added_at timestamptz default now(),
  primary key (shortlist_id, item_id)
);
create or replace function guard_shortlist_item() returns trigger language plpgsql as $$
begin
  if (select org_id from shortlists where id = new.shortlist_id) is distinct from new.org_id
     or (select org_id from items where id = new.item_id) is distinct from new.org_id then
    raise exception 'The shortlist and the item must belong to the same organisation';
  end if;
  return new;
end $$;
create trigger trg_guard_shortlist_item before insert on shortlist_items for each row execute function guard_shortlist_item();

alter table saved_filters enable row level security;
alter table shortlists enable row level security;
alter table shortlist_items enable row level security;
-- Yours, or shared with the organisation — and internal staff only (is_internal() is the rule every policy now follows, see 011).
create policy "own or shared filters" on saved_filters for select using (org_id = current_org() and is_internal() and (owner_id = auth.uid() or shared));
create policy "own or shared shortlists" on shortlists for select using (org_id = current_org() and is_internal() and (owner_id = auth.uid() or shared));
create policy "items of visible shortlists" on shortlist_items for select using (
  org_id = current_org() and is_internal()
  and exists (select 1 from shortlists s where s.id = shortlist_id and (s.owner_id = auth.uid() or s.shared))
);
-- No insert/update/delete policies: the service layer is the only writer, as everywhere else.
create index shortlist_items_item_idx on shortlist_items (item_id);
