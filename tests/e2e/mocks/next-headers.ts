// Stand-in for next/headers so route handlers can run outside a Next.js request.
export function cookies() { return { get: (_name: string) => undefined } }
