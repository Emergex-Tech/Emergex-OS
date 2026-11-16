import { NextResponse } from 'next/server'
import { requireAgent } from '@/lib/agentAccess'
import { errorResponse } from '@/lib/apiError'

export async function GET() {
  try {
    const ctx = await requireAgent()
    return NextResponse.json({ name: ctx.profile.full_name, company: ctx.agentName })
  } catch (err) { return errorResponse(err) }
}
export const dynamic = 'force-dynamic'
