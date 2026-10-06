-- TEST-ONLY stand-in for pg_trgm's similarity(): Jaccard over character bigrams.
create function similarity(a text, b text) returns numeric language sql immutable as $$
  with x as (select distinct substr(lower(a), i, 2) g from generate_series(1, greatest(length(a)-1,1)) i),
       y as (select distinct substr(lower(b), i, 2) g from generate_series(1, greatest(length(b)-1,1)) i)
  select (select count(*) from x join y using (g))::numeric / nullif((select count(*) from (select g from x union select g from y) u),0) $$;
