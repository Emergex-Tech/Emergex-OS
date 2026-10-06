-- ============================================================
-- Stage 2A — Block 4: share conflict checks (A21–A25) and the "already shared" panel (A5)
-- Run AFTER 005_stage2a_block3.sql.
--
-- D8 ("which brands and groups count as competing") is not answered in the PRD.
-- Rather than guess, competition is DATA the Manager/CEO maintains:
-- competitor_links, brand-to-brand or group-to-group, empty by default.
-- With no links configured, the competing-brand check simply never fires.
-- ============================================================

-- ---------- D8 as data ----------
create table competitor_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  a_type text not null check (a_type in ('brand', 'brand_group')),
  a_id uuid not null,
  b_type text not null check (b_type in ('brand', 'brand_group')),
  b_id uuid not null,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  check (not (a_type = b_type and a_id = b_id))
);
-- A competes with B is the same fact as B competes with A: one row per unordered pair.
create unique index competitor_links_pair_key on competitor_links (
  org_id,
  least(a_type || ':' || a_id::text, b_type || ':' || b_id::text),
  greatest(a_type || ':' || a_id::text, b_type || ':' || b_id::text)
);
alter table competitor_links enable row level security;
create policy "org read competitor_links" on competitor_links for select using (org_id = current_org());

-- ---------- A25: overrides need Manager/CEO approval and a reason ----------
create table share_conflict_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  proposal_id uuid references proposals(id) on delete set null,
  item_id uuid references items(id),
  brand_id uuid references brands(id),
  route_id uuid references routes(id),
  conflict_types text[] not null,
  conflicts jsonb,                       -- snapshot of what was flagged when the override was requested
  reason text not null,
  status text not null default 'pending', -- pending | approved | rejected | used
  requested_by uuid references profiles(id),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  used_at timestamptz,
  created_at timestamptz default now()
);
alter table share_conflict_overrides enable row level security;
create policy "org read share_conflict_overrides" on share_conflict_overrides for select using (org_id = current_org());

alter table shares add column if not exists override_id uuid references share_conflict_overrides(id);
alter table shares add column if not exists conflict_summary text;

insert into permissions (key, description) values
  ('share.override.approve', 'Approve a share-conflict override (Manager/CEO)'),
  ('competitor.manage', 'Maintain the list of competing brands/groups used by conflict checks')
on conflict (key) do nothing;
insert into role_permissions (role_key, permission_key) values
  ('manager', 'share.override.approve'), ('ceo', 'share.override.approve'), ('management', 'share.override.approve'),
  ('manager', 'competitor.manage'), ('ceo', 'competitor.manage'), ('management', 'competitor.manage')
on conflict do nothing;

-- ---------- competition, brand- or group-level, in either direction ----------
create or replace function brands_compete(p_org uuid, brand1 uuid, group1 uuid, brand2 uuid, group2 uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from competitor_links c
    where c.org_id = p_org and (
      ( ((c.a_type = 'brand' and c.a_id = brand1) or (c.a_type = 'brand_group' and c.a_id = group1))
        and ((c.b_type = 'brand' and c.b_id = brand2) or (c.b_type = 'brand_group' and c.b_id = group2)) )
      or
      ( ((c.a_type = 'brand' and c.a_id = brand2) or (c.a_type = 'brand_group' and c.a_id = group2))
        and ((c.b_type = 'brand' and c.b_id = brand1) or (c.b_type = 'brand_group' and c.b_id = group1)) )
    )
  );
$$;

-- ---------- A21–A24: what has this item already done that conflicts with sending it now? ----------
-- Read-only. Returns one row per (conflict type, prior share). A prior share can appear under
-- more than one type (e.g. same agent AND same group) — each is a distinct reason.
--   same_brand_other_route      A21  already reached this brand through a different route or contact
--   agent_other_brand           A22  the recipient agent already has it for one of their other brands
--   same_brand_group            A23  already reached another brand in the same brand group
--   competing_brand_same_market A24  already reached a competing brand in the same market
-- Re-sending to the same brand via the same route is deliberately NOT a conflict.
create or replace function check_share_conflicts(p_org uuid, p_item uuid, p_brand uuid, p_route uuid)
returns table (
  conflict_type text, share_id uuid, shared_at timestamptz,
  other_brand_id uuid, other_brand text, other_route_id uuid, agent_name text, market text, detail text
)
language sql stable as $$
  with me as (
    select b.id as brand_id, b.brand_group_id, r.id as route_id, r.agent_id, r.market
    from brands b
    left join routes r on r.id = p_route
    where b.id = p_brand and b.org_id = p_org
  ),
  prior as (
    select s.id as share_id, s.occurred_at as shared_at, s.brand_id, b.name as brand_name, b.brand_group_id,
           s.route_id, r.agent_id, r.market, a.name as agent_name
    from shares s
    join brands b on b.id = s.brand_id
    left join routes r on r.id = s.route_id
    left join agents a on a.id = r.agent_id
    where s.org_id = p_org and s.item_id = p_item
  )
  select 'same_brand_other_route'::text, p.share_id, p.shared_at, p.brand_id, p.brand_name, p.route_id, p.agent_name, p.market,
         ('Already sent to this brand via ' ||
           case when p.agent_name is not null then p.agent_name
                when p.route_id is null then 'an unrecorded route' else 'a direct route' end)::text
  from prior p, me
  where p.brand_id = me.brand_id and p.route_id is distinct from me.route_id

  union all
  select 'agent_other_brand', p.share_id, p.shared_at, p.brand_id, p.brand_name, p.route_id, p.agent_name, p.market,
         'Agent ' || p.agent_name || ' was already sent this for ' || p.brand_name
  from prior p, me
  where me.agent_id is not null and p.agent_id = me.agent_id and p.brand_id <> me.brand_id

  union all
  select 'same_brand_group', p.share_id, p.shared_at, p.brand_id, p.brand_name, p.route_id, p.agent_name, p.market,
         'Already sent to ' || p.brand_name || ', which is in the same brand group'
  from prior p, me
  where me.brand_group_id is not null and p.brand_group_id = me.brand_group_id and p.brand_id <> me.brand_id

  union all
  select 'competing_brand_same_market', p.share_id, p.shared_at, p.brand_id, p.brand_name, p.route_id, p.agent_name, p.market,
         'Already sent to ' || p.brand_name || ', a competing brand' ||
           case when p.market is null or me.market is null then ' (market not recorded on one side)' else ' in the same market' end
  from prior p, me
  where p.brand_id <> me.brand_id
    and brands_compete(p_org, me.brand_id, me.brand_group_id, p.brand_id, p.brand_group_id)
    and (p.market is null or me.market is null or lower(p.market) = lower(me.market));
$$;
