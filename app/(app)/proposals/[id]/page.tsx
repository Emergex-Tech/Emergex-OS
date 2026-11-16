'use client'
import { useEffect, useState } from 'react'
import AddFromShortlist from '@/components/AddFromShortlist'
import PastProjects from '@/components/PastProjects'
import { useParams } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface Item { id: string; name: string }
interface Line {
  id: string; item_id: string; quantity: number; sell_price: number; pricing_mechanic: string
  items: { name: string } | null
  warnings?: string[]
  other_brand_prices?: { brand: string; sell_price: number }[]
  pricing?: { cost_used: number; margin_pct: number; agent_cut_amount: number; net_margin_emx: number; net_margin_pct: number } | null
}
interface Version { id: string; version_number: number; change_summary: string | null; note: string | null; created_at: string; total: number | null; currency: string | null }
interface Shared { share_id: string; at: string; item: string; property: string; route: string; channel: string | null }
interface ConflictRow { conflict_type: string; detail: string; other_brand: string }
interface LineConflict { line_id: string; item_name: string; conflicts: ConflictRow[]; override: 'none' | 'pending' | 'approved' | 'rejected' }
interface ProposalDetail {
  id: string; brand_id: string; stage: string; brief: string | null; budget: number | null; currency: string
  brands: { name: string } | null
  routes: { route_type: string; market: string | null; agents: { name: string } | null } | null
  lines: Line[]
  can_view_margin: boolean
}

const STAGES = ['Draft', 'Review', 'Approved', 'Sent', 'Negotiating', 'Won', 'Lost']
const MECHANICS = [
  { value: 'markup', label: 'Markup (% of cost)' },
  { value: 'commission', label: 'Commission (% of sell price)' },
  { value: 'fee', label: 'Fee (flat amount)' }
]

export default function ProposalDetail() {
  const params = useParams<{ id: string }>()
  const [proposal, setProposal] = useState<ProposalDetail | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [selectedItem, setSelectedItem] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [mechanic, setMechanic] = useState('markup')
  const [role, setRole] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [versions, setVersions] = useState<Version[]>([])
  const [shared, setShared] = useState<Shared[]>([])
  const [conflicts, setConflicts] = useState<LineConflict[]>([])
  const [showShared, setShowShared] = useState(false)

  useEffect(() => { load() }, [params.id])

  async function load() {
    const supabase = supabaseBrowser()
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const { data: profile } = await supabase.from('profiles').select('role_key').eq('id', session.user.id).single()
      setRole(profile?.role_key ?? null)
    }
    const [p, i] = await Promise.all([
      fetch(`/api/proposals/${params.id}`).then((r) => (r.ok ? r.json() : null)),
      supabase.from('items').select('id, name')
    ])
    setProposal(p)
    setItems(i.data ?? [])
    const v = await fetch(`/api/proposals/${params.id}/versions`)
    setVersions(v.ok ? await v.json() : [])
    if (p?.brand_id) {
      const sh = await fetch(`/api/brands/${p.brand_id}/shares`)
      setShared(sh.ok ? await sh.json() : [])
    }
    const cf = await fetch(`/api/proposals/${params.id}/conflicts`)
    setConflicts(cf.ok ? await cf.json() : [])
    if (i.data?.length && !selectedItem) setSelectedItem(i.data[0].id)
  }

  async function addLine() {
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`/api/proposals/${params.id}/lines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: selectedItem, quantity: Number(quantity), pricing_mechanic: mechanic })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.other_brand_prices?.length) {
        setNotice(`Already quoted to: ${data.other_brand_prices.map((o: { brand: string; sell_price: number }) => `${o.brand} (${o.sell_price.toLocaleString()})`).join(', ')}`)
      }
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function setMargin(lineId: string, rate: string) {
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/proposals/${params.id}/lines/${lineId}/margin`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: Number(rate) })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function confirmLine(lineId: string, asOverride: boolean) {
    let reason: string | null = null
    if (asOverride) {
      reason = window.prompt('Reason for the override?')
      if (!reason) return
    }
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/proposals/${params.id}/lines/${lineId}/confirm`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function moveStage(toStage: string) {
    let reason: string | null = null
    if (toStage === 'Lost') {
      reason = window.prompt('Reason the proposal was lost?')
      if (!reason) return
    }
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/proposals/${params.id}/stage`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_stage: toStage, reason })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error) // this is where the A13 "not priced yet" message surfaces
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function saveVersion() {
    const note = window.prompt('Optional note for this version:') ?? ''
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`/api/proposals/${params.id}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note || null })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNotice(data.created ? `Saved v${data.version_number}: ${data.change_summary}` : `No changes since v${data.version_number} — nothing new to save.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  // A18 + A19 + A20 in one action: builds the brand-facing Excel, files it in Drive, and logs a share per line.
  async function exportProposal() {
    if (!window.confirm('Export the brand-facing Excel and log it as a share to this brand?')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`/api/proposals/${params.id}/export`, { method: 'POST' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      const blob = await res.blob()
      const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'proposal.xlsx'
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href)

      const driveStatus = res.headers.get('X-Export-Drive')
      const detail = decodeURIComponent(res.headers.get('X-Export-Drive-Detail') ?? '')
      setNotice(
        `Exported v${res.headers.get('X-Export-Version')} and logged ${res.headers.get('X-Export-Shares')} share(s). ` +
        (driveStatus === 'filed' ? 'Filed in Drive.' : `Not filed in Drive: ${detail}`)
      )
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  // A25: ask for a Manager/CEO to approve sending despite the conflicts (a Manager/CEO's own request is approved immediately).
  async function requestOverride() {
    const reason = window.prompt('Why is it OK to send this despite the conflict? (required — a Manager/CEO reviews it)')
    if (!reason?.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`/api/proposals/${params.id}/share-overrides`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNotice(data.auto_approved ? 'Override approved — you can now export.' : 'Override requested. A Manager/CEO needs to approve it on the Approvals page before you can export.')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  // A16: save a negotiated vendor cost back as a price record; Manager/CEO may also apply it to the line.
  async function recordNegotiated(lineId: string) {
    const amount = window.prompt('Negotiated cost from the vendor (per unit, in the proposal currency):')
    if (!amount) return
    const reusable = window.confirm('Will the vendor extend this rate to other brands?\n\nOK = yes (reusable)   Cancel = this brand only')
    const apply = canSetMargin ? window.confirm('Apply this cost to this line now?\n\nThis changes the brand-facing price.') : false
    setBusy(true); setError(''); setNotice('')
    try {
      const res = await fetch(`/api/proposals/${params.id}/lines/${lineId}/negotiated-price`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount), reusable, apply_to_line: apply })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNotice(`Negotiated cost saved${data.reusable ? ' (reusable for other brands)' : ' (this brand only)'}${data.applied ? ' and applied to the line' : ''}.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  if (!proposal) return <div className="text-muted">Loading…</div>

  const canSetMargin = role === 'manager' || role === 'ceo' || role === 'management'
  const canOverride = role === 'ceo' || role === 'management'
  const canChangeStage = role === 'team' || canSetMargin
  const canExport = ['Approved', 'Sent', 'Negotiating'].includes(proposal.stage)

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">{proposal.brands?.name}</h1>
      <p className="text-muted text-sm mb-1">
        {proposal.routes ? `${proposal.routes.route_type.replace(/_/g, ' ')}${proposal.routes.agents ? ' via ' + proposal.routes.agents.name : ''}` : 'Direct'}
      </p>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-muted">Stage:</span>
        {canChangeStage ? (
          <select value={proposal.stage} onChange={(e) => moveStage(e.target.value)} disabled={busy} className="bg-panel2 border border-line rounded px-2 py-1 text-sm">
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : <span className="text-sm">{proposal.stage}</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={saveVersion} disabled={busy} className="border border-line text-xs px-3 py-1.5 rounded disabled:opacity-40">Save version</button>
          <button
            onClick={exportProposal} disabled={busy || !canExport}
            title={canExport ? 'Builds the brand-facing Excel, files it in Drive, and logs a share' : 'A proposal must be Approved before it can be exported'}
            className="bg-amber text-black font-semibold text-xs px-3 py-1.5 rounded disabled:opacity-40"
          >
            Export &amp; log share
          </button>
        </div>
      </div>

      {!proposal.can_view_margin && (
        <p className="text-xs text-amber mb-4">Margin details are restricted to Manager/CEO — you're seeing brand-facing prices only.</p>
      )}
      {proposal.brief && <p className="text-sm text-muted mb-5">{proposal.brief}</p>}
      {error && <div className="bg-[#211510] border border-[#4d321b] text-amber rounded-md p-3 text-sm mb-4">{error}</div>}
      {notice && <div className="bg-[#131b26] border border-[#263a52] text-blue-400 rounded-md p-3 text-sm mb-4">{notice}</div>}

      {shared.length > 0 && (
        <div className="bg-panel border border-line rounded-xl p-4 mb-4">
          <button onClick={() => setShowShared((v) => !v)} className="text-sm w-full text-left flex justify-between">
            <span>Already shared with <b>{proposal.brands?.name}</b> <span className="text-muted">({shared.length} share{shared.length === 1 ? '' : 's'}, any route)</span></span>
            <span className="text-muted">{showShared ? '▲' : '▼'}</span>
          </button>
          {showShared && (
            <div className="mt-3 text-xs">
              {shared.map((s) => (
                <div key={s.share_id} className="flex justify-between py-1.5 border-b border-line last:border-0">
                  <span>{s.item}{s.property ? <span className="text-muted"> · {s.property}</span> : null}</span>
                  <span className="text-muted font-mono">{s.route} · {new Date(s.at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {conflicts.some((c) => c.conflicts.length > 0) && (
        <div className="bg-[#211510] border border-[#4d321b] rounded-xl p-4 mb-4">
          <div className="text-amber text-sm font-semibold mb-2">⚠ Sending this would conflict with earlier shares</div>
          {conflicts.filter((c) => c.conflicts.length > 0).map((c) => (
            <div key={c.line_id} className="mb-2 text-sm">
              <div className="font-medium">{c.item_name}</div>
              {c.conflicts.map((x, i) => <div key={i} className="text-xs text-muted ml-3">• {x.detail}</div>)}
              <div className="text-xs ml-3 mt-0.5">
                {c.override === 'none' && <span className="text-amber">No override yet — export is blocked for this line.</span>}
                {c.override === 'pending' && <span className="text-blue-400">Override requested — waiting for a Manager/CEO.</span>}
                {c.override === 'approved' && <span className="text-green-400">Override approved — this line can be sent (once).</span>}
                {c.override === 'rejected' && <span className="text-red-400">Override was rejected.</span>}
              </div>
            </div>
          ))}
          {conflicts.some((c) => c.conflicts.length > 0 && (c.override === 'none' || c.override === 'rejected')) && (
            <button onClick={requestOverride} disabled={busy} className="mt-2 border border-line text-xs px-3 py-1.5 rounded disabled:opacity-40">Request override…</button>
          )}
        </div>
      )}

      <div className="bg-panel border border-line rounded-xl overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase">
            <tr className="border-b border-line">
              <th className="text-left p-3">Item</th><th className="text-left p-3">Qty</th><th className="text-left p-3">Mechanic</th><th className="text-left p-3">Brand-facing price</th>
              {proposal.can_view_margin && <>
                <th className="text-left p-3">Cost</th><th className="text-left p-3">Rate</th><th className="text-left p-3">Agent cut</th><th className="text-left p-3">Net margin</th>
              </>}
              <th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {proposal.lines.map((l) => (
              <>
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="p-3">{l.items?.name}</td>
                  <td className="p-3">{l.quantity}</td>
                  <td className="p-3 text-xs text-muted">{l.pricing_mechanic}</td>
                  <td className="p-3 font-mono text-amber">{proposal.currency} {Number(l.sell_price).toLocaleString()}</td>
                  {proposal.can_view_margin && l.pricing && (
                    <>
                      <td className="p-3 font-mono">{Number(l.pricing.cost_used).toLocaleString()}</td>
                      <td className="p-3">
                        {canSetMargin ? (
                          <input
                            type="number" defaultValue={l.pricing.margin_pct}
                            onBlur={(e) => e.target.value !== String(l.pricing?.margin_pct) && setMargin(l.id, e.target.value)}
                            className="bg-panel2 border border-line rounded px-2 py-1 text-xs w-16 font-mono"
                          />
                        ) : <span className="font-mono">{l.pricing.margin_pct}{l.pricing_mechanic === 'fee' ? '' : '%'}</span>}
                      </td>
                      <td className="p-3 font-mono">{Number(l.pricing.agent_cut_amount).toLocaleString()}</td>
                      <td className="p-3 font-mono">{Number(l.pricing.net_margin_pct).toFixed(1)}%</td>
                    </>
                  )}
                  <td className="p-3">
                    <div className="flex gap-1">
                      <button onClick={() => recordNegotiated(l.id)} disabled={busy} className="border border-line text-xs px-2 py-1 rounded disabled:opacity-40" title="Save a negotiated vendor cost back to the item's price history">Negotiated cost</button>
                      {canOverride && (
                        <>
                          <button onClick={() => confirmLine(l.id, false)} disabled={busy} className="bg-amber text-black text-xs font-semibold px-2 py-1 rounded disabled:opacity-40">Confirm</button>
                          <button onClick={() => confirmLine(l.id, true)} disabled={busy} className="border border-line text-xs px-2 py-1 rounded disabled:opacity-40">Override</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {(l.warnings && l.warnings.length > 0) && (
                  <tr key={l.id + '-warn'}>
                    <td colSpan={9} className="px-3 pb-2 -mt-1">
                      {l.warnings.map((w, i) => <span key={i} className="inline-block text-xs bg-[#1f1810] text-amber border border-[#4a3a1e] rounded-full px-2 py-0.5 mr-1.5">{w}</span>)}
                    </td>
                  </tr>
                )}
                {(l.other_brand_prices && l.other_brand_prices.length > 0) && (
                  <tr key={l.id + '-other'}>
                    <td colSpan={9} className="px-3 pb-2 text-xs text-blue-400">
                      Also quoted to: {l.other_brand_prices.map((o) => `${o.brand} (${o.sell_price.toLocaleString()})`).join(', ')}
                    </td>
                  </tr>
                )}
              </>
            ))}
            {proposal.lines.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-muted">No lines yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <AddFromShortlist proposalId={params.id} onDone={load} />
      <PastProjects proposalId={params.id} refreshKey={proposal.lines.length} />
      <div className="bg-panel border border-line rounded-xl p-4">
        <div className="text-xs text-muted uppercase mb-2">Add item</div>
        <div className="flex gap-2">
          <select value={selectedItem} onChange={(e) => setSelectedItem(e.target.value)} className="bg-panel2 border border-line rounded-md px-2 py-2 text-sm flex-1">
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="bg-panel2 border border-line rounded-md px-2 py-2 text-sm w-20" />
          <select value={mechanic} onChange={(e) => setMechanic(e.target.value)} className="bg-panel2 border border-line rounded-md px-2 py-2 text-sm">
            {MECHANICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button onClick={addLine} disabled={busy || !selectedItem} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Add</button>
        </div>
      </div>

      <div className="bg-panel border border-line rounded-xl p-4 mt-4">
        <div className="text-xs text-muted uppercase mb-2">Versions</div>
        {versions.length === 0 && <div className="text-sm text-muted">No versions yet — one is saved automatically on the first export, or use “Save version”.</div>}
        {versions.map((v) => (
          <div key={v.id} className="flex gap-3 py-2 border-b border-line last:border-0 text-sm">
            <div className="font-mono text-amber w-10">v{v.version_number}</div>
            <div className="flex-1">
              <div>{v.change_summary || '—'}</div>
              {v.note && <div className="text-xs text-muted">Note: {v.note}</div>}
            </div>
            <div className="text-right">
              {v.total != null && <div className="font-mono text-xs">{v.currency} {Number(v.total).toLocaleString()}</div>}
              <div className="text-xs text-muted font-mono">{new Date(v.created_at).toLocaleDateString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
