'use client'
import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

interface User { id: string; full_name: string; email: string; role_key: string; disabled: boolean; created_at: string; agent_id?: string | null }
const ROLES = ['team', 'manager', 'ceo']
const NEW_ROLES = [...ROLES, 'agent']

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('team')
  const [agentId, setAgentId] = useState('')
  const [agentCos, setAgentCos] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { supabaseBrowser().from('agents').select('id, name').order('name').then(({ data }) => setAgentCos(data ?? [])) }, [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/users')
    setUsers(res.ok ? await res.json() : [])
    setLoading(false)
  }

  async function createUser() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, email, role_key: role, agent_id: role === 'agent' ? agentId : undefined })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setReveal({ email: data.email, password: data.temporary_password })
      setShowNew(false); setFullName(''); setEmail(''); setRole('team')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }

  async function changeRole(id: string, newRole: string) {
    setError('')
    const res = await fetch(`/api/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role_key: newRole }) })
    const data = await res.json()
    if (!res.ok) { setError(data.error); return }
    load()
  }

  async function toggleDisabled(u: User) {
    setError('')
    const res = await fetch(`/api/users/${u.id}/${u.disabled ? 'enable' : 'disable'}`, { method: 'PATCH' })
    const data = await res.json()
    if (!res.ok) { setError(data.error); return }
    load()
  }

  async function resetPassword(u: User) {
    if (!window.confirm(`Reset the password for ${u.full_name}? Their current password will stop working immediately.`)) return
    setError('')
    const res = await fetch(`/api/users/${u.id}/reset-password`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) { setError(data.error); return }
    setReveal({ email: u.email, password: data.temporary_password })
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-lg font-semibold">Users</h1>
        <button onClick={() => setShowNew((s) => !s)} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm">+ New user</button>
      </div>

      {reveal && (
        <div className="bg-[#12211a] border border-[#2c4d3b] rounded-xl p-4 mb-6">
          <div className="text-green-400 text-sm font-semibold mb-2">Share these credentials with the user securely — this password is shown once and not stored anywhere.</div>
          <div className="font-mono text-sm">{reveal.email}</div>
          <div className="font-mono text-sm text-amber select-all">{reveal.password}</div>
          <button onClick={() => setReveal(null)} className="text-xs text-muted underline mt-2">Dismiss</button>
        </div>
      )}

      {showNew && (
        <div className="bg-panel border border-line rounded-xl p-4 mb-6">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs text-muted block mb-1">Full name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full">
                {NEW_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {role === 'agent' && (
            <div className="mb-3">
              <label className="text-xs text-muted block mb-1">Agent company</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full max-w-xs">
                <option value="">Select…</option>{agentCos.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <div className="text-xs text-muted mt-1">An agent login only ever sees what you explicitly share with this company, on the separate agent portal. Create the company on Brands &amp; Routes first.</div>
            </div>
          )}
          <div className="text-xs text-muted mb-3">A random temporary password is generated automatically — you&apos;ll see it once after creating the account.</div>
          <button onClick={createUser} disabled={saving || !fullName || !email || (role === 'agent' && !agentId)} className="bg-amber text-black font-semibold px-4 py-2 rounded-md text-sm disabled:opacity-40">
            {saving ? 'Creating…' : 'Create user'}
          </button>
        </div>
      )}

      {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

      <div className="bg-panel border border-line rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase">
            <tr className="border-b border-line">
              <th className="text-left p-3">Name</th><th className="text-left p-3">Email</th><th className="text-left p-3">Role</th>
              <th className="text-left p-3">Status</th><th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && users.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="p-3">{u.full_name}</td>
                <td className="p-3 font-mono text-xs">{u.email}</td>
                <td className="p-3">
                  {u.role_key === 'agent'
                    ? <span className="text-xs text-amber" title="An agent account can't change role. Disable it and create a new account instead.">agent · {agentCos.find((a) => a.id === u.agent_id)?.name ?? ''}</span>
                    : <select value={u.role_key} onChange={(e) => changeRole(u.id, e.target.value)} className="bg-panel2 border border-line rounded px-2 py-1 text-xs">
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>}
                </td>
                <td className="p-3">{u.disabled ? <span className="text-red-400">Disabled</span> : <span className="text-green-400">Active</span>}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button onClick={() => resetPassword(u)} className="text-xs text-muted underline">Reset password</button>
                    <button onClick={() => toggleDisabled(u)} className="text-xs text-muted underline">{u.disabled ? 'Enable' : 'Disable'}</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && users.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">No users yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
