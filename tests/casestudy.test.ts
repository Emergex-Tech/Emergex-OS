// Run with: npx tsx tests/casestudy.test.ts   (no database or network needed)
import assert from 'node:assert/strict'
import { draftCaseStudy, fmtNum, joinList, distinctiveWords, hiddenNames, anonymise, findLeaks, rankCaseStudies, type CaseStudyInput } from '../src/lib/caseStudy'
let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok  ' + name) }
const input: CaseStudyInput = {
  projectName: 'Blitz Casino — Gulf Premier League', brandName: 'Blitz Casino', categories: ['League and tournament'], markets: ['UAE', 'UK'], propertyNames: ['Gulf Premier League'], deliveryPct: 87.5, closedOn: '2026-09-30',
  deliverables: [
    { description: 'Perimeter LED', status: 'delivered', planned: 10, delivered: 10, unit: 'matches', pct: 100, proof_count: 2 }, { description: 'Social posts', status: 'partial', planned: 8, delivered: 6, unit: 'posts', pct: 75, proof_count: 0 },
    { description: 'Hospitality', status: 'missed', planned: 2, delivered: 0, unit: null, pct: 0, proof_count: 0 }, { description: 'Old banner', status: 'replaced', planned: 1, delivered: 0, unit: null, pct: 0, proof_count: 0 }],
  metrics: [{ label: 'Exposure', value: 1500000, unit: null, aggregation: 'sum', subjects: 3, as_of: '2026-09-28' }, { label: 'Engagement rate', value: 4.25, unit: '%', aggregation: 'avg', subjects: 2, as_of: '2026-09-29' }]
}

console.log('the draft (L23)')
test('numbers are formatted predictably', () => { assert.equal(fmtNum(1500000), '1,500,000'); assert.equal(fmtNum(4.25), '4.25'); assert.equal(fmtNum(0.1 + 0.2), '0.3'); assert.equal(fmtNum(999), '999'); assert.equal(joinList(['a']), 'a'); assert.equal(joinList(['a', 'b']), 'a and b'); assert.equal(joinList(['a', 'b', 'c']), 'a, b and c') })
test('the draft is exactly what the records say — every figure copied, nothing invented', () => {
  const d = draftCaseStudy(input)
  assert.equal(d.title, 'Blitz Casino — Gulf Premier League')
  assert.equal(d.body.split('## The story')[0], [
    '## Overview', 'Blitz Casino worked with EmergeX on Gulf Premier League in UAE and UK (League and tournament). Overall delivery: 87.5% across 3 deliverables. Closed 2026-09-30.', '',
    '## What was delivered', '- Perimeter LED: 10 of 10 matches (100%), proof on file', '- Social posts: 6 of 8 posts (75%)', '- Hospitality: not delivered', '- Old banner: replaced by a make-good (counted under that deliverable)', '',
    '## Results', '- Exposure: 1,500,000 (total of 3 readings, as of 2026-09-28)', '- Engagement rate: 4.25% (average of 2 readings, as of 2026-09-29)', '', ''].join('\n'))
  assert.deepEqual(d.results, [{ label: 'Exposure', value: 1500000, unit: null, as_of: '2026-09-28' }, { label: 'Engagement rate', value: 4.25, unit: '%', as_of: '2026-09-29' }])
  assert.match(d.body, /## The story\n\[Add the objective/)
})
test('missing data leaves things OUT instead of making them up', () => {
  const d = draftCaseStudy({ ...input, categories: [], markets: [], propertyNames: [], deliveryPct: null, closedOn: null, deliverables: [], metrics: [] })
  assert.equal(d.body.split('\n\n')[0], '## Overview\nBlitz Casino worked with EmergeX.'); assert.ok(!d.body.includes('## What was delivered') && !d.body.includes('## Results')); assert.deepEqual(d.results, [])
})
test('a missed deliverable that was partly delivered says so; a long list is capped', () => {
  assert.match(draftCaseStudy({ ...input, deliverables: [{ description: 'Boards', status: 'missed', planned: 5, delivered: 2, unit: 'boards', pct: 40, proof_count: 0 }] }).body, /- Boards: not delivered \(2 of 5 boards \(40%\)\)/)
  const many = Array.from({ length: 25 }, (_, i) => ({ description: `D${i}`, status: 'planned', planned: 1, delivered: 0, unit: null, pct: 0, proof_count: 0 }))
  const b = draftCaseStudy({ ...input, deliverables: many }).body; assert.ok(b.includes('- D19:') && !b.includes('- D20:') && b.includes('…and 5 more'))
})
test('"1 deliverable" and "1 reading" are singular', () => assert.match(draftCaseStudy({ ...input, deliverables: [input.deliverables[0]], metrics: [{ ...input.metrics[0], subjects: 1 }] }).body, /across 1 deliverable\.[\s\S]*total of 1 reading,/))

console.log('anonymising (D16)')
const names = hiddenNames({ brand: ['Blitz Casino'], projectName: 'Blitz Casino — Gulf Premier League', partners: ['Apex Sports Media', 'Meridian Agents'] })
test('hidden names: the brand and partners in full AND by their distinctive word — but never the generic words, the property, or the region', () => {
  assert.deepEqual(distinctiveWords('Blitz Casino'), ['Blitz']); assert.deepEqual(distinctiveWords('Apex Sports Media'), ['Apex']); assert.deepEqual(distinctiveWords('Pitchside'), ['Pitchside']); assert.deepEqual(distinctiveWords('AB'), [])
  assert.deepEqual(names.brand, ['Blitz Casino', 'Blitz']); assert.ok(names.partners.includes('Apex Sports Media') && names.partners.includes('Apex') && names.partners.includes('Meridian'))
  assert.ok(!names.partners.includes('Blitz Casino — Gulf Premier League'), 'a project name that contains the brand needs no rule of its own: hiding the brand already covers it')
  for (const generic of ['Casino', 'Sports', 'Media', 'Gulf', 'Premier', 'League', 'Agents']) assert.ok(!names.all.some((n) => n.toLowerCase() === generic.toLowerCase()), `${generic} must stay visible`)
})
test('the anonymised TITLE keeps the property: "Brand — Property" becomes "the brand — Property"; a project renamed without the brand is hidden in full', () => {
  assert.equal(anonymise('Blitz Casino — Gulf Premier League', names), 'the brand — Gulf Premier League')
  const custom = hiddenNames({ brand: ['Blitz Casino'], projectName: 'Summer Blast 2026', partners: [] }); assert.ok(custom.partners.includes('Summer Blast 2026')); assert.equal(anonymise('Summer Blast 2026 recap', custom), 'a partner recap')
})
test('whole names are replaced, longest first, case-insensitively, including possessives; the property stays', () => {
  assert.equal(anonymise("Blitz Casino's campaign with Apex Sports Media on Gulf Premier League, via Meridian.", names), "the brand's campaign with a partner on Gulf Premier League, via a partner.")
  assert.equal(anonymise('BLITZ casino and blitz', names), 'the brand and the brand'); assert.equal(anonymise('Apex delivered', names), 'a partner delivered')
})
test('only WHOLE words are replaced, but the leak check is stricter (substring) so a human must fix "Blitzkrieg"', () => {
  assert.equal(anonymise('Blitzkrieg tactics', names), 'Blitzkrieg tactics'); assert.deepEqual(findLeaks('Blitzkrieg tactics', names.all), ['Blitz'])
  assert.deepEqual(findLeaks('the brand worked with a partner', names.all), []); assert.deepEqual(findLeaks('with APEX again', names.all), ['Apex']); assert.deepEqual(findLeaks('anything', ['', 'ab']), [], 'names under 3 characters are ignored')
})
test('names with regular-expression characters cannot break or hijack the replacement', () => {
  const n = hiddenNames({ brand: ['A&B (Pty) Ltd.'], projectName: 'x', partners: [] }); assert.equal(anonymise('Deal with A&B (Pty) Ltd. signed', n), 'Deal with the brand signed'); assert.doesNotThrow(() => anonymise('x', { brand: ['.*', '(('], partners: ['[a-'] }))
})
test('the whole round trip: a draft, anonymised, contains none of the hidden names', () => {
  const d = draftCaseStudy(input); const a = anonymise(d.title + '\n' + d.body, names); assert.deepEqual(findLeaks(a, names.all), []); assert.ok(a.includes('Gulf Premier League') && a.includes('87.5%') && a.includes('1,500,000'), 'the facts survive; only identities go')
})

console.log('suggestions (L25)')
const study = (id: string, cats: string[], markets: string[], props: string[], brand: string, at: string) => ({ id, category_keys: cats, markets, property_names: props, brand_id: brand, approved_at: at })
const S = [study('A', ['ooh_led'], ['UAE'], ['P1'], 'b1', '2026-01-01'), study('B', ['ooh_led', 'team'], ['UK'], [], 'b2', '2026-02-01'), study('C', ['influencer_creator'], [], [], 'b3', '2026-03-01'), study('D', ['ooh_led'], [], [], 'b4', '2026-03-01')]
test('scored by shared category (3), market (2) and property (2); case-insensitive; nothing shared = not suggested', () => {
  const r = rankCaseStudies(S, { categories: ['ooh_led'], markets: ['uae'], propertyNames: ['p1'], brandId: 'b9' })
  assert.deepEqual(r.map((x) => [x.study.id, x.score]), [['A', 7], ['D', 3], ['B', 3]], 'D and B tie on 3 — the more recently approved (D) first'); assert.deepEqual(r[0].reasons, ['same category: ooh_led', 'same market: UAE', 'same property: P1'])
  assert.ok(!r.some((x) => x.study.id === 'C'))
})
test('a brand\'s OWN past project is never suggested for its own pitch; the limit applies; an empty query suggests nothing', () => {
  assert.ok(!rankCaseStudies(S, { categories: ['ooh_led'], markets: [], propertyNames: [], brandId: 'b1' }).some((x) => x.study.id === 'A'))
  assert.equal(rankCaseStudies(S, { categories: ['ooh_led'], markets: [], propertyNames: [], brandId: null }, 2).length, 2); assert.deepEqual(rankCaseStudies(S, { categories: [], markets: [], propertyNames: [], brandId: null }), [])
})
console.log(`\n${passed} passed`)
