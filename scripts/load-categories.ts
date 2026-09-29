// Run once after schema.sql: `npm run load-categories`
// Reads categories.json and upserts it into the categories table.
import { createClient } from '@supabase/supabase-js'
import categoriesFile from '../categories.json'

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment first')

  const supabase = createClient(url, key)

  const rows = categoriesFile.categories.map((c) => ({
    key: c.key,
    label: c.label,
    group_label: c.group,
    reconfirmation_rule: c.reconfirmation_rule,
    property_label: c.property_label,
    item_label: c.item_label,
    property_fields: c.property_fields,
    item_fields: c.item_fields,
    price_unit_options: c.price_unit_options
  }))

  const { error } = await supabase.from('categories').upsert(rows, { onConflict: 'key' })
  if (error) throw error

  console.log(`Loaded ${rows.length} categories.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
