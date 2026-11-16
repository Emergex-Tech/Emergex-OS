'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import ReportView from '@/components/ReportView'
import type { Report } from '@/lib/reportBuilder'

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The page a BRAND opens from a link — no login. Self-contained: no third-party scripts, fonts, images or analytics, so nothing
 * here can send the (secret) address of this page anywhere else. Everything it shows comes from /api/public/report/<token>.
 */
export default function PublicReportPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<any>(null); const [gone, setGone] = useState(false); const [snap, setSnap] = useState<string>('')
  useEffect(() => {
    let live = true; setData(null)
    fetch(`/api/public/report/${encodeURIComponent(token)}${snap ? `?snapshot=${encodeURIComponent(snap)}` : ''}`, { cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(async (r) => { if (!live) return; if (!r.ok) { setGone(true); return } setGone(false); setData(await r.json()) }).catch(() => live && setGone(true))
    return () => { live = false }
  }, [token, snap])
  const base = `/api/public/report/${encodeURIComponent(token)}`
  if (gone) return <main className="max-w-xl mx-auto p-10 text-center"><div className="text-xl font-semibold mb-2">This link is not valid or has expired</div><p className="text-sm text-muted">If you were expecting a report, ask your EmergeX contact for a new link.</p></main>
  if (!data) return <main className="max-w-xl mx-auto p-10 text-center text-muted">Loading…</main>
  const report = data.report as Report
  return (<main className="max-w-4xl mx-auto p-6">
    <div className="flex flex-wrap gap-3 items-center justify-between mb-5 text-sm">
      <div className="text-muted">{data.snapshot ? <>Viewing the report as saved on <b className="text-white">{data.snapshot.taken_on}</b>. <button className="underline" onClick={() => setSnap('')}>Back to the latest</button></> : 'Latest report'}</div>
      <div className="flex gap-3 items-center">
        {data.snapshots.length > 0 && <select className="bg-panel2 border border-line rounded-md px-2 py-1.5" value={snap} onChange={(e) => setSnap(e.target.value)}><option value="">Earlier reports…</option>{data.snapshots.map((s: any) => <option key={s.id} value={s.id}>{s.taken_on}{s.trigger === 'closing' ? ' (final)' : ''}</option>)}</select>}
        <a href={`${base}/pdf${snap ? `?snapshot=${encodeURIComponent(snap)}` : ''}`} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md">Download PDF</a>
      </div>
    </div>
    <ReportView report={report} proofHref={(id) => `${base}/proof/${encodeURIComponent(id)}`} />
    <p className="text-xs text-muted mt-8">This is a private, read-only link. It expires on {new Date(data.expires_at).toLocaleDateString()}.</p>
  </main>)
}
