'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface Vendor { id: string; name: string; type: string | null; markets: string | null; status: string }

export default function Vendors() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [markets, setMarkets] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])
  async function load() {
    const { data } = await supabaseBrowser().from('vendors').select('id, name, type, markets, status')
    setVendors(data ?? [])
  }

  async function create() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/vendors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, markets })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setName(''); setType(''); setMarkets(''); load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold mb-5">Vendors</h1>
      <div className="bg-panel border border-line rounded-xl p-4 mb-6 flex gap-3">
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" />
        <input placeholder="Type" value={type} onChange={(e) => setType(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" />
        <input placeholder="Markets" value={markets} onChange={(e) => setMarkets(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" />
        <button onClick={create} disabled={saving || !name} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Add</button>
      </div>
      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}
      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase"><tr className="border-b border-line"><th className="text-left p-3">Name</th><th className="text-left p-3">Type</th><th className="text-left p-3">Markets</th><th className="text-left p-3">Status</th></tr></thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className="border-b border-line last:border-0"><td className="p-3">{v.name}</td><td className="p-3">{v.type}</td><td className="p-3">{v.markets}</td><td className="p-3">{v.status}</td></tr>
            ))}
            {vendors.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted">No vendors yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
