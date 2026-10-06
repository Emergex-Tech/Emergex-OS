'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/brands', label: 'Brands & Routes' },
  { href: '/proposals', label: 'Proposals' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/projects', label: 'Projects' },
  { href: '/contracts', label: 'Contracts' },
  { href: '/intel', label: 'Intel' },
  { href: '/capture', label: 'Capture' },
  { href: '/import', label: 'Import' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/search', label: 'Search' },
  { href: '/shortlists', label: 'Shortlists' },
  { href: '/benchmarks', label: 'Benchmarks' }
]
const MANAGEMENT_ROLES = ['manager', 'ceo', 'management']
// ceo_view.access is held only by CEO (and legacy 'management') — NOT Manager, per the additive role design in 002_stage2a_role_split.sql.
const CEO_VIEW_ROLES = ['ceo', 'management']

export default function AppLayout({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [who, setWho] = useState<{ id: string; email: string } | null>(null)
  const [noProfile, setNoProfile] = useState(false)
  const [showPwForm, setShowPwForm] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const supabase = supabaseBrowser()
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.replace('/login'); return }
      setWho({ id: data.session.user.id, email: data.session.user.email ?? '' })

      const { data: profile } = await supabase.from('profiles').select('role_key').eq('id', data.session.user.id).single()
      if (profile?.role_key === 'agent') { router.replace('/agent'); return } // agents never see the staff app
      if (!profile) setNoProfile(true)
      setRole(profile?.role_key ?? null)
      setReady(true)
    })
  }, [router])

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-muted">Loading…</div>

  const signOut = async () => { await supabaseBrowser().auth.signOut(); router.replace('/login') }

  // Only reachable for the very first account in an org: everyone created from the Users page gets
  // an auth account AND a profile row together, so this is a one-time bootstrap path, not the normal flow.
  if (noProfile && who) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="bg-panel border border-line rounded-xl p-8 max-w-2xl w-full">
          <div className="text-lg font-semibold mb-2">You&apos;re signed in, but not set up yet</div>
          <p className="text-sm text-muted mb-4">
            <b>{who.email}</b> has no profile, so nothing can be read or written yet. This should only
            happen for the very first account in an org — everyone after that is created from the{' '}
            <b>Users</b> page, which sets this up automatically. Run this once in the Supabase SQL editor:
          </p>
          <pre className="bg-panel2 border border-line rounded-md p-3 text-xs overflow-x-auto mb-4 select-all">{`with org as (insert into organisations (name) values ('EmergeX') returning id)
insert into profiles (id, org_id, full_name, email, role_key)
select '${who.id}', id, '${who.email}', '${who.email}', 'ceo' from org;`}</pre>
          <p className="text-xs text-muted mb-4">Then reload this page.</p>
          <button onClick={signOut} className="border border-line text-sm px-4 py-2 rounded-md">Sign out</button>
        </div>
      </div>
    )
  }

  const nav = [
    ...NAV,
    ...(CEO_VIEW_ROLES.includes(role ?? '') ? [{ href: '/ceo-view', label: 'CEO View' }] : []),
    ...(MANAGEMENT_ROLES.includes(role ?? '') ? [{ href: '/finance', label: 'Finance' }, { href: '/agent-access', label: 'Agent access' }, { href: '/users', label: 'Users' }] : [])
  ]

  return (
    <div className="grid grid-cols-[212px_1fr] min-h-screen">
      <aside className="bg-black/40 border-r border-line p-4 flex flex-col gap-1">
        <div className="text-lg font-semibold px-2 mb-1">
          Emerge<span className="text-amber">X</span> OS
        </div>
        <div className="text-[10px] font-mono text-muted px-2 mb-3 uppercase">{role ?? '—'}</div>
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-2 rounded-md text-sm ${
              pathname === item.href ? 'bg-panel2 text-amber' : 'text-muted hover:bg-panel2 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        ))}

        <div className="mt-auto flex flex-col gap-1">
          <button onClick={() => setShowPwForm((v) => !v)} className="text-xs text-muted px-3 py-2 text-left hover:text-white">Change password</button>
          <button onClick={signOut} className="text-xs text-muted px-3 py-2 text-left hover:text-white">Sign out</button>
        </div>
      </aside>
      <main className="p-6 overflow-x-auto">
        {showPwForm && <ChangePasswordForm onClose={() => setShowPwForm(false)} />}
        {children}
      </main>
    </div>
  )
}

function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit() {
    if (pw.length < 8) { setMsg('Password must be at least 8 characters.'); return }
    if (pw !== confirm) { setMsg('Passwords do not match.'); return }
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_password: pw })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMsg('Password changed.')
      setPw(''); setConfirm('')
      setTimeout(onClose, 1200)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="bg-panel border border-line rounded-xl p-4 mb-5 max-w-sm">
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm font-semibold">Change your password</div>
        <button onClick={onClose} className="text-xs text-muted">✕</button>
      </div>
      <input type="password" placeholder="New password (min. 8 characters)" value={pw} onChange={(e) => setPw(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full mb-2" />
      <input type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full mb-2" />
      {msg && <div className="text-xs text-amber mb-2">{msg}</div>}
      <button onClick={submit} disabled={busy} className="bg-amber text-black font-semibold px-3 py-1.5 rounded-md text-xs disabled:opacity-40">
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
