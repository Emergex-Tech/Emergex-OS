'use client'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

export default function Login() {
  const signIn = async () => {
    const supabase = supabaseBrowser()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Only a hint to Google's account picker; see the note in (app)/layout.tsx about real enforcement.
        queryParams: process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ? { hd: process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN } : undefined,
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined
      }
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-panel border border-line rounded-xl p-10 text-center max-w-sm">
        <div className="text-2xl font-semibold mb-1">
          Emerge<span className="text-amber">X</span> OS
        </div>
        <div className="text-muted text-sm mb-6">Sign in with your company Google account</div>
        <button onClick={signIn} className="bg-amber text-black font-semibold px-5 py-2.5 rounded-lg text-sm">
          Continue with Google
        </button>
      </div>
    </div>
  )
}
