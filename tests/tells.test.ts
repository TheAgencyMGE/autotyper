import { describe, expect, it } from 'vitest'
import { checkFacts } from '../src/core/humanizer'
import { findTells, quickFix } from '../src/core/humanizer/tells'

const SLOP = `In today's fast-paced digital landscape, it is crucial to delve into the multifaceted tapestry of team dynamics. Moreover, fostering a culture of collaboration is not just important, but essential. It's worth noting that teams who leverage feedback grow 34% faster — a testament to seamless communication. In conclusion, these pivotal strategies will pave the way forward. I hope this helps!`

describe('local AI-tell detection', () => {
  it('finds words, phrases, openers, dashes and chatbot residue', () => {
    const kinds = new Set(findTells(SLOP).map((t) => t.kind))
    for (const k of ['ai-word', 'filler', 'opener', 'dash', 'inflation', 'chatbot', 'not-x-but-y']) expect(kinds, k).toContain(k)
    const words = findTells(SLOP).map((t) => t.text.trim().toLowerCase())
    expect(words).toEqual(expect.arrayContaining(['crucial', 'delve into', 'multifaceted', 'tapestry', 'leverage', 'seamless', 'pivotal']))
  })

  it('never reports overlapping tells', () => {
    const tells = findTells(SLOP)
    for (let i = 1; i < tells.length; i++) expect(tells[i].start).toBeGreaterThanOrEqual(tells[i - 1].end)
  })

  it('leaves plain human writing alone', () => {
    expect(findTells('We shipped the billing fix on Tuesday. It took three tries, and the second one broke refunds.')).toEqual([])
  })
})

describe('quick fix (offline, free)', () => {
  const fixed = quickFix(SLOP)

  it('makes the safe mechanical edits', () => {
    expect(fixed.text).not.toMatch(/delve|leverage|seamless|pivotal|crucial|moreover|—|worth noting|in conclusion|i hope this helps/i)
    expect(fixed.text).toContain('dig into')
    expect(fixed.changes.length).toBeGreaterThan(8)
  })

  it('keeps sentences well-formed after deleting openers', () => {
    expect(fixed.text).toMatch(/^Digital|^It is important|^[A-Z]/)
    expect(fixed.text).not.toMatch(/\s{2,}|\s,|,\s*[.!?]|\.\s+[a-z]/)
  })

  it('never drops a fact', () => {
    expect(checkFacts(SLOP, fixed.text).ok).toBe(true)
  })

  it('matches the case of what it replaces', () => {
    expect(quickFix('We utilize it. Utilize this. and moreover, we leverage X.').text).toBe('We use it. Use this. and also, we use X.')
    expect(quickFix('The team delves into data.').text).toBe('The team digs into data.')
  })

  it('leaves "not X, but Y" staging for a real rewrite', () => {
    expect(quickFix('This is not just fast, but reliable.').text).toBe('This is not just fast, but reliable.')
  })

  it('is idempotent', () => {
    expect(quickFix(fixed.text).text).toBe(fixed.text)
  })
})
