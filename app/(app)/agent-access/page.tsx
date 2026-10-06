'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface AgentCo { id: string; name: string; users: { id: string; full_name: string; email: string; disabled: boolean }[]; active_grants: number }
interface Grant { id: string; display_title: string | null; indicative_price: number | null; price_currency: string | null; items: { name: string; availability: string; properties: { name: string } | null } | null }
interface Act { id: string; action: string; created_at: string; items: { name: string } | null; profiles: { full_name: string } | null }
interface Intel { id: string; note: string; created_at: string; claimed_price: number | null; claimed_currency: string | null; item_name: string | null; agents: { name: string } | null }
interface ItemOpt { id: string; name: string; properties: { name: string } | null }

export default function AgentAccess() {
  const [agents, setAgents] = useState<AgentCo[]>([]); const [portal, setPortal] = useState(false)
  const [agentId, setAgentId] = useState(''); const [tab, setTab] = useState<'grants' | 'activity' | 'intel'>('grants')
  const [grants, setGrants] = useState<Grant[]>([]); const [activity, setActivity] = useState<Act[]>([]); const [intel, setIntel] = useState<Intel[]>([])
  const [items, setItems] = useState<ItemOpt[]>([]); const [picked, setPicked] = useState<string[]>([]); const [filter, setFilter] = useState('')
  const [title, setTitle] = useState(''); const [price, setPrice] = useState('')
  const [forbidden, setForbidden] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')

  async function loadAgents() {
    const r = await fetch('/api/agent-access/agents'); if (r.status === 403) { setForbidden(true); return }
    const d = await r.json(); setAgents(d.agents); setPortal(d.portal_enabled); if (!agentId && d.agents[0]) setAgentId(d.agents[0].id)
  }
  async function loadTab() {
    if (tab === 'intel') { const r = await fetch('/api/agent-access/intel'); setIntel(r.ok ? await r.json() : []); return }
    if (!agentId) return
    if (tab === 'grants') { const r = await fetch(`/api/agent-access/grants?agent_id=${agentId}`); setGrants(r.ok ? await r.json() : []) }
    else { const r = await fetch(`/api/agent-access/activity?agent_id=${agentId}`); setActivity(r.ok ? await r.json() : []) }
  }
  useEffect(() => { loadAgents(); supabaseBrowser().from('items').select('id, name, properties(name)').order('name').then(({ data }) => setItems((data as unknown as ItemOpt[]) ?? [])) }, [])
  useEffect(() => { loadTab() }, [tab, agentId])

  async function call(url: string, method: string, body?: unknown, done?: string) {
    setError(''); setNotice('')
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await res.json().catch(() => ({})); if (!res.ok) { setError(data.error ?? 'Failed'); return false }
    if (done) setNotice(done); await loadAgents(); await loadTab(); return true
  }
  const share = async () => { if (await call('/api/agent-access/grants', 'POST', { agent_id: agentId, item_ids: picked, display_title: title || undefined, indicative_price: price || undefined }, 'Shared.')) { setPicked([]); setTitle(''); setPrice('') } }
  const revoke = (id: string) => window.confirm('Stop sharing this item? The agent loses access immediately.') && call(`/api/agent-access/grants/${id}`, 'DELETE', undefined, 'Revoked.')
  const edit = (g: Grant) => { const t = window.prompt('White-label title shown to the agent (blank = real names):', g.display_title ?? ''); if (t === null) return; const p = window.prompt('Indicative price shown to the agent (blank = none):', g.indicative_price?.toString() ?? ''); if (p === null) return; call(`/api/agent-access/grants/${g.id}`, 'PATCH', { display_title: t, indicative_price: p === '' ? null : Number(p) }, 'Saved.') }
  const review = (id: string, decision: 'accept' | 'reject') => {
    let reliability: string | undefined
    if (decision === 'accept') { reliability = window.prompt('How reliable? Type: confirmed, likely or rumour', 'likely') ?? undefined; if (!reliability) return }
    call(`/api/agent-access/intel/${id}/review`, 'POST', { decision, reliability }, decision === 'accept' ? 'Accepted.' : 'Declined.')
  }

  if (forbidden) return <div className="text-muted">Agent access is managed by Manager and CEO.</div>
  const agent = agents.find((a) => a.id === agentId)
  const shown = items.filter((i) => `${i.name} ${i.properties?.name ?? ''}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 60)

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">Agent access</h1>
      <p className={`text-xs mb-4 ${portal ? 'text-green-400' : 'text-amber'}`}>{portal ? 'The agent portal is released.' : 'The agent portal is NOT released (AGENT_ACCESS_ENABLED is off). You can prepare accounts and shares, but agents cannot use it yet — enable it only after your security review.'}</p>
      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}{notice && <div className="text-green-400 text-sm mb-3">{notice}</div>}
      <div className="flex gap-2 mb-4 items-center">
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm">{agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.active_grants} shared)</option>)}</select>
        {(['grants', 'activity', 'intel'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded text-sm ${tab === t ? 'bg-amber text-black font-semibold' : 'border border-line text-muted'}`}>{t === 'grants' ? 'Shared items' : t === 'activity' ? 'Activity log' : 'Intel to review'}</button>)}
      </div>
      {tab !== 'intel' && agent && <p className="text-xs text-muted mb-3">Logins: {agent.users.length ? agent.users.map((u) => `${u.full_name} (${u.email})${u.disabled ? ' — disabled' : ''}`).join(', ') : 'none yet — create one on the Users page with the Agent role.'}</p>}

      {tab === 'grants' && (<>
        <div className="bg-panel border border-line rounded-xl p-4 mb-4">
          <div className="text-xs text-muted uppercase mb-2">Share items with {agent?.name}</div>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search items…" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full mb-2" />
          <div className="max-h-44 overflow-y-auto border border-line rounded-md mb-2">{shown.map((i) => (<label key={i.id} className="flex gap-2 px-3 py-1.5 text-sm border-b border-line last:border-0"><input type="checkbox" checked={picked.includes(i.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id))} />{i.name} <span className="text-muted text-xs">{i.properties?.name}</span></label>))}</div>
          <div className="flex gap-2"><input value={title} onChange={(e) => setTitle(e.target.value)} disabled={picked.length !== 1} placeholder="White-label title (one item only)" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1 disabled:opacity-40" />
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} disabled={picked.length !== 1} placeholder="Indicative price" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-40 disabled:opacity-40" />
            <button onClick={share} disabled={!picked.length} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">Share {picked.length || ''}</button></div>
          <p className="text-xs text-muted mt-2">The agent never sees the vendor, cost, margin or price history. Names are shown as typed, so set a white-label title if an item&apos;s real name identifies its source. A price is shown only if you type one here.</p>
        </div>
        <div className="bg-panel border border-line rounded-xl overflow-hidden"><table className="w-full text-sm"><tbody>
          {grants.map((g) => (<tr key={g.id} className="border-b border-line last:border-0"><td className="p-3">{g.items?.properties?.name} — {g.items?.name}{g.display_title && <div className="text-xs text-amber">Shown as: {g.display_title}</div>}</td><td className="p-3 font-mono text-xs">{g.indicative_price != null ? `${g.price_currency} ${g.indicative_price.toLocaleString()}` : 'no price shown'}</td><td className="p-3 text-xs text-right"><button onClick={() => edit(g)} className="underline text-muted mr-3">Edit</button><button onClick={() => revoke(g.id)} className="underline text-red-400">Revoke</button></td></tr>))}
          {grants.length === 0 && <tr><td className="p-6 text-center text-muted">Nothing is shared with this agent.</td></tr>}
        </tbody></table></div></>)}

      {tab === 'activity' && <div className="bg-panel border border-line rounded-xl overflow-hidden"><table className="w-full text-sm"><tbody>
        {activity.map((a) => (<tr key={a.id} className="border-b border-line last:border-0"><td className="p-3 font-mono text-xs text-muted">{new Date(a.created_at).toLocaleString()}</td><td className="p-3">{a.profiles?.full_name}</td><td className="p-3">{a.action.replace(/_/g, ' ')}</td><td className="p-3 text-muted">{a.items?.name}</td></tr>))}
        {activity.length === 0 && <tr><td className="p-6 text-center text-muted">No activity yet.</td></tr>}</tbody></table></div>}

      {tab === 'intel' && <div className="bg-panel border border-line rounded-xl overflow-hidden"><table className="w-full text-sm"><tbody>
        {intel.map((n) => (<tr key={n.id} className="border-b border-line last:border-0 align-top"><td className="p-3 text-xs text-muted">{n.agents?.name}<div className="font-mono">{new Date(n.created_at).toLocaleDateString()}</div></td><td className="p-3">{n.note}{n.item_name && <div className="text-xs text-muted">About: {n.item_name}</div>}{n.claimed_price != null && <div className="text-xs text-amber">Claims a price of {n.claimed_currency} {n.claimed_price.toLocaleString()} — only recorded if you accept</div>}</td><td className="p-3 text-right text-xs"><button onClick={() => review(n.id, 'accept')} className="bg-amber text-black font-semibold px-3 py-1 rounded mr-2">Accept</button><button onClick={() => review(n.id, 'reject')} className="border border-line px-3 py-1 rounded">Decline</button></td></tr>))}
        {intel.length === 0 && <tr><td className="p-6 text-center text-muted">Nothing waiting for review.</td></tr>}</tbody></table></div>}
    </div>
  )
}
