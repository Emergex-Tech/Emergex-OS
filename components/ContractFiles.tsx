'use client'
import { useEffect, useState } from 'react'

interface F { id: string; doc_title: string; version: number; is_current: boolean; name: string; size_bytes: number | null; version_note: string | null; created_at: string; uploaded_by: string | null }

/** B3: documents on a contract, versioned. Manager/CEO only (the API enforces it). Bytes go through our server to Drive and back — nobody needs Drive access. */
export default function ContractFiles({ contractId }: { contractId: string }) {
  const [files, setFiles] = useState<F[]>([]); const [title, setTitle] = useState('Contract'); const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  async function load() { const r = await fetch(`/api/contracts/${contractId}/files`); setFiles(r.ok ? await r.json() : []) }
  useEffect(() => { load() }, [contractId])

  async function upload() {
    if (!file) return
    setBusy(true); setError(''); setNotice('')
    try {
      const f = new FormData(); f.append('file', file); f.append('title', title); f.append('note', note)
      const res = await fetch(`/api/contracts/${contractId}/files`, { method: 'POST', body: f }); const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNotice(data.duplicate ? data.message : `Saved as v${data.version}.`); setFile(null); setNote(''); await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  async function download(f: F) {
    const res = await fetch(`/api/contracts/${contractId}/files/${f.id}`); if (!res.ok) { setError((await res.json()).error); return }
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = f.name; a.click(); URL.revokeObjectURL(a.href)
  }
  async function makeCurrent(f: F) { const res = await fetch(`/api/contracts/${contractId}/files/${f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'make_current' }) }); if (!res.ok) setError((await res.json()).error); else load() }

  const titles = Array.from(new Set(files.map((f) => f.doc_title)))
  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-muted uppercase mb-2">Documents</h2>
      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}{notice && <div className="text-green-400 text-sm mb-2">{notice}</div>}
      <div className="bg-panel border border-line rounded-xl p-4 mb-4">
        <div className="flex gap-2 mb-2"><input value={title} onChange={(e) => setTitle(e.target.value)} list="doc-titles" placeholder="Document (e.g. Contract, Amendment)" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-64" /><datalist id="doc-titles">{titles.map((t) => <option key={t} value={t} />)}</datalist>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note about this version (optional)" className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm flex-1" /></div>
        <div className="flex gap-2 items-center"><input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm flex-1" />
          <button onClick={upload} disabled={busy || !file} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">{busy ? 'Uploading…' : 'Upload'}</button></div>
        <p className="text-xs text-muted mt-2">PDF, Word, Excel or image, up to 4 MB. Uploading the same title again adds a new version; identical content is ignored. If Google Drive is unavailable the upload is refused rather than half-saved.</p>
      </div>
      {titles.map((t) => (
        <div key={t} className="bg-panel border border-line rounded-xl overflow-hidden mb-3"><div className="px-3 py-2 text-xs font-mono text-muted uppercase border-b border-line">{t}</div><table className="w-full text-sm"><tbody>
          {files.filter((f) => f.doc_title === t).map((f) => (<tr key={f.id} className="border-b border-line last:border-0"><td className="p-3 font-mono">v{f.version}{f.is_current && <span className="ml-2 text-xs text-green-400">current</span>}</td><td className="p-3">{f.name}<div className="text-xs text-muted">{f.version_note}</div></td><td className="p-3 text-xs text-muted">{f.uploaded_by} · {new Date(f.created_at).toLocaleDateString()}{f.size_bytes ? ` · ${Math.round(f.size_bytes / 1024)} KB` : ''}</td><td className="p-3 text-xs text-right"><button onClick={() => download(f)} className="underline text-muted mr-3">Download</button>{!f.is_current && <button onClick={() => makeCurrent(f)} className="underline text-muted">Make current</button>}</td></tr>))}
        </tbody></table></div>))}
      {files.length === 0 && <div className="text-sm text-muted">No documents yet.</div>}
    </div>
  )
}
