import { NextRequest, NextResponse } from 'next/server'
import { requireProfile, ApiError } from '@/lib/auth'
import { createRecord } from '@/lib/serviceLayer'
import { supabaseService } from '@/lib/supabaseServer'
import { errorResponse } from '@/lib/apiError'

interface InventoryRow {
  category_key: string
  vendor_name?: string
  property_name: string
  market?: string
  event_start?: string
  event_end?: string
  item_name: string
  availability?: string
  cost?: string
  currency?: string
  unit?: string
  price_type?: string
  source?: string
}

/**
 * One row = one item, grouped under its property by (category_key, property_name).
 * Vendors and properties are resolved by exact case-insensitive name match first
 * (existing DB row wins), then within this same import batch (so 50 item rows
 * for one property don't create 50 properties), and only created fresh if
 * neither matches. This is deliberately stricter than the trigram-based
 * duplicate flagging used elsewhere — an import is exactly the situation
 * where silently creating near-duplicates would defeat the point.
 */
export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const body = await req.json()
    const rows = body.rows as InventoryRow[]
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'rows array is required')

    const svc = supabaseService()
    const vendorCache = new Map<string, string>() // lowercase name -> id
    const propertyCache = new Map<string, string>() // `${category_key}::${lowercase name}` -> id
    const errors: { row: number; message: string }[] = []
    let itemsCreated = 0
    let pricesCreated = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        if (!row.category_key || !row.property_name || !row.item_name) {
          throw new Error('category_key, property_name and item_name are required')
        }

        // Resolve vendor (optional)
        let vendorId: string | null = null
        if (row.vendor_name?.trim()) {
          const key = row.vendor_name.trim().toLowerCase()
          vendorId = vendorCache.get(key) ?? null
          if (!vendorId) {
            const { data: existing } = await svc.from('vendors').select('id').eq('org_id', profile.org_id).ilike('name', row.vendor_name.trim()).maybeSingle()
            if (existing) {
              vendorId = existing.id
            } else {
              const created = await createRecord({
                profile, permission: 'record.create', table: 'vendors', entityType: 'vendor',
                data: { name: row.vendor_name.trim(), status: 'Recurring' },
                driveFolder: { entityType: 'vendor', nameField: 'name' }
              })
              vendorId = created.id
            }
            vendorCache.set(key, vendorId as string)
          }
        }

        // Resolve property
        const propKey = `${row.category_key}::${row.property_name.trim().toLowerCase()}`
        let propertyId = propertyCache.get(propKey) ?? null
        if (!propertyId) {
          const { data: existing } = await svc
            .from('properties').select('id').eq('org_id', profile.org_id)
            .eq('category_key', row.category_key).ilike('name', row.property_name.trim()).maybeSingle()
          if (existing) {
            propertyId = existing.id
          } else {
            const created = await createRecord({
              profile, permission: 'record.create', table: 'properties', entityType: 'property',
              data: {
                category_key: row.category_key, vendor_id: vendorId, name: row.property_name.trim(),
                market: row.market ?? null, event_start: row.event_start || null, event_end: row.event_end || null,
                attributes: {}
              },
              driveFolder: { entityType: 'property', nameField: 'name' }
            })
            propertyId = created.id
            await svc.from('confirmations').insert({ org_id: profile.org_id, entity_type: 'property', entity_id: propertyId, confirmed_by: profile.id })
          }
          propertyCache.set(propKey, propertyId as string)
        }

        // Create item
        const item = await createRecord({
          profile, permission: 'record.create', table: 'items', entityType: 'item',
          data: { property_id: propertyId, name: row.item_name.trim(), availability: row.availability ?? 'available', attributes: {} }
        })
        await svc.from('confirmations').insert({ org_id: profile.org_id, entity_type: 'item', entity_id: item.id, confirmed_by: profile.id })
        itemsCreated++

        // Optional first price record
        if (row.cost) {
          await createRecord({
            profile, permission: 'price.record_cost', table: 'price_records', entityType: 'price_record',
            data: {
              item_id: item.id, type: row.price_type ?? 'rack', amount: Number(row.cost),
              currency: row.currency ?? 'USD', unit: row.unit ?? null, source: row.source ?? 'Import'
            }
          })
          pricesCreated++
        }
      } catch (e) {
        errors.push({ row: i, message: e instanceof Error ? e.message : String(e) })
      }
    }

    return NextResponse.json({ itemsCreated, pricesCreated, errors })
  } catch (err) {
    return errorResponse(err)
  }
}

// Vercel: this route calls other services / loops over rows, so give it more than the short default.
export const maxDuration = 60

// Never prerender or cache: every API route reads the signed-in user's session.
export const dynamic = 'force-dynamic'
