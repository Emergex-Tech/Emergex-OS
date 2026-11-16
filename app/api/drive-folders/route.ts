import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { requirePermission, tryCreateDriveFolder } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

/** Retry folder creation — for records made before Drive was configured, or after a failure. */
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    const { entity_type, entity_id, folder_name } = body
    if (!entity_type || !entity_id || !folder_name) {
      throw new ApiError(400, 'entity_type, entity_id and folder_name are required')
    }
    await requirePermission(profile, 'record.update')

    await tryCreateDriveFolder({
      orgId: profile.org_id, actorId: profile.id, entityType: entity_type, entityId: entity_id, folderName: folder_name
    })

    const svc = supabaseService()
    const { data } = await svc.from('files').select('drive_folder_id').eq('linked_type', entity_type).eq('linked_id', entity_id).maybeSingle()

    return NextResponse.json({ ok: !!data, drive_folder_id: data?.drive_folder_id ?? null })
  } catch (err) {
    return errorResponse(err)
  }
}

/** List folder status for a set of records (used by list pages to show "Open in Drive" or "Retry"). */
export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const entityType = req.nextUrl.searchParams.get('entity_type')
    if (!entityType) throw new ApiError(400, 'entity_type query param is required')

    const svc = supabaseService()
    const { data } = await svc
      .from('files')
      .select('linked_id, drive_folder_id')
      .eq('org_id', profile.org_id)
      .eq('linked_type', entityType)
      .is('drive_file_id', null) // folder marker rows have no drive_file_id, only drive_folder_id

    return NextResponse.json(data ?? [])
  } catch (err) {
    return errorResponse(err)
  }
}

// Vercel: this route calls other services / loops over rows, so give it more than the short default.
export const maxDuration = 60

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
