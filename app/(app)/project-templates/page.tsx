'use client'
import { useEffect, useState } from 'react'

interface TItem { id: string; phase_no: number; phase_name: string; side: 'brand' | 'team'; title: string; auto_rule: string | null; position: number; active: boolean }
interface MDef { category_key: string; key: string; label: string; unit: string | null; aggregation: 'sum' | 'avg'; position: number; active: boolean }
interface Tpl { key: string; name: string; description: string | null; items: TItem[] }
const RULES = [['', 'No automatic tick'], ['contract_exists', 'Contract created'], ['contract_file_uploaded', 'Contract file uploaded'], ['billing_schedule_created', 'Billing schedule created'], ['first_invoice_issued', 'First invoice issued'], ['first_invoice_paid', 'First invoice paid'], ['all_invoices_paid', 'All invoices paid']]

export default function ProjectTemplates() {
  const [tpls, setTpls] = useState<Tpl[]>([]); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [add, setAdd] = useState<Record<string, { phase_no: string; phase_name: string; side: string; title: string; auto_rule: string }>>({})
  const [defs, setDefs] = useState<MDef[]>([]); const [mnew, setMnew] = useState({ category_key: '', key: '', label: '', unit: '', aggregation: 'sum' })
  const loadDefs = () => fetch('/api/metric-definitions').then((r) => (r.ok ? r.json() : [])).then(setDefs)
  const load = () => { fetch('/api/checklist-templates').then((r) => (r.ok ? r.json() : [])).then(setTpls); loadDefs() }
  useEffect(() => { load() }, [])
  const call = async (url: string, method: string, body: unknown, done: string) => { setError(''); setNotice(''); const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) { setError(d.error); return false } setNotice(done); load(); return true }
  const f = (k: string) => add[k] ?? { phase_no: '1', phase_name: '', side: 'team', title: '', auto_rule: '' }
  const inp = 'bg-panel2 border border-line rounded-md px-2 py-1.5 text-sm'
  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">Checklist templates</h1>
      <p className="text-xs text-muted mb-4">Changes apply to projects created <b>from now on</b>. A live project keeps the checklist it was given. Retire a step rather than deleting it.</p>
      {error && <div className="text-red-400 text-sm mb-3">{error}</div>}{notice && <div className="text-green-400 text-sm mb-3">{notice}</div>}
      <h2 className="text-lg font-semibold mt-2 mb-1">Metric sets</h2>
      <p className="text-xs text-amber mb-3">DRAFT — a starting set per category. Counts are added across deliverables; rates are averaged. Retiring a metric stops new entries but keeps what was recorded.</p>
      {Array.from(new Set(defs.map((d) => d.category_key))).map((c) => (
        <div key={c} className="bg-panel border border-line rounded-xl mb-2 px-3 py-2 text-sm"><span className="text-xs font-mono text-muted uppercase mr-3">{c.replace(/_/g, ' ')}</span>
          {defs.filter((d) => d.category_key === c).map((d) => (<span key={d.key} className={`inline-block mr-3 ${d.active ? '' : 'opacity-40 line-through'}`}>{d.label}{d.unit ? ` (${d.unit})` : ''}<span className="text-[10px] text-muted"> {d.aggregation === 'avg' ? 'avg' : 'sum'}</span>{' '}
            <button className="text-[10px] underline text-muted" onClick={() => call(`/api/metric-definitions/${d.category_key}/${d.key}`, 'PATCH', { active: !d.active }, d.active ? 'Retired.' : 'Restored.')}>{d.active ? 'retire' : 'restore'}</button></span>))}</div>))}
      <div className="flex gap-2 items-center flex-wrap mb-8 mt-2">
        <input className={`${inp} w-44`} placeholder="Category key (e.g. ooh_led)" value={mnew.category_key} onChange={(e) => setMnew({ ...mnew, category_key: e.target.value })} />
        <input className={`${inp} w-36`} placeholder="key" value={mnew.key} onChange={(e) => setMnew({ ...mnew, key: e.target.value })} /><input className={`${inp} flex-1 min-w-[160px]`} placeholder="Label" value={mnew.label} onChange={(e) => setMnew({ ...mnew, label: e.target.value })} />
        <input className={`${inp} w-20`} placeholder="unit" value={mnew.unit} onChange={(e) => setMnew({ ...mnew, unit: e.target.value })} /><select className={inp} value={mnew.aggregation} onChange={(e) => setMnew({ ...mnew, aggregation: e.target.value })}><option value="sum">add up (counts)</option><option value="avg">average (rates)</option></select>
        <button onClick={async () => { if (await call('/api/metric-definitions', 'POST', { ...mnew, unit: mnew.unit || undefined }, 'Metric added.')) setMnew({ ...mnew, key: '', label: '', unit: '' }) }} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm">Add metric</button></div>

      <h2 className="text-lg font-semibold mb-2">Checklist templates</h2>
      {tpls.map((t) => {
        const phases = Array.from(new Set(t.items.map((i) => i.phase_no))).sort((a, b) => a - b)
        return (
          <div key={t.key} className="mb-8">
            <h2 className="text-sm font-semibold mb-1">{t.name} template</h2>
            {t.description?.startsWith('DRAFT') && <p className="text-xs text-amber mb-2">{t.description}</p>}
            {phases.map((n) => (
              <div key={n} className="bg-panel border border-line rounded-xl overflow-hidden mb-3"><div className="px-3 py-2 text-xs font-mono text-muted uppercase border-b border-line">{String(n).padStart(2, '0')} {t.items.find((i) => i.phase_no === n)?.phase_name}</div>
                <table className="w-full text-sm"><tbody>
                  {t.items.filter((i) => i.phase_no === n).map((i) => (
                    <tr key={i.id} className={`border-b border-line last:border-0 ${i.active ? '' : 'opacity-40'}`}>
                      <td className="p-2 text-xs w-14"><span className={i.side === 'brand' ? 'text-blue-400' : 'text-green-400'}>{i.side}</span></td>
                      <td className="p-2">{i.title}{i.auto_rule && <span className="ml-2 text-xs text-muted">· ticks itself: {RULES.find((r) => r[0] === i.auto_rule)?.[1]}</span>}</td>
                      <td className="p-2 text-xs text-right"><button onClick={() => { const v = window.prompt('Step title:', i.title); if (v && v !== i.title) call(`/api/checklist-template-items/${i.id}`, 'PATCH', { title: v }, 'Saved.') }} className="underline text-muted mr-3">Rename</button>
                        <button onClick={() => call(`/api/checklist-template-items/${i.id}`, 'PATCH', { active: !i.active }, i.active ? 'Retired.' : 'Restored.')} className="underline text-muted">{i.active ? 'Retire' : 'Restore'}</button></td>
                    </tr>))}
                </tbody></table></div>
            ))}
            <div className="flex gap-2 items-center flex-wrap">
              <input className={`${inp} w-16`} placeholder="Phase" value={f(t.key).phase_no} onChange={(e) => setAdd({ ...add, [t.key]: { ...f(t.key), phase_no: e.target.value } })} />
              <input className={`${inp} w-44`} placeholder="Phase name (new phase only)" value={f(t.key).phase_name} onChange={(e) => setAdd({ ...add, [t.key]: { ...f(t.key), phase_name: e.target.value } })} />
              <select className={inp} value={f(t.key).side} onChange={(e) => setAdd({ ...add, [t.key]: { ...f(t.key), side: e.target.value } })}><option value="team">team side</option><option value="brand">brand side</option></select>
              <input className={`${inp} flex-1 min-w-[200px]`} placeholder="New step" value={f(t.key).title} onChange={(e) => setAdd({ ...add, [t.key]: { ...f(t.key), title: e.target.value } })} />
              <select className={inp} value={f(t.key).auto_rule} onChange={(e) => setAdd({ ...add, [t.key]: { ...f(t.key), auto_rule: e.target.value } })}>{RULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <button onClick={async () => { const x = f(t.key); if (await call(`/api/checklist-templates/${t.key}/items`, 'POST', { phase_no: Number(x.phase_no), phase_name: x.phase_name || undefined, side: x.side, title: x.title, auto_rule: x.auto_rule || null }, 'Step added.')) setAdd({ ...add, [t.key]: { ...x, title: '' } }) }} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-sm">Add step</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
