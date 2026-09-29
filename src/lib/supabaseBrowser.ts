import { createBrowserClient } from '@supabase/ssr'

// Anon key, RLS-scoped. Used for READS from client components only.
// All writes go through /api/* routes (the service layer) — see
// supabaseServer.ts and CLAUDE.md's "no direct writes" rule.
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
