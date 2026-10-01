import { describe, expect, it } from 'vitest'
import { checkFacts, scoreWriting, splitRewrite } from '../src/core/humanizer'

const SLOP = `In today's fast-paced digital landscape, it is crucial to delve into the multifaceted tapestry of team dynamics. Moreover, fostering a culture of collaboration is not just important — it's essential. Furthermore, leveraging synergies can unlock transformative potential. Additionally, it is worth noting that seamless communication serves as a testament to organizational excellence. In conclusion, embracing these pivotal strategies will undoubtedly pave the way for a brighter future.`

const HUMAN = `We shipped the billing fix on Tuesday. It took three tries. The first patch broke refunds, which nobody noticed until Priya's customer in Leeds got charged twice. So now there's a test for that. Honestly the bug was dumb: a rounding call in the wrong place. I'd rather have found it in review than in production, but here we are.`

describe('humanizer scoring (vendored from humanizer-skill)', () => {
  it('scores AI-flavoured prose well above plain human writing', () => {
    const slop = scoreWriting(SLOP)
    const human = scoreWriting(HUMAN)
    expect(slop.score).toBeGreaterThan(human.score)
    expect(slop.score).toBeGreaterThanOrEqual(40)
    expect(human.words).toBeGreaterThan(40)
    expect(typeof slop.verdict).toBe('string')
  })

  it('handles empty text', () => {
    expect(scoreWriting('').words).toBe(0)
  })

  it('flags facts a rewrite dropped', () => {
    const lost = checkFacts('Revenue grew 34% in 2025 to $1.2M, per the Q3 report at https://example.com/q3.', 'Revenue grew a lot last year.')
    expect(lost.ok).toBe(false)
    expect(lost.lost.map((f) => f.value).join(' ')).toMatch(/34%/)
    expect(checkFacts('We grew 34% in 2025.', 'In 2025 we grew 34%.').ok).toBe(true)
  })
})

describe('rewrite output parsing', () => {
  it('splits the rewritten text from the change summary', () => {
    const out = 'First paragraph.\n\nSecond one.\n\n---\nChanges: Removed 4 AI patterns. Varied sentence length.'
    expect(splitRewrite(out)).toEqual({ text: 'First paragraph.\n\nSecond one.', summary: 'Removed 4 AI patterns. Varied sentence length.' })
  })

  it('keeps the whole output when there is no summary', () => {
    expect(splitRewrite('Just the text.\n')).toEqual({ text: 'Just the text.' })
  })

  it('does not mistake a mid-text rule for the summary', () => {
    const out = 'Part one.\n\n---\n\nPart two.\n\n---\nChanges: Tightened.'
    expect(splitRewrite(out).text).toBe('Part one.\n\n---\n\nPart two.')
  })
})
