'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

/** The agent portal shell. Deliberately separate from the staff app: it has no staff navigation and shows only what /api/agent/* returns. */
export default function AgentLayout({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'unreleased'>('loading')
  const [who, setWho] = useState<{ name: string; company: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    const supabase = supabaseBrowser()
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.replace('/login'); return }
      const { data: profile } = await supabase.from('profiles').select('role_key').eq('id', data.session.user.id).single()
      if (profile?.role_key !== 'agent') { router.replace('/dashboard'); return }
      const res = await fetch('/api/agent/me')
      if (res.status === 403) { setState('unreleased'); return }
      setWho(res.ok ? await res.json() : null); setState('ok')
    })
  }, [router])

  const signOut = async () => { await supabaseBrowser().auth.signOut(); router.replace('/login') }
  if (state === 'loading') return <div className="min-h-screen flex items-center justify-center text-muted">Loading…</div>
  if (state === 'unreleased') return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div className="bg-panel border border-line rounded-xl p-8 max-w-md">
        <div className="text-lg font-semibold mb-2">The agent portal isn&apos;t open yet</div>
        <p className="text-sm text-muted mb-4">Your account is set up. You&apos;ll be able to use this once it has been released — your contact will let you know.</p>
        <button onClick={signOut} className="border border-line text-sm px-4 py-2 rounded-md">Sign out</button>
      </div>
    </div>
  )
  return (
    <div className="min-h-screen">
      <header className="border-b border-line px-6 py-3 flex justify-between items-center">
        <div className="font-semibold">Emerge<span className="text-amber">X</span> <span className="text-muted font-normal text-sm">· {who?.company}</span></div>
        <div className="text-sm text-muted">{who?.name} <button onClick={signOut} className="ml-4 underline">Sign out</button></div>
      </header>
      <main className="p-6 max-w-5xl mx-auto">{children}</main>
    </div>
  )
}
