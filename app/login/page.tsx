'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setBusy(false)
    if (error) {
      // Supabase's own message for a disabled/banned account and for a wrong password look the same on
      // purpose (so a login form never confirms which accounts exist) — this is a deliberate limitation,
      // not a bug: a disabled user just sees "invalid" like anyone else who mistyped their password.
      setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message)
      return
    }
    router.replace('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-panel border border-line rounded-xl p-10 max-w-sm w-full">
        <div className="text-2xl font-semibold mb-1 text-center">
          Emerge<span className="text-amber">X</span> OS
        </div>
        <div className="text-muted text-sm mb-6 text-center">Sign in with the account your Manager or CEO created for you</div>

        <form onSubmit={signIn} className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-muted block mb-1">Email</label>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
              className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Password</label>
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="bg-panel2 border border-line rounded-md px-3 py-2 text-sm w-full"
            />
          </div>
          {error && <div className="text-red-400 text-xs">{error}</div>}
          <button type="submit" disabled={busy} className="bg-amber text-black font-semibold px-4 py-2.5 rounded-lg text-sm mt-1 disabled:opacity-40">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="text-xs text-muted text-center mt-5">
          No account? Ask your Manager or CEO to add you from the Users page.
        </div>
      </div>
    </div>
  )
}
