import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabaseServer'
import { requireProfile } from '@/lib/auth'
import { checkDriveAccess } from '@/lib/googleDrive'
import { agentAccessEnabled } from '@/lib/agentAccess'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Deployment diagnostic. Open  https://<your-app>/api/health  after deploying.
 *
 * It reports, without exposing any secret or any business data:
 *   - which environment variables are set (true/false only)
 *   - whether each SQL migration has actually been run (by probing for what it creates)
 *   - whether categories are loaded and your org + profile exist
 *   - whether you're signed in and as which role
 * Add  ?deep=1  (while signed in) to also test real read access to the Google Shared Drive.
 */
export async function GET(req: NextRequest) {
  const has = (k: string) => !!process.env[k]
  let driveKeyIsJson = false
  try { JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? ''); driveKeyIsJson = true } catch { /* not valid JSON */ }

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: has('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: has('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    SUPABASE_URL: has('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: has('SUPABASE_SERVICE_ROLE_KEY'),
    ANTHROPIC_API_KEY: has('ANTHROPIC_API_KEY'),
    GOOGLE_SERVICE_ACCOUNT_KEY: has('GOOGLE_SERVICE_ACCOUNT_KEY') && driveKeyIsJson,
    GOOGLE_SHARED_DRIVE_ID: has('GOOGLE_SHARED_DRIVE_ID')
  }
  const envHint: Record<string, string> = {}
  if (has('GOOGLE_SERVICE_ACCOUNT_KEY') && !driveKeyIsJson) envHint.GOOGLE_SERVICE_ACCOUNT_KEY = 'Set, but it is not valid JSON — paste the whole key file contents on one line'

  type Check = { name: string; ok: boolean; detail?: string }
  const checks: Check[] = []

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ready: false, env, envHint, checks, note: 'Supabase server keys are missing — nothing else can be checked yet.' })
  }

  const svc = supabaseService()
  const probe = async (name: string, table: string, columns: string) => {
    const { error } = await svc.from(table).select(columns, { head: true, count: 'exact' }).limit(1)
    checks.push({ name, ok: !error, detail: error ? error.message : undefined })
  }

  await probe('schema.sql: core tables', 'profiles', 'id, org_id, role_key')
  await probe('schema.sql: inventory', 'items', 'id, next_reconfirmation_at')
  await probe('migration 003: proposal lines', 'proposal_lines', 'id, sell_price, pricing_mechanic')
  await probe('migration 004: stage history + per-route agent cuts', 'proposal_stage_history', 'id, to_stage')
  await probe('migration 004: route cut overrides', 'routes', 'cut_method, cut_pct, fixed_fee')
  await probe('migration 005: versions', 'proposal_versions', 'snapshot, change_summary')
  await probe('migration 005: export files', 'files', 'kind, proposal_version_id')
  await probe('migration 006: competitor links', 'competitor_links', 'id, a_type, b_type')
  await probe('migration 006: share overrides', 'share_conflict_overrides', 'id, status')
  await probe('migration 009: contracts', 'contracts', 'id, deal_id, renewal_date, final_amount')
  await probe('migration 009: deliverables', 'deliverables', 'id, contract_id, status')
  await probe('migration 010: invoices', 'invoices', 'id, seq_no, direction, amount, status')
  await probe('migration 010: payments', 'payments', 'id, invoice_id, amount')
  await probe('migration 010: invoice chases', 'invoice_chases', 'id, invoice_id')
  await probe('migration 011: agent grants', 'shareable_grants', 'id, agent_id, item_id, revoked_at')
  await probe('migration 011: agent activity log', 'agent_activity', 'id, agent_id, action')
  await probe('migration 011: agent users + contract files', 'profiles', 'agent_id')
  await probe('migration 011: contract file versions', 'files', 'doc_title, sha256, size_bytes')
  const agentRole = await svc.from('roles').select('key, is_external').eq('key', 'agent').maybeSingle()
  checks.push({ name: 'migration 011: agent role exists and is marked external', ok: agentRole.data?.is_external === true, detail: agentRole.error?.message })

  const roles = await svc.from('roles').select('key').in('key', ['team', 'manager', 'ceo'])
  checks.push({ name: 'migration 002: manager + ceo roles exist', ok: (roles.data?.length ?? 0) === 3, detail: roles.error?.message })

  const fn = await svc.rpc('check_share_conflicts', {
    p_org: '00000000-0000-0000-0000-000000000000', p_item: '00000000-0000-0000-0000-000000000000',
    p_brand: '00000000-0000-0000-0000-000000000000', p_route: null
  })
  checks.push({ name: 'migration 006: check_share_conflicts() function', ok: !fn.error, detail: fn.error?.message })

  const cats = await svc.from('categories').select('key', { count: 'exact', head: true })
  checks.push({ name: 'categories loaded (expect 12) — run supabase/seed_categories.sql', ok: (cats.count ?? 0) >= 12, detail: `found ${cats.count ?? 0}` })

  const orgs = await svc.from('organisations').select('id', { count: 'exact', head: true })
  checks.push({ name: 'an organisation exists', ok: (orgs.count ?? 0) >= 1, detail: `found ${orgs.count ?? 0}` })
  const profiles = await svc.from('profiles').select('id', { count: 'exact', head: true })
  checks.push({ name: 'at least one user profile exists', ok: (profiles.count ?? 0) >= 1, detail: `found ${profiles.count ?? 0}` })

  // Who is looking at this page?
  let session: { signedIn: boolean; role?: string; problem?: string } = { signedIn: false }
  try {
    const profile = await requireProfile()
    session = { signedIn: true, role: profile.role_key }
  } catch (e) {
    session = { signedIn: false, problem: e instanceof Error ? e.message : String(e) }
  }

  let drive: { ok: boolean; detail: string } | undefined
  if (req.nextUrl.searchParams.get('deep') === '1') {
    drive = session.signedIn ? await checkDriveAccess() : { ok: false, detail: 'Sign in first — the deep Drive check is only run for signed-in users' }
  }

  const criticalEnv = env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
  return NextResponse.json({
    ready: criticalEnv && checks.every((c) => c.ok),
    env, envHint, checks, session, drive,
    optional: {
      agent_portal: agentAccessEnabled() ? 'ENABLED — agents can use the portal' : 'disabled (AGENT_ACCESS_ENABLED is not set). Agent accounts can be created, but cannot use any data route. Enable only after your security review.',
      capture_ai: env.ANTHROPIC_API_KEY ? 'configured' : 'ANTHROPIC_API_KEY missing — Capture will not work',
      drive: env.GOOGLE_SERVICE_ACCOUNT_KEY && env.GOOGLE_SHARED_DRIVE_ID ? 'configured (add ?deep=1 to test access)' : 'not configured — records and exports still work, files just are not filed in Drive'
    }
  })
}
