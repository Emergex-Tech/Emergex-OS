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
  { href: '/intel', label: 'Intel' },
  { href: '/capture', label: 'Capture' },
  { href: '/import', label: 'Import' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/search', label: 'Search' }
]

export default function AppLayout({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [who, setWho] = useState<{ id: string; email: string } | null>(null)
  const [problem, setProblem] = useState<'wrong_domain' | 'no_profile' | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const supabase = supabaseBrowser()
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.replace('/login'); return }
      const email = data.session.user.email ?? ''
      setWho({ id: data.session.user.id, email })

      // Convenience check only — the real barrier is that a user with no profile row can read and write nothing.
      // (For a hard restriction to your company, set the Google OAuth consent screen to "Internal" in Google Cloud.)
      const domain = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN
      if (domain && !email.toLowerCase().endsWith('@' + domain.toLowerCase())) { setProblem('wrong_domain'); setReady(true); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role_key')
        .eq('id', data.session.user.id)
        .single()
      if (!profile) setProblem('no_profile')
      setRole(profile?.role_key ?? null)
      setReady(true)
    })
  }, [router])

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-muted">Loading…</div>

  if (problem && who) {
    const signOutNow = async () => { await supabaseBrowser().auth.signOut(); router.replace('/login') }
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="bg-panel border border-line rounded-xl p-8 max-w-2xl w-full">
          {problem === 'wrong_domain' ? (
            <>
              <div className="text-lg font-semibold mb-2">This account isn&apos;t on the company domain</div>
              <p className="text-sm text-muted mb-4">You&apos;re signed in as <b>{who.email}</b>. Sign in with your company Google account instead.</p>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold mb-2">You&apos;re signed in, but not set up yet</div>
              <p className="text-sm text-muted mb-4">
                <b>{who.email}</b> has no profile, so nothing can be read or written yet. An admin needs to run <b>one</b> of these in the Supabase SQL editor:
              </p>
              <div className="text-xs text-muted mb-1">First person ever (creates the organisation and makes you CEO):</div>
              <pre className="bg-panel2 border border-line rounded-md p-3 text-xs overflow-x-auto mb-4 select-all">{`with org as (insert into organisations (name) values ('EmergeX') returning id)
insert into profiles (id, org_id, full_name, role_key)
select '${who.id}', id, '${who.email}', 'ceo' from org;`}</pre>
              <div className="text-xs text-muted mb-1">Everyone after that (use 'team', 'manager' or 'ceo'):</div>
              <pre className="bg-panel2 border border-line rounded-md p-3 text-xs overflow-x-auto mb-4 select-all">{`insert into profiles (id, org_id, full_name, role_key)
values ('${who.id}', (select id from organisations limit 1), '${who.email}', 'team');`}</pre>
              <p className="text-xs text-muted mb-4">Then reload this page.</p>
            </>
          )}
          <button onClick={signOutNow} className="border border-line text-sm px-4 py-2 rounded-md">Sign out</button>
        </div>
      </div>
    )
  }

  const signOut = async () => { await supabaseBrowser().auth.signOut(); router.replace('/login') }

  return (
    <div className="grid grid-cols-[212px_1fr] min-h-screen">
      <aside className="bg-black/40 border-r border-line p-4 flex flex-col gap-1">
        <div className="text-lg font-semibold px-2 mb-1">
          Emerge<span className="text-amber">X</span> OS
        </div>
        <div className="text-[10px] font-mono text-muted px-2 mb-3 uppercase">{role ?? '—'}</div>
        {NAV.map((item) => (
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
        <button onClick={signOut} className="mt-auto text-xs text-muted px-3 py-2 text-left">Sign out</button>
      </aside>
      <main className="p-6 overflow-x-auto">{children}</main>
    </div>
  )
}
