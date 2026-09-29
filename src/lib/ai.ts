// PRD 6.2 + Appendix B: "AI reads it and proposes structured drafts...
// The user confirms before anything is saved" and "AI never saves data,
// changes a price or overrides a warning without user confirmation; model
// name in configuration." This file only ever proposes — it has no access
// to the service-role client and cannot write to the database.

export interface CaptureDraft {
  summary: string
  proposed_records: Array<{
    entity_type: 'vendor' | 'property' | 'item' | 'price_record' | 'intel_note' | 'share' | 'confirmation'
    action: 'create' | 'update' | 'confirm'
    target_id?: string // set for 'update'/'confirm' if the AI matched an existing record
    fields: Record<string, unknown>
    confidence: 'high' | 'medium' | 'low'
  }>
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

export async function parseCapture(params: {
  rawInput: string
  categories: { key: string; label: string }[]
}): Promise<CaptureDraft> {
  const categoryList = params.categories.map((c) => `${c.key} (${c.label})`).join(', ')

  const prompt = `You are extracting structured records from a piece of free text or pasted chat for a
sports/talent sponsorship agency's internal system. Categories available: ${categoryList}.

Text:
"""
${params.rawInput}
"""

Propose a JSON object matching this shape exactly, with no other text:
{
  "summary": "one sentence describing what this text is about",
  "proposed_records": [
    {
      "entity_type": "vendor" | "property" | "item" | "price_record" | "intel_note" | "share" | "confirmation",
      "action": "create" | "update" | "confirm",
      "fields": { ...only fields you can actually infer from the text... },
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Only propose what the text actually supports. Do not invent amounts, dates or names not present in the text.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!response.ok) throw new Error('AI parse failed: ' + (await response.text()))

  const data = await response.json()
  const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '{}'

  try {
    return JSON.parse(text.replace(/^```json\n?|```$/g, ''))
  } catch {
    return { summary: 'Could not parse a structured draft from this text.', proposed_records: [] }
  }
}
