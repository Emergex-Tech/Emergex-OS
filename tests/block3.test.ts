// Run with: npx tsx tests/block3.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { pickBestCost, type CostRecord } from '../src/lib/pricing'
import { diffSnapshots, totalOf, type VersionSnapshot } from '../src/lib/proposalVersions'
import { buildProposalWorkbook } from '../src/lib/proposalExcel'

let passed = 0
const test = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve(fn()).then(() => { passed++; console.log('  ok  ' + name) })

const rec = (o: Partial<CostRecord> & { id: string; type: string; amount: number; price_date: string }): CostRecord => ({
  currency: 'USD', unit: null, validity_days: null, source: null, reusable: false, brand_id: null, ...o
})
const TODAY = new Date('2026-09-28')

async function main() {
  console.log('pickBestCost')
  await test('market intel is never used as cost, even when it is the newest and only record', () => {
    assert.equal(pickBestCost([rec({ id: 'm', type: 'market_intel', amount: 1, price_date: '2026-09-27' })], null, TODAY), null)
  })
  await test('priority: transacted > negotiated(reusable) > quote > rack, regardless of recency', () => {
    const best = pickBestCost([
      rec({ id: 'rack', type: 'rack', amount: 100, price_date: '2026-09-20' }),
      rec({ id: 'quote', type: 'quote', amount: 90, price_date: '2026-09-15' }),
      rec({ id: 'neg', type: 'negotiated', amount: 80, price_date: '2026-09-10', reusable: true }),
      rec({ id: 'tx', type: 'transacted', amount: 70, price_date: '2026-01-01' })
    ], null, TODAY)
    assert.equal(best?.priceRecordId, 'tx')
  })
  await test('a non-reusable negotiated rate is only usable by the brand it was negotiated for', () => {
    const records = [
      rec({ id: 'neg', type: 'negotiated', amount: 60, price_date: '2026-09-10', reusable: false, brand_id: 'brandA' }),
      rec({ id: 'rack', type: 'rack', amount: 100, price_date: '2026-09-01' })
    ]
    assert.equal(pickBestCost(records, 'brandA', TODAY)?.priceRecordId, 'neg', 'the brand it was negotiated for gets it')
    assert.equal(pickBestCost(records, 'brandB', TODAY)?.priceRecordId, 'rack', 'another brand must NOT inherit it')
    assert.equal(pickBestCost(records, null, TODAY)?.priceRecordId, 'rack')
  })
  await test('a reusable negotiated rate is usable by any brand', () => {
    const r = [rec({ id: 'neg', type: 'negotiated', amount: 60, price_date: '2026-09-10', reusable: true, brand_id: 'brandA' })]
    assert.equal(pickBestCost(r, 'brandB', TODAY)?.priceRecordId, 'neg')
  })
  await test('an expired quote is skipped in favour of a still-valid rack rate', () => {
    const best = pickBestCost([
      rec({ id: 'quote', type: 'quote', amount: 50, price_date: '2026-08-01', validity_days: 10 }),
      rec({ id: 'rack', type: 'rack', amount: 100, price_date: '2026-07-01' })
    ], null, TODAY)
    assert.equal(best?.priceRecordId, 'rack')
  })
  await test('if every record has expired it falls back to history rather than returning nothing', () => {
    const best = pickBestCost([rec({ id: 'quote', type: 'quote', amount: 50, price_date: '2026-01-01', validity_days: 5 })], null, TODAY)
    assert.equal(best?.priceRecordId, 'quote')
  })

  console.log('diffSnapshots')
  const A: VersionSnapshot = { currency: 'USD', total: 0, lines: [
    { line_id: 'l1', item_id: 'i1', item_name: 'LED', quantity: 2, sell_price: 1000 },
    { line_id: 'l2', item_id: 'i2', item_name: 'Mats', quantity: 1, sell_price: 500 }
  ] }
  await test('first version is described as initial', () => assert.match(diffSnapshots(null, A), /^Initial version \(2 lines/))
  await test('identical snapshots produce no change (so exporting twice does not mint a new version)', () => assert.equal(diffSnapshots(A, structuredClone(A)), ''))
  await test('price change, quantity change, added and removed lines are all reported', () => {
    const B: VersionSnapshot = { currency: 'USD', total: 0, lines: [
      { line_id: 'l1', item_id: 'i1', item_name: 'LED', quantity: 3, sell_price: 1200 },
      { line_id: 'l3', item_id: 'i3', item_name: 'Signage', quantity: 1, sell_price: 250 }
    ] }
    const d = diffSnapshots(A, B)
    assert.match(d, /LED: price 1,000 → 1,200/)
    assert.match(d, /LED: quantity 2 → 3/)
    assert.match(d, /Added Signage/)
    assert.match(d, /Removed Mats/)
  })
  await test('totals are computed as quantity × unit price, rounded to cents', () =>
    assert.equal(totalOf([{ line_id: 'a', item_id: 'a', item_name: 'a', quantity: 3, sell_price: 59270.4 }]), 177811.2))

  console.log('Excel export')
  const buf = await buildProposalWorkbook({
    brandName: 'Blitz Casino', contactName: 'S. Khan', currency: 'USD', versionNumber: 3, preparedOn: new Date('2026-09-28'),
    lines: [
      { property: 'UAE League', item: 'LED perimeter', basis: 'per_match', quantity: 3, unitPrice: 59270.4 },
      { property: 'UAE League', item: 'Title sponsorship', basis: 'flat', quantity: 1, unitPrice: 232000 }
    ]
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  const ws = wb.getWorksheet('Proposal')!
  const cells: string[] = []
  ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string') cells.push(c.value) }))

  await test('workbook carries brand, version, currency-labelled headers and humanised basis', () => {
    assert.ok(cells.includes('Blitz Casino'))
    assert.ok(cells.includes('v3'))
    assert.ok(cells.includes('Unit price (USD)'))
    assert.ok(cells.includes('per match'))
  })
  await test('line totals and grand total are live formulas with correct cached values', () => {
    let grand: ExcelJS.CellValue = null
    const lineTotals: number[] = []
    ws.eachRow((row) => {
      const g = row.getCell(7).value as { formula?: string; result?: number } | null
      if (g && typeof g === 'object' && g.formula?.startsWith('SUM')) grand = g.result as number
      else if (g && typeof g === 'object' && g.formula?.startsWith('E')) lineTotals.push(g.result as number)
    })
    assert.deepEqual(lineTotals, [177811.2, 232000])
    assert.equal(grand, 409811.2)
  })
  await test('nothing internal appears anywhere in the workbook (cost, margin, agent, vendor, mechanic)', () => {
    const leak = cells.filter((c) => /cost|margin|agent|vendor|commission|markup|net /i.test(c))
    assert.deepEqual(leak, [])
  })

  console.log(`\n${passed} passed`)
}
main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1) })
