'use client'
import { useEffect, useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** L25: relevant approved case studies for the pitch being built. ANONYMISED unless the brand agreed to being named (D16). */
export default function PastProjects({ proposalId, refreshKey }: { proposalId: string; refreshKey?: number }) {
  const [data, setData] = useState<any>(null); const [open, setOpen] = useState<string | null>(null); const [named, setNamed] = useState<Record<string, boolean>>({})
  useEffect(() => { fetch(`/api/case-studies/suggest?proposal_id=${proposalId}`).then((r) => (r.ok ? r.json() : null)).then(setData) }, [proposalId, refreshKey])
  if (!data) return null
  return (<div className="bg-panel border border-line rounded-xl p-3 mt-6 text-sm">
    <div className="text-xs font-mono text-muted uppercase mb-2">Relevant past projects</div>
    {data.suggestions.length === 0 ? <p className="text-muted">{data.query.categories.length === 0 ? 'Add items to this proposal and relevant approved case studies will appear here.' : 'No approved case study matches this pitch yet.'}</p> : (
      <ul>{data.suggestions.map((s: any) => { const showNamed = named[s.id] && s.named; const t = showNamed ? s.named : { title: s.title, text: s.text }
        return (<li key={s.id} className="border-b border-line last:border-0 py-2">
          <div className="flex justify-between gap-3"><button className="text-left font-semibold underline" onClick={() => setOpen(open === s.id ? null : s.id)}>{t.title}</button><span className="text-xs text-muted whitespace-nowrap">{s.reasons.join(' · ')}</span></div>
          <div className="text-xs text-muted">{s.delivery_pct != null ? `${s.delivery_pct}% delivered · ` : ''}{s.results.slice(0, 3).map((r: any) => `${r.label} ${Number(r.value).toLocaleString()}${r.unit === '%' ? '%' : ''}`).join(' · ')}</div>
          {open === s.id && <pre className="whitespace-pre-wrap font-sans mt-2 bg-panel2 rounded p-2">{t.text}</pre>}
          {s.named && <label className="text-xs text-muted flex gap-1 mt-1"><input type="checkbox" checked={!!named[s.id]} onChange={(e) => setNamed({ ...named, [s.id]: e.target.checked })} />show the named version (the brand agreed to this)</label>}
        </li>) })}</ul>)}
    <p className="text-xs text-muted mt-2">Shown anonymised by default. Past work for this brand itself is never suggested.</p>
  </div>)
}
