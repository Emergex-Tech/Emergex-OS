'use client'
import type { Report } from '@/lib/reportBuilder'

/* eslint-disable @next/next/no-img-element */
const STATUS: Record<string, string> = { planned: 'text-muted', partial: 'text-amber', delivered: 'text-green-400', missed: 'text-red-400', replaced: 'text-muted line-through' }
const isImage = (name: string) => /\.(png|jpe?g)$/i.test(name)
// A link proof is only ever opened if it is a plain https Google Drive / Docs link (the server checked this too — twice is cheap).
const safeLink = (u: string | null) => { try { const x = new URL(u ?? ''); return x.protocol === 'https:' && (x.hostname === 'drive.google.com' || x.hostname === 'docs.google.com') ? x.toString() : null } catch { return null } }
const num = (v: number) => (Math.round(v * 100) / 100).toLocaleString('en-US')

function Spark({ points }: { points: { date: string; value: number }[] }) {
  if (points.length < 2) return null
  const W = 220, H = 48, vs = points.map((p) => p.value), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1
  const xy = points.map((p, i) => `${(i / (points.length - 1)) * (W - 8) + 4},${H - 6 - ((p.value - lo) / span) * (H - 12)}`).join(' ')
  return <svg width={W} height={H} role="img" aria-label="trend"><polyline points={xy} fill="none" stroke="currentColor" strokeWidth="2" className="text-amber" /></svg>
}

/** The brand-facing report. Used by the PUBLIC page and by the staff "preview as the brand", so they can never differ. */
export default function ReportView({ report, proofHref }: { report: Report; proofHref: (proofId: string) => string }) {
  const b = report.branding, d = report.delivery
  const mark = b.mode === 'emergex' || !b.agent_name ? 'EmergeX' : b.mode === 'agent' ? b.agent_name : `EmergeX × ${b.agent_name}`
  return (<div>
    <div className="text-sm font-semibold text-amber mb-1">{mark}</div>
    <h1 className="text-2xl font-semibold">{report.title}</h1>
    <div className="text-sm text-muted mb-5">Prepared for {report.brand_name} · as of {report.as_of}</div>

    <div className="bg-panel border border-line rounded-xl p-4 mb-5">
      <div className="text-xs font-mono text-muted uppercase">Delivery</div>
      <div className="text-4xl font-semibold">{d.pct == null ? '—' : `${d.pct}%`}</div>
      <div className="text-sm text-muted">{d.counted} deliverable{d.counted === 1 ? '' : 's'}: {d.delivered} delivered · {d.partial} partly · {d.planned} planned · {d.missed} missed{d.replaced_excluded ? ` · ${d.replaced_excluded} replaced by a make-good (not counted)` : ''}</div>
    </div>

    <h2 className="text-xs font-mono text-muted uppercase mb-2">Deliverables</h2>
    <div className="bg-panel border border-line rounded-xl mb-5 divide-y divide-line">
      {report.deliverables.length === 0 && <div className="p-4 text-muted text-sm">Nothing to show yet.</div>}
      {report.deliverables.map((x) => (<div key={x.id} className="p-3">
        <div className="flex justify-between gap-3"><div className="font-semibold">{x.description}</div><div className={`text-sm ${STATUS[x.status] ?? ''}`}>{x.status === 'replaced' ? 'replaced by a make-good' : x.status}</div></div>
        <div className="text-xs text-muted">{x.status === 'replaced' ? '' : `${num(x.delivered)} of ${num(x.planned)}${x.unit ? ' ' + x.unit : ''} · ${x.pct}%`}{x.due_date ? ` · due ${x.due_date}` : ''}</div>
        {x.proofs.length > 0 && <div className="mt-2 flex flex-wrap gap-3">{x.proofs.map((p) => {
          const link = p.kind === 'link' ? safeLink(p.url) : null
          if (p.kind === 'link') return link ? <a key={p.id} href={link} target="_blank" rel="noopener noreferrer" className="text-sm underline text-blue-400">{p.name} ↗</a> : <span key={p.id} className="text-sm text-muted">{p.name}</span>
          return isImage(p.name) ? <a key={p.id} href={proofHref(p.id)} target="_blank" rel="noopener noreferrer" title={`${p.name} · ${p.added_on}`}><img src={proofHref(p.id)} alt={p.name} className="h-20 rounded border border-line" /></a>
            : <a key={p.id} href={proofHref(p.id)} className="text-sm underline text-blue-400">{p.name}</a>
        })}</div>}
      </div>))}
    </div>

    {report.metrics.summary.length > 0 && (<><h2 className="text-xs font-mono text-muted uppercase mb-2">Reach and engagement</h2>
      <div className="grid grid-cols-3 gap-3 mb-5">{report.metrics.summary.map((m) => { const s = report.metrics.series.find((x) => x.label === m.label); return (
        <div key={m.label} className="bg-panel border border-line rounded-xl p-3"><div className="text-xs font-mono text-muted uppercase">{m.label}</div><div className="text-2xl font-semibold">{num(m.value)}{m.unit === '%' ? '%' : ''}</div>
          <div className="text-xs text-muted">{m.aggregation === 'avg' ? 'average' : 'total'} · as of {m.as_of}</div>{s && <Spark points={s.points} />}</div>) })}</div></>)}

    {report.timeline.length > 0 && (<><h2 className="text-xs font-mono text-muted uppercase mb-2">Timeline</h2>
      <ul className="bg-panel border border-line rounded-xl p-3 text-sm space-y-1">{report.timeline.map((e, i) => <li key={i}><span className="font-mono text-xs text-muted mr-3">{e.date}</span>{e.text}</li>)}</ul></>)}
  </div>)
}
