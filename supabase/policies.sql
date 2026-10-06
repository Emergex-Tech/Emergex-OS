-- ============================================================
-- Row Level Security — defense in depth.
-- Per PRD Appendix B: "Row-level security in the database;
-- Management-only fields in separate tables; hiding in the interface
-- is not sufficient." The service layer (Next.js API routes, using the
-- service-role key) is the PRIMARY enforcement point for writes and does
-- its own permission checks — these policies are the second layer, so a
-- bug in the service layer or a direct query still can't leak data or
-- allow a write it shouldn't.
-- ============================================================

alter table profiles enable row level security;
alter table vendors enable row level security;
alter table vendor_contacts enable row level security;
alter table properties enable row level security;
alter table property_edge enable row level security;
alter table items enable row level security;
alter table confirmations enable row level security;
alter table reconfirmation_overrides enable row level security;
alter table brand_groups enable row level security;
alter table brands enable row level security;
alter table brand_tier enable row level security;
alter table agents enable row level security;
alter table contacts enable row level security;
alter table routes enable row level security;
alter table route_score_changes enable row level security;
alter table price_records enable row level security;
alter table intel_notes enable row level security;
alter table shares enable row level security;
alter table captures enable row level security;
alter table files enable row level security;
alter table proposals enable row level security;
alter table proposal_versions enable row level security;
alter table deals enable row level security;

-- profiles
create policy "read own org profiles" on profiles for select using (org_id = current_org());

-- Everything below: internal roles (team/management) read within their org.
-- All of these tables get NO insert/update policy for anon/authenticated —
-- writes only happen via the service layer's service-role client, which
-- bypasses RLS by design and performs its own permission + audit logic.
create policy "org read vendors" on vendors for select using (org_id = current_org());
create policy "org read vendor_contacts" on vendor_contacts for select using (org_id = current_org());
create policy "org read properties" on properties for select using (org_id = current_org());
create policy "org read items" on items for select using (org_id = current_org());
create policy "org read confirmations" on confirmations for select using (org_id = current_org());
create policy "org read overrides" on reconfirmation_overrides for select using (org_id = current_org());
create policy "org read brand_groups" on brand_groups for select using (org_id = current_org());
create policy "org read brands" on brands for select using (org_id = current_org());
create policy "org read agents" on agents for select using (org_id = current_org());
create policy "org read contacts" on contacts for select using (org_id = current_org());
create policy "org read routes" on routes for select using (org_id = current_org());
create policy "org read route_score_changes" on route_score_changes for select using (org_id = current_org());
create policy "org read price_records" on price_records for select using (org_id = current_org());
create policy "org read shares" on shares for select using (org_id = current_org());
create policy "org read captures" on captures for select using (org_id = current_org());
create policy "org read files" on files for select using (org_id = current_org());
create policy "org read proposals" on proposals for select using (org_id = current_org());
create policy "org read deals" on deals for select using (org_id = current_org());

-- Management-only tables: policy requires the permission, not just org —
-- Team gets zero rows back, not a UI-hidden column.
create policy "management read property_edge" on property_edge
  for select using (org_id = current_org() and has_permission('property.edge.view'));
create policy "management read brand_tier" on brand_tier
  for select using (org_id = current_org() and has_permission('brand.tier.view'));

-- Intel: agent-submitted notes are invisible to other agents. In Stage 1
-- there are no agent logins yet, so this only matters from Stage 2B on —
-- written now so Stage 2B doesn't need a policy migration.
create policy "org read intel, agents see only their own" on intel_notes
  for select using (
    org_id = current_org()
    and (
      submitted_by_agent_id is null
      or current_role_key() in ('management') -- internal roles see all
      or current_role_key() = 'team'
      -- Stage 2B adds: or submitted_by_agent_id = (select agent_id from profiles where id = auth.uid())
    )
  );
