import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** A5: "Already shared with this brand" — everything that has reached this brand, via any route, newest first. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const profile = await requireProfile()
    const svc = supabaseService()
    const { data, error } = await svc
      .from('shares')
      .select('id, occurred_at, channel, items(name, properties(name)), routes(route_type, agents(name))')
      .eq('org_id', profile.org_id).eq('brand_id', params.id)
      .order('occurred_at', { ascending: false }).limit(200)
    if (error) throw new ApiError(400, error.message)

    return NextResponse.json((data ?? []).map((s) => {
      const item = s.items as unknown as { name: string; properties: { name: string } | null } | null
      const route = s.routes as unknown as { route_type: string; agents: { name: string } | null } | null
      return {
        share_id: s.id, at: s.occurred_at, channel: s.channel,
        item: item?.name ?? '', property: item?.properties?.name ?? '',
        route: route ? (route.agents?.name ? `via ${route.agents.name}` : route.route_type.replace(/_/g, ' ')) : 'route not recorded'
      }
    }))
  } catch (err) {
    return errorResponse(err)
  }
}

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
