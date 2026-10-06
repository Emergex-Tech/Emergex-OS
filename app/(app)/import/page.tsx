'use client'
import { useMemo, useState } from 'react'
import Papa from 'papaparse'

type Mode = 'vendors' | 'inventory'

interface FieldDef { key: string; label: string; required?: boolean }

const FIELDS: Record<Mode, FieldDef[]> = {
  vendors: [
    { key: 'name', label: 'Vendor name', required: true },
    { key: 'type', label: 'Type' },
    { key: 'markets', label: 'Markets' },
    { key: 'status', label: 'Status (Recurring / Opportunistic)' }
  ],
  inventory: [
    { key: 'category_key', label: 'Category key', required: true },
    { key: 'vendor_name', label: 'Vendor name' },
    { key: 'property_name', label: 'Property name', required: true },
    { key: 'market', label: 'Market' },
    { key: 'event_start', label: 'Event start (YYYY-MM-DD)' },
    { key: 'event_end', label: 'Event end (YYYY-MM-DD)' },
    { key: 'item_name', label: 'Item name', required: true },
    { key: 'availability', label: 'Availability' },
    { key: 'cost', label: 'Cost' },
    { key: 'currency', label: 'Currency' },
    { key: 'unit', label: 'Unit' },
    { key: 'price_type', label: 'Price type (rack/quote/negotiated/transacted/market_intel)' },
    { key: 'source', label: 'Source' }
  ]
}

const NONE = '__none__'

/** Loose match for auto-mapping: strips spaces/underscores/case so "Vendor Name", "vendor_name" and "VENDORNAME" all match. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function autoMap(fields: FieldDef[], rawHeaders: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const f of fields) {
    const match = rawHeaders.find((h) => normalize(h) === normalize(f.key) || normalize(h) === normalize(f.label))
    mapping[f.key] = match ?? NONE
  }
  return mapping
}

export default function Import() {
  const [mode, setMode] = useState<Mode>('vendors')
  const [rawHeaders, setRawHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ created?: number; itemsCreated?: number; pricesCreated?: number; errors: { row: number; message: string }[] } | null>(null)

  const fields = FIELDS[mode]

  function resetAll() {
    setRawHeaders([]); setRawRows([]); setMapping({}); setFileName(''); setResult(null)
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const headers = res.meta.fields ?? []
        setRawHeaders(headers)
        setRawRows(res.data)
        setMapping(autoMap(fields, headers))
      }
    })
  }

  // Rows transformed into the shape the API expects, using the current mapping.
  const mappedRows = useMemo(() => {
    return rawRows.map((row) => {
      const out: Record<string, string> = {}
      for (const f of fields) {
        const src = mapping[f.key]
        out[f.key] = src && src !== NONE ? (row[src] ?? '') : ''
      }
      return out
    })
  }, [rawRows, mapping, fields])

  const missingRequired = fields.filter((f) => f.required && (!mapping[f.key] || mapping[f.key] === NONE))
  const canSubmit = rawRows.length > 0 && missingRequired.length === 0

  // Vercel functions have a time limit, so a large sheet is sent in small batches rather than one request.
  const CHUNK = 20
  const [progress, setProgress] = useState('')

  async function submit() {
    setUploading(true)
    setResult(null)
    const total = { created: 0, itemsCreated: 0, pricesCreated: 0, errors: [] as { row: number; message: string }[] }
    try {
      for (let start = 0; start < mappedRows.length; start += CHUNK) {
        setProgress(`Importing rows ${start + 1}–${Math.min(start + CHUNK, mappedRows.length)} of ${mappedRows.length}…`)
        const res = await fetch(`/api/import/${mode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: mappedRows.slice(start, start + CHUNK) })
        })
        const data = await res.json()
        if (!res.ok) {
          total.errors.push({ row: start, message: `${data.error ?? 'This batch failed'} — stopped here; rows from ${start + 1} onward were not imported. Fix the problem and re-run (rows already imported are matched by name, so nothing is duplicated).` })
          break
        }
        total.created += data.created ?? 0
        total.itemsCreated += data.itemsCreated ?? 0
        total.pricesCreated += data.pricesCreated ?? 0
        for (const e of data.errors ?? []) total.errors.push({ row: e.row + start, message: e.message })
      }
      setResult(total)
    } finally {
      setUploading(false)
      setProgress('')
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">Import</h1>
      <p className="text-muted text-sm mb-5">
        Upload any CSV, then map its columns to the fields below — headers don't need to match exactly.
        Existing vendors/properties are matched by exact (case-insensitive) name before anything new is
        created, so re-running an import is safe.
      </p>

      <div className="flex gap-2 mb-4">
        <button onClick={() => { setMode('vendors'); resetAll() }} className={`px-3 py-1.5 rounded text-sm ${mode === 'vendors' ? 'bg-amber text-black font-semibold' : 'border border-line text-muted'}`}>Vendors</button>
        <button onClick={() => { setMode('inventory'); resetAll() }} className={`px-3 py-1.5 rounded text-sm ${mode === 'inventory' ? 'bg-amber text-black font-semibold' : 'border border-line text-muted'}`}>Inventory (property + item + price)</button>
      </div>

      <div className="bg-panel border border-line rounded-xl p-4 mb-6">
        <input type="file" accept=".csv" onChange={onFile} className="text-sm" />
        {fileName && <div className="text-xs text-muted mt-2">{fileName} — {rawRows.length} rows, {rawHeaders.length} columns detected</div>}
      </div>

      {rawHeaders.length > 0 && (
        <div className="bg-panel border border-line rounded-xl p-4 mb-6">
          <div className="text-xs text-muted uppercase mb-3">Map columns</div>
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3">
                <label className="text-sm">
                  {f.label}{f.required ? <span className="text-amber"> *</span> : ''}
                </label>
                <select
                  value={mapping[f.key] ?? NONE}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  className={`bg-panel2 border rounded-md px-2 py-1.5 text-sm w-48 ${f.required && (!mapping[f.key] || mapping[f.key] === NONE) ? 'border-red-400' : 'border-line'}`}
                >
                  <option value={NONE}>— not mapped —</option>
                  {rawHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 && (
            <div className="text-red-400 text-xs mt-3">
              Required field{missingRequired.length > 1 ? 's' : ''} not mapped: {missingRequired.map((f) => f.label).join(', ')}
            </div>
          )}
        </div>
      )}

      {mappedRows.length > 0 && (
        <div className="bg-panel border border-line rounded-xl overflow-hidden mb-4">
          <div className="p-3 text-xs text-muted uppercase border-b border-line">Preview after mapping (first 5 rows)</div>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-line">{fields.map((f) => <th key={f.key} className="text-left p-2 font-mono">{f.key}</th>)}</tr></thead>
            <tbody>
              {mappedRows.slice(0, 5).map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {fields.map((f) => <td key={f.key} className="p-2">{r[f.key] || <span className="text-muted">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rawRows.length > 0 && (
        <button onClick={submit} disabled={uploading || !canSubmit} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">
          {uploading ? 'Importing…' : `Import ${rawRows.length} rows`}
        </button>
      )}
      {progress && <div className="text-xs text-muted mt-2">{progress}</div>}

      {result && (
        <div className="bg-panel border border-line rounded-xl p-4 mt-4 text-sm">
          {mode === 'vendors' && <div className="text-green-400 mb-2">{result.created} vendors created</div>}
          {mode === 'inventory' && <div className="text-green-400 mb-2">{result.itemsCreated} items created, {result.pricesCreated} price records created</div>}
          {result.errors.length > 0 && (
            <div>
              <div className="text-red-400 mb-1">{result.errors.length} row(s) failed:</div>
              {result.errors.map((e, i) => <div key={i} className="text-xs text-muted">Row {e.row + 1}: {e.message}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
