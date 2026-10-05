// Run with: npx tsx tests/files.test.ts
import assert from 'node:assert/strict'
import { validateUpload, driveFileName, sha256Hex, MAX_CONTRACT_FILE_BYTES } from '../src/lib/contractFiles'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(50, 1)])
const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(50, 2)])
const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(50, 3)])
test('accepts a real PDF, DOCX (zip), and is case-insensitive about the extension', () => {
  assert.deepEqual(validateUpload('Contract.PDF', pdf), { ok: true, ext: 'pdf', mime: 'application/pdf' })
  assert.equal(validateUpload('a.docx', zip).ok, true); assert.equal(validateUpload('a.xlsx', zip).ok, true)
})
test('refuses an executable renamed to .pdf (the bytes are checked, not just the name)', () => {
  const r = validateUpload('invoice.pdf', exe); assert.equal(r.ok, false); assert.match((r as { reason: string }).reason, /does not look like a real \.pdf/)
})
test('refuses types we never accept, and a double extension that ends in one', () => {
  for (const n of ['x.exe', 'x.pdf.exe', 'x.html', 'x.svg', 'x.js', 'x.docm', 'x', 'x.']) assert.equal(validateUpload(n, pdf).ok, false, n)
})
test('refuses empty and oversize files', () => {
  assert.equal(validateUpload('a.pdf', Buffer.alloc(0)).ok, false)
  assert.equal(validateUpload('a.pdf', Buffer.concat([pdf, Buffer.alloc(MAX_CONTRACT_FILE_BYTES)])).ok, false)
  assert.equal(validateUpload('a.pdf', Buffer.concat([pdf, Buffer.alloc(MAX_CONTRACT_FILE_BYTES - pdf.length)])).ok, true, 'exactly at the limit is fine')
})
test('a PNG is not a JPEG and vice versa', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]); const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
  assert.equal(validateUpload('a.png', png).ok, true); assert.equal(validateUpload('a.jpg', jpg).ok, true); assert.equal(validateUpload('a.png', jpg).ok, false); assert.equal(validateUpload('a.jpg', png).ok, false)
})
test('Drive file names are version-first, ASCII, and cannot carry a path', () => {
  assert.equal(driveFileName('Contract', 3, 'Signed copy.PDF'), 'Contract v3 - Signed_copy.pdf')
  const evil = driveFileName('../../Contract', 1, '../../etc/passwd.pdf'); assert.ok(!evil.includes('/') && !evil.includes('..') && evil.endsWith('.pdf'), evil)
})
test('sha256 identifies identical content', () => { assert.equal(sha256Hex(pdf), sha256Hex(Buffer.from(pdf))); assert.notEqual(sha256Hex(pdf), sha256Hex(zip)) })
console.log(`\n${passed} passed`)
