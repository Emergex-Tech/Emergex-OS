/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      // The public report page: never indexed, never cached, never framed, and never sends its (secret) address to another site.
      { source: '/r/:path*', headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" }
      ] }
    ]
  }
}
module.exports = nextConfig
