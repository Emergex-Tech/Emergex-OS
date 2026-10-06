-- Duplicate detection (Stage 1 6.3): flags suspected duplicates for
-- Management to review and merge. Called by the service layer after any
-- vendor/property create — not automatic in the DB, since we want the
-- service layer to decide when to check and to write the audit trail.

create or replace function find_similar_properties(p_org_id uuid, p_name text, p_exclude_id uuid, p_threshold numeric default 0.4)
returns table (id uuid, name text, similarity numeric) as $$
  select id, name, similarity(name, p_name) as similarity
  from properties
  where org_id = p_org_id
    and id != p_exclude_id
    and similarity(name, p_name) > p_threshold
  order by similarity desc
  limit 5;
$$ language sql stable;

create or replace function find_similar_vendors(p_org_id uuid, p_name text, p_exclude_id uuid, p_threshold numeric default 0.4)
returns table (id uuid, name text, similarity numeric) as $$
  select id, name, similarity(name, p_name) as similarity
  from vendors
  where org_id = p_org_id
    and id != p_exclude_id
    and similarity(name, p_name) > p_threshold
  order by similarity desc
  limit 5;
$$ language sql stable;
