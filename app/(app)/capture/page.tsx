'use client'
import { useState } from 'react'

interface ProposedRecord {
  entity_type: string
  action: string
  fields: Record<string, unknown>
  confidence: 'high' | 'medium' | 'low'
}

export default function Capture() {
  const [rawInput, setRawInput] = useState('')
  const [captureId, setCaptureId] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [records, setRecords] = useState<ProposedRecord[]>([])
  const [parsing, setParsing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ entity_type: string; entity_id: string }[] | null>(null)

  async function parse() {
    setParsing(true)
    setError('')
    setDone(null)
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_input: rawInput })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCaptureId(data.id)
      setSummary(data.ai_output.summary)
      setRecords(data.ai_output.proposed_records)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setParsing(false)
    }
  }

  function updateFieldsJson(index: number, text: string) {
    try {
      const parsed = JSON.parse(text)
      setRecords((prev) => prev.map((r, i) => (i === index ? { ...r, fields: parsed } : r)))
    } catch {
      // leave as-is until valid JSON — the textarea shows what the user typed regardless
    }
  }

  function removeRecord(index: number) {
    setRecords((prev) => prev.filter((_, i) => i !== index))
  }

  async function confirm() {
    if (!captureId) return
    setConfirming(true)
    setError('')
    try {
      const res = await fetch(`/api/capture/${captureId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDone(data.created)
      setRecords([])
      setRawInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">Capture</h1>
      <p className="text-muted text-sm mb-5">Type, paste or dictate. Nothing saves until you confirm below.</p>

      <div className="bg-panel border border-line rounded-xl p-4 mb-6">
        <textarea
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          placeholder="Paste a vendor rate card, a WhatsApp thread, or just describe what happened…"
          className="bg-panel2 border border-line rounded-md p-3 text-sm w-full h-32 resize-none"
        />
        <button onClick={parse} disabled={parsing || !rawInput.trim()} className="mt-3 bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">
          {parsing ? 'Parsing…' : 'Parse with AI'}
        </button>
      </div>

      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      {done && (
        <div className="bg-[#12211a] border border-[#2c4d3b] text-green-400 rounded-md p-3 text-sm mb-6">
          ✓ Saved {done.length} record{done.length === 1 ? '' : 's'}: {done.map((d) => d.entity_type).join(', ')}
        </div>
      )}

      {records.length > 0 && (
        <div className="bg-panel border border-line rounded-xl p-4">
          <div className="text-sm text-muted mb-4">{summary}</div>
          <div className="flex flex-col gap-3 mb-4">
            {records.map((rec, i) => (
              <div key={i} className="bg-panel2 border border-line rounded-md p-3">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-xs font-mono">
                    <span className="text-amber">{rec.action}</span> · {rec.entity_type} ·{' '}
                    <span className={rec.confidence === 'high' ? 'text-green-400' : rec.confidence === 'medium' ? 'text-amber' : 'text-red-400'}>
                      {rec.confidence} confidence
                    </span>
                  </div>
                  <button onClick={() => removeRecord(i)} className="text-xs text-muted">Remove</button>
                </div>
                <textarea
                  defaultValue={JSON.stringify(rec.fields, null, 2)}
                  onChange={(e) => updateFieldsJson(i, e.target.value)}
                  className="bg-panel border border-line rounded-md p-2 text-xs font-mono w-full h-24"
                />
              </div>
            ))}
          </div>
          <button onClick={confirm} disabled={confirming || records.length === 0} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">
            {confirming ? 'Saving…' : 'Confirm & save'}
          </button>
        </div>
      )}
    </div>
  )
}
