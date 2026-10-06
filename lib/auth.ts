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
export interface RequireProfileOptions {
  /** Only a handful of routes (the agent portal, changing your own password) may be used by external users. Default: refused. */
  allowExternal?: boolean
}

export async function requireProfile(opts: RequireProfileOptions = {}): Promise<Profile> {
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
    .select('id, org_id, full_name, role_key, agent_id, disabled, roles(is_external)')
    .eq('id', user.id)
    .single()

  if (error || !profile) throw new ApiError(403, 'No profile row for this user — an admin needs to add one')

  // A disabled account is refused HERE as well as banned at the auth level: a ban stops new sign-ins and
  // refreshes, but an access token already issued stays valid until it expires. For an agent that gap matters.
  if (profile.disabled) throw new ApiError(403, 'This account has been disabled')

  // DENY BY DEFAULT for external users. ~90 routes call requireProfile() with no arguments and many check
  // nothing else, so the safe default is "staff only"; the few routes an agent may use opt in explicitly.
  const isExternal = (profile.roles as unknown as { is_external: boolean } | null)?.is_external ?? false
  if (isExternal && !opts.allowExternal) throw new ApiError(403, 'This area is for company staff only')

  return {
    id: profile.id, org_id: profile.org_id, full_name: profile.full_name, role_key: profile.role_key,
    agent_id: profile.agent_id ?? null, is_external: isExternal
  } as Profile
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
