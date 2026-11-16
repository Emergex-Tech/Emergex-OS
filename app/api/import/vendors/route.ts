import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { errorResponse } from '@/lib/apiError'

interface VendorRow { name: string; type?: string; markets?: string; status?: string }

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    const rows = body.rows as VendorRow[]
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'rows array is required')

    const created: string[] = []
    const errors: { row: number; message: string }[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row.name?.trim()) { errors.push({ row: i, message: 'Missing name' }); continue }
      try {
        const vendor = await createRecord({
          profile,
          permission: 'record.create',
          table: 'vendors',
          entityType: 'vendor',
          data: { name: row.name.trim(), type: row.type ?? null, markets: row.markets ?? null, status: row.status ?? 'Recurring' },
          duplicateCheck: { entityType: 'vendor', nameField: 'name' },
          driveFolder: { entityType: 'vendor', nameField: 'name' }
        })
        created.push(vendor.id)
      } catch (e) {
        errors.push({ row: i, message: e instanceof Error ? e.message : String(e) })
      }
    }

    return NextResponse.json({ created: created.length, errors })
  } catch (err) {
    return errorResponse(err)
  }
}

// Vercel: this route calls other services / loops over rows, so give it more than the short default.
export const maxDuration = 60

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
