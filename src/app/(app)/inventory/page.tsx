'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import type { Category } from '@/types/db'
import DynamicFields from '@/components/DynamicFields'

interface PropertyRow {
  id: string
  name: string
  category_key: string
  market: string | null
  is_stale: boolean
  next_reconfirmation_at: string | null
  vendors: { name: string } | null
}
interface ItemRow {
  id: string
  name: string
  availability: string
  is_stale: boolean
  attributes: Record<string, unknown>
}
interface PriceRow {
  id: string
  item_id: string
  type: string
  amount: number | null
  currency: string
  unit: string | null
  price_date: string
}

const PRICE_TYPES = ['rack', 'quote', 'negotiated', 'transacted', 'market_intel']

export default function Inventory() {
  const [categories, setCategories] = useState<Category[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, ItemRow[]>>({})
  const [latestPrices, setLatestPrices] = useState<Record<string, PriceRow>>({}) // by item_id
  const [driveLinks, setDriveLinks] = useState<Record<string, string>>({}) // property_id -> drive_folder_id

  // New property form
  const [showNewProperty, setShowNewProperty] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [propertyFields, setPropertyFields] = useState<Record<string, string>>({})
  const [propertyName, setPropertyName] = useState('')

  // New item form (per expanded property)
  const [newItemForPropertyId, setNewItemForPropertyId] = useState<string | null>(null)
  const [itemName, setItemName] = useState('')
  const [itemFields, setItemFields] = useState<Record<string, string>>({})
  const [itemAvailability, setItemAvailability] = useState('available')
  const [itemOfferExpiry, setItemOfferExpiry] = useState('')

  // Record price form (per item)
  const [priceForItemId, setPriceForItemId] = useState<string | null>(null)
  const [priceType, setPriceType] = useState('quote')
  const [priceAmount, setPriceAmount] = useState('')
  const [priceUnit, setPriceUnit] = useState('')
  const [priceSource, setPriceSource] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = supabaseBrowser()
    const [cats, props, folders] = await Promise.all([
      supabase.from('categories').select('*'),
      supabase.from('properties').select('id, name, category_key, market, is_stale, next_reconfirmation_at, vendors(name)'),
      fetch('/api/drive-folders?entity_type=property').then((r) => (r.ok ? r.json() : []))
    ])
    setCategories((cats.data as unknown as Category[]) ?? [])
    setProperties((props.data as unknown as PropertyRow[]) ?? [])
    const links: Record<string, string> = {}
    for (const f of folders as { linked_id: string; drive_folder_id: string }[]) links[f.linked_id] = f.drive_folder_id
    setDriveLinks(links)
  }

  async function toggleExpand(propertyId: string) {
    if (expanded === propertyId) { setExpanded(null); return }
    setExpanded(propertyId)
    await loadItems(propertyId)
  }

  async function loadItems(propertyId: string) {
    const supabase = supabaseBrowser()
    const { data } = await supabase.from('items').select('id, name, availability, is_stale, attributes').eq('property_id', propertyId)
    const itemRows = (data as ItemRow[]) ?? []
    setItems((prev) => ({ ...prev, [propertyId]: itemRows }))

    if (itemRows.length) {
      const { data: prices } = await supabase
        .from('price_records')
        .select('id, item_id, type, amount, currency, unit, price_date')
        .in('item_id', itemRows.map((i) => i.id))
        .order('price_date', { ascending: false })
      const latest: Record<string, PriceRow> = {}
      for (const p of (prices as PriceRow[]) ?? []) if (!latest[p.item_id]) latest[p.item_id] = p
      setLatestPrices((prev) => ({ ...prev, ...latest }))
    }
  }

  const category = categories.find((c) => c.key === selectedCategory)

  async function createProperty() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/properties', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: propertyName, category_key: selectedCategory, attributes: propertyFields })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setShowNewProperty(false); setPropertyName(''); setPropertyFields({}); setSelectedCategory('')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  function itemCategoryFor(propertyId: string): Category | undefined {
    const prop = properties.find((p) => p.id === propertyId)
    return categories.find((c) => c.key === prop?.category_key)
  }

  async function createItem(propertyId: string) {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId, name: itemName, attributes: itemFields,
          availability: itemAvailability, offer_expiry: itemOfferExpiry || null
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNewItemForPropertyId(null); setItemName(''); setItemFields({}); setItemAvailability('available'); setItemOfferExpiry('')
      await loadItems(propertyId)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  async function recordPrice(itemId: string, propertyId: string) {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/price-records', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, type: priceType, amount: Number(priceAmount), unit: priceUnit || null, source: priceSource || null })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPriceForItemId(null); setPriceAmount(''); setPriceUnit(''); setPriceSource('')
      await loadItems(propertyId)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  async function retryDriveFolder(propertyId: string, name: string) {
    await fetch('/api/drive-folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: 'property', entity_id: propertyId, folder_name: name })
    })
    load()
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-lg font-semibold">Inventory</h1>
        <button onClick={() => setShowNewProperty((s) => !s)} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm">
          + New property
        </button>
      </div>

      {showNewProperty && (
        <div className="bg-panel border border-line rounded-xl p-4 mb-6">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-muted block mb-1">Category</label>
              <select
                value={selectedCategory}
                onChange={(e) => { setSelectedCategory(e.target.value); setPropertyFields({}) }}
                className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full"
              >
                <option value="">Select…</option>
                {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">{category?.property_label ?? 'Property'} name</label>
              <input value={propertyName} onChange={(e) => setPropertyName(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full" />
            </div>
          </div>

          {category && (
            <div className="mb-3">
              <DynamicFields fields={category.property_fields} values={propertyFields} onChange={(k, v) => setPropertyFields((p) => ({ ...p, [k]: v }))} />
            </div>
          )}

          <button onClick={createProperty} disabled={saving || !propertyName || !selectedCategory} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Create property'}
          </button>
        </div>
      )}

      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase">
            <tr className="border-b border-line">
              <th className="text-left p-3">Property</th><th className="text-left p-3">Category</th>
              <th className="text-left p-3">Market</th><th className="text-left p-3">Vendor</th>
              <th className="text-left p-3">Next check</th><th className="text-left p-3">Status</th><th className="text-left p-3">Files</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => {
              const propCategory = categories.find((c) => c.key === p.category_key)
              return (
                <>
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="p-3 cursor-pointer" onClick={() => toggleExpand(p.id)}>{p.name}</td>
                    <td className="p-3">{propCategory?.label ?? p.category_key}</td>
                    <td className="p-3">{p.market}</td>
                    <td className="p-3">{p.vendors?.name ?? '—'}</td>
                    <td className="p-3 font-mono text-xs">{p.next_reconfirmation_at ?? '—'}</td>
                    <td className="p-3">{p.is_stale ? <span className="text-red-400">Stale</span> : <span className="text-green-400">Current</span>}</td>
                    <td className="p-3">
                      {driveLinks[p.id]
                        ? <a href={`https://drive.google.com/drive/folders/${driveLinks[p.id]}`} target="_blank" rel="noreferrer" className="text-blue-400 underline text-xs">Open</a>
                        : <button onClick={() => retryDriveFolder(p.id, p.name)} className="text-xs text-muted underline">Create folder</button>}
                    </td>
                  </tr>
                  {expanded === p.id && (
                    <tr key={p.id + '-items'}>
                      <td colSpan={7} className="p-3 bg-panel2">
                        <div className="flex justify-between items-center mb-2">
                          <div className="text-xs text-muted uppercase">Items</div>
                          <button
                            onClick={() => setNewItemForPropertyId(newItemForPropertyId === p.id ? null : p.id)}
                            className="text-xs bg-amber text-black font-semibold px-3 py-1 rounded"
                          >
                            + Add item
                          </button>
                        </div>

                        {newItemForPropertyId === p.id && (
                          <div className="bg-panel border border-line rounded-md p-3 mb-3">
                            <div className="grid grid-cols-3 gap-3 mb-3">
                              <div>
                                <label className="text-xs text-muted block mb-1">{itemCategoryFor(p.id)?.item_label ?? 'Item'} name</label>
                                <input value={itemName} onChange={(e) => setItemName(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full" />
                              </div>
                              <div>
                                <label className="text-xs text-muted block mb-1">Availability</label>
                                <select value={itemAvailability} onChange={(e) => setItemAvailability(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full">
                                  <option value="available">Available</option><option value="on_hold">On hold</option>
                                  <option value="proposed">Proposed</option><option value="sold">Sold</option><option value="expired">Expired</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-xs text-muted block mb-1">Offer expiry</label>
                                <input type="date" value={itemOfferExpiry} onChange={(e) => setItemOfferExpiry(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full" />
                              </div>
                            </div>
                            {itemCategoryFor(p.id) && (
                              <div className="mb-3">
                                <DynamicFields fields={itemCategoryFor(p.id)!.item_fields} values={itemFields} onChange={(k, v) => setItemFields((f) => ({ ...f, [k]: v }))} />
                              </div>
                            )}
                            <button onClick={() => createItem(p.id)} disabled={saving || !itemName} className="bg-amber text-black font-semibold px-3 py-1.5 rounded text-xs disabled:opacity-40">
                              {saving ? 'Saving…' : 'Create item'}
                            </button>
                          </div>
                        )}

                        {(items[p.id] ?? []).map((i) => (
                          <div key={i.id} className="border-b border-line last:border-0 py-2">
                            <div className="flex justify-between items-center text-xs">
                              <span>{i.name}</span>
                              <div className="flex items-center gap-3">
                                <span className="text-muted">{i.availability}{i.is_stale ? ' · stale' : ''}</span>
                                {latestPrices[i.id] && (
                                  <span className="font-mono text-amber">
                                    {latestPrices[i.id].currency} {latestPrices[i.id].amount} {latestPrices[i.id].unit ?? ''} ({latestPrices[i.id].type})
                                  </span>
                                )}
                                <button onClick={() => setPriceForItemId(priceForItemId === i.id ? null : i.id)} className="text-muted underline">
                                  + Record price
                                </button>
                              </div>
                            </div>
                            {priceForItemId === i.id && (
                              <div className="flex gap-2 mt-2 bg-panel border border-line rounded-md p-2">
                                <select value={priceType} onChange={(e) => setPriceType(e.target.value)} className="bg-panel2 border border-line rounded px-2 py-1 text-xs">
                                  {PRICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <input placeholder="Amount" type="number" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} className="bg-panel2 border border-line rounded px-2 py-1 text-xs w-24" />
                                <select value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} className="bg-panel2 border border-line rounded px-2 py-1 text-xs">
                                  <option value="">unit —</option>
                                  {(itemCategoryFor(p.id)?.price_unit_options ?? []).map((u) => <option key={u} value={u}>{u}</option>)}
                                </select>
                                <input placeholder="Source" value={priceSource} onChange={(e) => setPriceSource(e.target.value)} className="bg-panel2 border border-line rounded px-2 py-1 text-xs flex-1" />
                                <button onClick={() => recordPrice(i.id, p.id)} disabled={saving || !priceAmount} className="bg-amber text-black font-semibold px-3 py-1 rounded text-xs disabled:opacity-40">Save</button>
                              </div>
                            )}
                          </div>
                        ))}
                        {(items[p.id] ?? []).length === 0 && <div className="text-xs text-muted">No items yet.</div>}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {properties.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted">No properties yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
