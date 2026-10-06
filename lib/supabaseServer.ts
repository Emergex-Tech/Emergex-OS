import { createClient, SupabaseClient } from '@supabase/supabase-js'

// SERVICE ROLE KEY — bypasses RLS entirely. This client must never be
// imported into any file that ships to the browser. It exists only inside
// src/app/api/**/route.ts handlers, which is what makes those routes "the
// service layer" the PRD requires: the one place all writes go through,
// where permission checks and audit logging actually happen — RLS is the
// second layer, not the only one.
let _client: SupabaseClient | null = null

export function supabaseService(): SupabaseClient {
  if (_client) return _client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — see .env.example')
  }
  _client = createClient(url, key, { auth: { persistSession: false } })
  return _client
}
