// Stand-in for the session lookup in src/lib/auth.ts: "who is signed in" is whatever the test says it is.
// Everything AFTER that (profile lookup, permissions, queries) runs for real.
export function createServerClient() {
  return { auth: { getUser: async () => {
    const id = (globalThis as { __TEST_USER__?: string | null }).__TEST_USER__
    return { data: { user: id ? { id } : null } }
  } } }
}
export function createBrowserClient() { throw new Error('browser client is not available in tests') }
