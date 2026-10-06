'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface Item { id: string; name: string; availability: string; is_stale: boolean; properties: { name: string; market: string | null; vendors: { name: string } | null; categories: { label: string } | null } }
interface Filter { id: string; name: string; criteria: Record<string, string | boolean>; shared: boolean; mine: boolean; owner: string | null }
interface Short { id: string; name: string; note: string | null; shared: boolean; mine: boolean; item_count: number; owner: string | null }
interface ShortDetail { id: string; name: string; mine: boolean; items: { item_id: string; items: { name: string; availability: string; properties: { name: string; market: string | null } } }[] }

export default function Shortlists() {
  const [crit, setCrit] = useState({ category_key: '', market: '', vendor_id: '', availability: '', q: '', stale_only: false })
  const [cats, setCats] = useState<{ key: string; label: string }[]>([]); const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [results, setResults] = useState<Item[]>([]); const [truncated, setTruncated] = useState(false); const [picked, setPicked] = useState<string[]>([])
  const [filters, setFilters] = useState<Filter[]>([]); const [lists, setLists] = useState<Short[]>([]); const [open, setOpen] = useState<ShortDetail | null>(null)
  const [fname, setFname] = useState(''); const [fshared, setFshared] = useState(false); const [target, setTarget] = useState(''); const [newName, setNewName] = useState('')
  const [error, setError] = useState(''); const [notice, setNotice] = useState('')

  const loadFilters = async () => { const r = await fetch('/api/saved-filters'); setFilters(r.ok ? await r.json() : []) }
  const loadLists = async () => { const r = await fetch('/api/shortlists'); setLists(r.ok ? await r.json() : []) }
  useEffect(() => {
    const sb = supabaseBrowser()
    sb.from('categories').select('key, label').order('label').then(({ data }) => setCats(data ?? []))
    sb.from('vendors').select('id, name').order('name').then(({ data }) => setVendors(data ?? []))
    loadFilters(); loadLists()
  }, [])

  const say = (e: string, n = '') => { setError(e); setNotice(n) }
  const send = async (url: string, method: string, body?: unknown) => { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const d = await r.json().catch(() => ({})); return { ok: r.ok, d } }

  async function search(c = crit) {
    say('')
    const qs = new URLSearchParams(); Object.entries(c).forEach(([k, v]) => { if (v !== '' && v !== false) qs.set(k, String(v)) })
    const r = await fetch(`/api/items/search?${qs}`); const d = await r.json()
    if (!r.ok) { say(d.error); return } setResults(d.items); setTruncated(d.truncated); setPicked([])
  }
  const apply = (f: Filter) => { const c = { category_key: '', market: '', vendor_id: '', availability: '', q: '', stale_only: false, ...f.criteria } as typeof crit; setCrit(c); search(c) }
  async function saveFilter() { const { ok, d } = await send('/api/saved-filters', 'POST', { name: fname, shared: fshared, criteria: Object.fromEntries(Object.entries(crit).filter(([, v]) => v !== '' && v !== false)) }); if (!ok) { say(d.error); return } setFname(''); say('', 'Filter saved.'); loadFilters() }
  async function addToList() {
    let id = target
    if (!id) { const { ok, d } = await send('/api/shortlists', 'POST', { name: newName }); if (!ok) { say(d.error); return } id = d.id; setNewName(''); setTarget(id) }
    const { ok, d } = await send(`/api/shortlists/${id}/items`, 'POST', { item_ids: picked }); if (!ok) { say(d.error); return }
    say('', `Added ${d.added}${d.already_there ? `, ${d.already_there} already there` : ''}.`); setPicked([]); loadLists(); if (open?.id === id) openList(id)
  }
  async function openList(id: string) { const r = await fetch(`/api/shortlists/${id}`); setOpen(r.ok ? await r.json() : null) }
  async function removeItem(itemId: string) { if (!open) return; const { ok, d } = await send(`/api/shortlists/${open.id}/items/${itemId}`, 'DELETE'); if (!ok) { say(d.error); return } openList(open.id); loadLists() }
  async function share(l: Short) { const { ok, d } = await send(`/api/shortlists/${l.id}`, 'PATCH', { shared: !l.shared }); if (!ok) say(d.error); else loadLists() }
  async function del(l: Short) { if (!window.confirm(`Delete "${l.name}"?`)) return; const { ok, d } = await send(`/api/shortlists/${l.id}`, 'DELETE'); if (!ok) say(d.error); else { if (open?.id === l.id) setOpen(null); loadLists() } }
  async function delFilter(f: Filter) { const { ok, d } = await send(`/api/saved-filters/${f.id}`, 'DELETE'); if (!ok) say(d.error); else loadFilters() }
  async function shareFilter(f: Filter) { const { ok, d } = await send(`/api/saved-filters/${f.id}`, 'PATCH', { shared: !f.shared }); if (!ok) say(d.error); else loadFilters() }

  const inp = 'bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full'
  return (
    <div>
      <h1 className="text-lg font-semibold mb-4">Shortlists &amp; saved filters</h1>
      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}{notice && <div className="text-green-400 text-sm mb-3">{notice}</div>}
      <div className="grid grid-cols-[1.6fr_1fr] gap-5">
        <div>
          <div className="bg-panel border border-line rounded-xl p-4 mb-4">
            <div className="grid grid-cols-3 gap-2 mb-2">
              <select className={inp} value={crit.category_key} onChange={(e) => setCrit({ ...crit, category_key: e.target.value })}><option value="">Any category</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
              <input className={inp} placeholder="Market" value={crit.market} onChange={(e) => setCrit({ ...crit, market: e.target.value })} />
              <select className={inp} value={crit.vendor_id} onChange={(e) => setCrit({ ...crit, vendor_id: e.target.value })}><option value="">Any vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
              <select className={inp} value={crit.availability} onChange={(e) => setCrit({ ...crit, availability: e.target.value })}><option value="">Any availability</option>{['available', 'on_hold', 'proposed', 'sold', 'expired'].map((a) => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}</select>
              <input className={inp} placeholder="Search names" value={crit.q} onChange={(e) => setCrit({ ...crit, q: e.target.value })} />
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={crit.stale_only} onChange={(e) => setCrit({ ...crit, stale_only: e.target.checked })} />Stale only</label>
            </div>
            <div className="flex gap-2 items-center"><button onClick={() => search()} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm">Search</button>
              <input className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" placeholder="Name this filter to save it" value={fname} onChange={(e) => setFname(e.target.value)} />
              <label className="text-xs text-muted"><input type="checkbox" checked={fshared} onChange={(e) => setFshared(e.target.checked)} /> share</label>
              <button onClick={saveFilter} disabled={!fname.trim()} className="border border-line px-3 py-2 rounded-md text-sm disabled:opacity-40">Save filter</button></div>
          </div>
          <div className="bg-panel border border-line rounded-xl overflow-hidden mb-3"><table className="w-full text-sm"><tbody>
            {results.map((i) => (<tr key={i.id} className="border-b border-line last:border-0"><td className="p-2 w-8"><input type="checkbox" checked={picked.includes(i.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id))} /></td>
              <td className="p-2">{i.name}<div className="text-xs text-muted">{i.properties.name} · {[i.properties.categories?.label, i.properties.market, i.properties.vendors?.name].filter(Boolean).join(' · ')}</div></td>
              <td className="p-2 text-xs text-right text-muted">{i.availability.replace('_', ' ')}{i.is_stale ? ' · stale' : ''}</td></tr>))}
            {results.length === 0 && <tr><td className="p-6 text-center text-muted">Search to see items.</td></tr>}</tbody></table></div>
          {truncated && <p className="text-xs text-amber mb-2">Showing the first 200 — narrow the filters to see the rest.</p>}
          {picked.length > 0 && <div className="flex gap-2 items-center"><span className="text-sm">{picked.length} selected →</span>
            <select className={`${inp} max-w-xs`} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">New shortlist…</option>{lists.filter((l) => l.mine).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            {!target && <input className={`${inp} max-w-xs`} placeholder="Name the new shortlist" value={newName} onChange={(e) => setNewName(e.target.value)} />}
            <button onClick={addToList} disabled={!target && !newName.trim()} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Add</button></div>}
        </div>
        <div>
          <div className="text-xs font-mono text-muted uppercase mb-2">Saved filters</div>
          <div className="bg-panel border border-line rounded-xl overflow-hidden mb-5"><table className="w-full text-sm"><tbody>
            {filters.map((f) => (<tr key={f.id} className="border-b border-line last:border-0"><td className="p-2"><button onClick={() => apply(f)} className="text-blue-400 underline">{f.name}</button>{!f.mine && <span className="text-xs text-muted"> · {f.owner}</span>}</td>
              <td className="p-2 text-xs text-right">{f.mine ? <><button onClick={() => shareFilter(f)} className="underline text-muted mr-2">{f.shared ? 'Unshare' : 'Share'}</button><button onClick={() => delFilter(f)} className="underline text-red-400">Delete</button></> : <span className="text-muted">shared</span>}</td></tr>))}
            {filters.length === 0 && <tr><td className="p-4 text-center text-muted">None yet.</td></tr>}</tbody></table></div>
          <div className="text-xs font-mono text-muted uppercase mb-2">Shortlists</div>
          <div className="bg-panel border border-line rounded-xl overflow-hidden mb-3"><table className="w-full text-sm"><tbody>
            {lists.map((l) => (<tr key={l.id} className="border-b border-line last:border-0"><td className="p-2"><button onClick={() => openList(l.id)} className="text-blue-400 underline">{l.name}</button> <span className="text-xs text-muted">({l.item_count}){!l.mine && ` · ${l.owner}`}</span></td>
              <td className="p-2 text-xs text-right">{l.mine ? <><button onClick={() => share(l)} className="underline text-muted mr-2">{l.shared ? 'Unshare' : 'Share'}</button><button onClick={() => del(l)} className="underline text-red-400">Delete</button></> : <span className="text-muted">shared · read-only</span>}</td></tr>))}
            {lists.length === 0 && <tr><td className="p-4 text-center text-muted">None yet.</td></tr>}</tbody></table></div>
          {open && <div className="bg-panel border border-line rounded-xl overflow-hidden"><div className="px-3 py-2 text-xs font-mono text-muted uppercase border-b border-line">{open.name}{!open.mine && ' (read-only)'}</div><table className="w-full text-sm"><tbody>
            {open.items.map((i) => (<tr key={i.item_id} className="border-b border-line last:border-0"><td className="p-2">{i.items.name}<div className="text-xs text-muted">{i.items.properties.name}{i.items.properties.market ? ` · ${i.items.properties.market}` : ''}</div></td><td className="p-2 text-right text-xs">{open.mine && <button onClick={() => removeItem(i.item_id)} className="underline text-muted">Remove</button>}</td></tr>))}
            {open.items.length === 0 && <tr><td className="p-4 text-center text-muted">Empty.</td></tr>}</tbody></table></div>}
        </div>
      </div>
    </div>
  )
}
