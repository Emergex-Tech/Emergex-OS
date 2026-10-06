'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface P { id: string; name: string; brand_name: string; template_key: string; owner_name: string | null; parent_project_id: string | null; checklist_pct: number | null; gate: 'cleared' | 'open'; delivery: { pct: number | null; counted: number }; waiting_on_us: number; waiting_on_them: number }

export default function Projects() {
  const [rows, setRows] = useState<P[]>([]); const [loading, setLoading] = useState(true); const [missing, setMissing] = useState(0); const [role, setRole] = useState<string | null>(null)
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  async function load() { const [p, m] = await Promise.all([fetch('/api/projects').then((r) => (r.ok ? r.json() : [])), fetch('/api/projects/backfill').then((r) => (r.ok ? r.json() : { missing: 0 }))]); setRows(p); setMissing(m.missing); setLoading(false) }
  useEffect(() => {
    load(); const sb = supabaseBrowser()
    sb.auth.getSession().then(async ({ data }) => { if (data.session) { const { data: p } = await sb.from('profiles').select('role_key').eq('id', data.session.user.id).single(); setRole(p?.role_key ?? null) } })
  }, [])
  const canManage = ['manager', 'ceo', 'management'].includes(role ?? '')
  async function backfill() { setBusy(true); setMsg(''); const r = await fetch('/api/projects/backfill', { method: 'POST' }); const d = await r.json(); setMsg(r.ok ? `Created ${d.created}${d.failed.length ? `, ${d.failed.length} failed: ${d.failed[0].error}` : ''}.` : d.error); setBusy(false); load() }
  if (loading) return <div className="text-muted">Loading…</div>
  const pct = (n: number | null) => (n == null ? <span className="text-muted">—</span> : <span className="font-mono">{n}%</span>)
  return (
    <div>
      <div className="flex justify-between items-baseline mb-4"><h1 className="text-lg font-semibold">Projects</h1>{canManage && <Link href="/project-templates" className="text-xs underline text-muted">Checklist templates</Link>}</div>
      {missing > 0 && (
        <div className="bg-[#211510] border border-[#4d321b] rounded-xl p-4 mb-4 flex justify-between items-center">
          <span className="text-sm text-amber">{missing} won deal{missing === 1 ? '' : 's'} {missing === 1 ? 'has' : 'have'} no project yet (won before projects existed, or creation failed).</span>
          {canManage ? <button onClick={backfill} disabled={busy} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm disabled:opacity-40">{busy ? 'Creating…' : 'Create them'}</button> : <span className="text-xs text-muted">Ask a Manager or CEO</span>}
        </div>
      )}
      {msg && <div className="text-green-400 text-sm mb-3">{msg}</div>}
      <div className="bg-panel border border-line rounded-xl overflow-hidden"><table className="w-full text-sm">
        <thead className="text-xs text-muted uppercase"><tr className="border-b border-line"><th className="text-left p-3">Project</th><th className="text-left p-3">Owner</th><th className="text-left p-3">Paperwork gate</th><th className="text-right p-3">Checklist</th><th className="text-right p-3">Delivery</th><th className="text-left p-3">Waiting</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-line last:border-0">
              <td className="p-3"><Link href={`/projects/${p.id}`} className="text-blue-400 underline">{p.name}</Link><div className="text-xs text-muted">{p.brand_name} · {p.template_key}{p.parent_project_id ? ' · upsell' : ''}</div></td>
              <td className="p-3 text-xs">{p.owner_name ?? '—'}</td>
              <td className="p-3 text-xs">{p.gate === 'cleared' ? <span className="text-green-400">Cleared</span> : <span className="text-amber">Open</span>}</td>
              <td className="p-3 text-right">{pct(p.checklist_pct)}</td><td className="p-3 text-right">{pct(p.delivery.pct)}</td>
              <td className="p-3 text-xs">{p.waiting_on_us > 0 && <span className="text-red-400">{p.waiting_on_us} on us</span>}{p.waiting_on_us > 0 && p.waiting_on_them > 0 && ' · '}{p.waiting_on_them > 0 && <span className="text-muted">{p.waiting_on_them} on them</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">No projects yet — one is created automatically when a proposal is marked Won.</td></tr>}
        </tbody></table></div>
    </div>
  )
}
