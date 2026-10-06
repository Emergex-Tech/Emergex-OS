'use client'
import { useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface Result {
  type: string
  label: string
  sub: string
}

export default function Search() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function runSearch() {
    if (!q.trim()) return
    setLoading(true)
    setSearched(true)
    const supabase = supabaseBrowser()
    const like = `%${q}%`

    // PRD 6.26: "One search across all records, intel, captures, shares and
    // file text." Stage 1 covers records + intel; captures/shares/file-text
    // search is a straightforward extension of this same fan-out pattern.
    const [properties, items, vendors, brands, intel] = await Promise.all([
      supabase.from('properties').select('id, name, market').ilike('name', like).limit(8),
      supabase.from('items').select('id, name').ilike('name', like).limit(8),
      supabase.from('vendors').select('id, name, markets').ilike('name', like).limit(8),
      supabase.from('brands').select('id, name, markets').ilike('name', like).limit(8),
      supabase.from('intel_notes').select('id, note').ilike('note', like).limit(8)
    ])

    setResults([
      ...(properties.data ?? []).map((r) => ({ type: 'Property', label: r.name, sub: r.market ?? '' })),
      ...(items.data ?? []).map((r) => ({ type: 'Item', label: r.name, sub: '' })),
      ...(vendors.data ?? []).map((r) => ({ type: 'Vendor', label: r.name, sub: r.markets ?? '' })),
      ...(brands.data ?? []).map((r) => ({ type: 'Brand', label: r.name, sub: r.markets ?? '' })),
      ...(intel.data ?? []).map((r) => ({ type: 'Intel note', label: r.note.slice(0, 80), sub: '' }))
    ])
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-lg font-semibold mb-5">Search</h1>
      <div className="flex gap-2 mb-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          placeholder="Search properties, items, vendors, brands, intel…"
          className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1"
        />
        <button onClick={runSearch} disabled={loading} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        {results.map((r, i) => (
          <div key={i} className="flex justify-between items-center p-3 border-b border-line last:border-0 text-sm">
            <div>
              <div>{r.label}</div>
              {r.sub && <div className="text-xs text-muted">{r.sub}</div>}
            </div>
            <span className="text-xs font-mono text-muted">{r.type}</span>
          </div>
        ))}
        {searched && !loading && results.length === 0 && (
          <div className="p-6 text-center text-muted text-sm">No matches.</div>
        )}
        {!searched && <div className="p-6 text-center text-muted text-sm">Type a query and press Search.</div>}
      </div>
    </div>
  )
}
