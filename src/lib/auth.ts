import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseService } from './supabaseServer'
import type { Profile } from '@/types/db'

/**
 * Resolves the calling user's identity from their session cookie (anon-key
 * client, just to read the session), then loads their profile — including
 * org_id and role — via the service-role client. Every API route calls this
 * first; nothing downstream trusts anything the client sent about who it is.
 */
export async function requireProfile(): Promise<Profile> {
  const cookieStore = cookies()
  const anon = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // getAll/setAll is the library's current interface; it copes with Supabase splitting a large session
      // across several cookies (sb-...-auth-token.0, .1, ...), which the older get/set/remove form left ambiguous.
      // Route handlers only READ the session here; the browser client is what refreshes and rewrites cookies.
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {}
      }
    }
  )

  const { data: { user } } = await anon.auth.getUser()
  if (!user) throw new ApiError(401, 'Not signed in')

  const svc = supabaseService()
  const { data: profile, error } = await svc
    .from('profiles')
    .select('id, org_id, full_name, role_key')
    .eq('id', user.id)
    .single()

  if (error || !profile) throw new ApiError(403, 'No profile row for this user — an admin needs to add one')
  return profile as Profile
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
