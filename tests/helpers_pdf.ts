// Test helper: read the text out of a pdf-lib PDF with no extra dependency. pdf-lib writes page text as hex strings in
// (usually deflate-compressed) content streams, so: inflate every stream, then decode each `<hex> Tj`.
import zlib from 'node:zlib'
export function pdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes), out: string[] = []
  let i = 0
  for (;;) {
    const s = buf.indexOf('stream', i, 'latin1'); if (s < 0) break
    let start = s + 6; if (buf[start] === 0x0d) start++; if (buf[start] === 0x0a) start++
    const e = buf.indexOf('endstream', start, 'latin1'); if (e < 0) break
    let chunk: Buffer = buf.subarray(start, e); try { chunk = zlib.inflateSync(chunk) } catch { /* not compressed */ }
    for (const m of chunk.toString('latin1').matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(m[1], 'hex').toString('latin1'))
    for (const m of chunk.toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(m[1])
    i = e + 9
  }
  return out.join('\n')
}
