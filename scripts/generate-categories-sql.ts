// Regenerates supabase/seed_categories.sql from categories.json:
//   npx tsx scripts/generate-categories-sql.ts > supabase/seed_categories.sql
// The SQL file is what you paste into the Supabase SQL editor — no terminal needed on your side.
import categoriesFile from '../categories.json'

const q = (s: string | null | undefined) => (s == null ? 'null' : `'${s.replace(/'/g, "''")}'`)
const j = (v: unknown) => `$json$${JSON.stringify(v)}$json$::jsonb`

const rows = categoriesFile.categories.map((c) =>
  `  (${q(c.key)}, ${q(c.label)}, ${q(c.group)}, ${q(c.reconfirmation_rule)}, ${q(c.property_label)}, ${q(c.item_label)}, ${j(c.property_fields)}, ${j(c.item_fields)}, ${j(c.price_unit_options)})`
)

console.log(`-- GENERATED from categories.json by scripts/generate-categories-sql.ts — edit categories.json, then regenerate.
-- Safe to re-run: existing categories are updated in place.
insert into categories (key, label, group_label, reconfirmation_rule, property_label, item_label, property_fields, item_fields, price_unit_options)
values
${rows.join(',\n')}
on conflict (key) do update set
  label = excluded.label, group_label = excluded.group_label, reconfirmation_rule = excluded.reconfirmation_rule,
  property_label = excluded.property_label, item_label = excluded.item_label,
  property_fields = excluded.property_fields, item_fields = excluded.item_fields, price_unit_options = excluded.price_unit_options;`)
