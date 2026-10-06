'use client'
import type { FieldSchema } from '@/types/db'

export default function DynamicFields(props: {
  fields: FieldSchema[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {props.fields.map((f) => (
        <div key={f.key}>
          <label className="text-xs text-muted block mb-1">
            {f.key.replace(/_/g, ' ')}{f.required ? ' *' : ''}
          </label>
          {f.type === 'select' ? (
            <select
              value={props.values[f.key] ?? ''}
              onChange={(e) => props.onChange(f.key, e.target.value)}
              className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full"
            >
              <option value="">—</option>
              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === 'boolean' ? (
            <select
              value={props.values[f.key] ?? ''}
              onChange={(e) => props.onChange(f.key, e.target.value)}
              className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full"
            >
              <option value="">—</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              type={f.type === 'number' ? 'number' : 'text'}
              value={props.values[f.key] ?? ''}
              onChange={(e) => props.onChange(f.key, e.target.value)}
              className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full"
            />
          )}
        </div>
      ))}
    </div>
  )
}
