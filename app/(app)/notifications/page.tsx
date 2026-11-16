'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Item { label: string; detail: string; link: string; severity: 'info' | 'warn' | 'urgent' }
interface Group { title: string; items: Item[] }

const SEVERITY_STYLE: Record<Item['severity'], string> = {
  urgent: 'text-red-400', warn: 'text-amber', info: 'text-blue-400'
}

export default function Notifications() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/notifications').then((r) => (r.ok ? r.json() : [])).then((g) => { setGroups(g); setLoading(false) })
  }, [])

  if (loading) return <div className="text-muted">Loading…</div>

  return (
    <div>
      <h1 className="text-lg font-semibold mb-5">Notifications</h1>
      {groups.length === 0 && <div className="bg-panel border border-line rounded-xl p-6 text-center text-muted">Nothing needs attention right now.</div>}
      {groups.map((g) => (
        <div key={g.title} className="mb-6">
          <h2 className="text-xs font-mono text-muted uppercase mb-2">{g.title} <span className="text-dim">({g.items.length})</span></h2>
          <div className="bg-panel border border-line rounded-xl overflow-hidden">
            {g.items.map((item, i) => (
              <Link key={i} href={item.link} className="flex justify-between items-center p-3 border-b border-line last:border-0 text-sm hover:bg-panel2">
                <span className={SEVERITY_STYLE[item.severity]}>{item.label}</span>
                <span className="text-muted text-xs">{item.detail}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
