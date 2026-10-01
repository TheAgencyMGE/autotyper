/**
 * Prose knowledge for AutoWriter: sentence splitting, word swaps a writer
 * might make and then reconsider, and spans that are safe to arrow across in
 * word processors (no characters that autocorrect could lengthen or shorten).
 */
import type { Random } from './random'

/** Split a paragraph into sentences, keeping every character (joining them returns the input). */
export function splitSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*\s*|$)|[.!?]+\s*/g)
  if (!parts || parts.join('') !== paragraph) return paragraph ? [paragraph] : []
  return parts
}

const SWAPS: Array<[string, string]> = [
  ['big', 'large'], ['small', 'little'], ['quick', 'fast'], ['begin', 'start'], ['help', 'assist'], ['show', 'demonstrate'],
  ['use', 'utilize'], ['important', 'crucial'], ['but', 'however'], ['very', 'really'], ['often', 'frequently'],
  ['maybe', 'perhaps'], ['get', 'obtain'], ['make', 'create'], ['think', 'believe'], ['main', 'primary'], ['hard', 'difficult'],
  ['easy', 'simple'], ['change', 'shift'], ['idea', 'concept'], ['part', 'piece'], ['need', 'require'], ['want', 'wish'],
  ['clear', 'obvious'], ['good', 'great'], ['bad', 'poor'], ['new', 'fresh'], ['old', 'former'], ['many', 'several'],
  ['also', 'too'], ['about', 'around'], ['enough', 'sufficient'], ['problem', 'issue'], ['result', 'outcome'], ['way', 'method'],
  ['look', 'seem'], ['keep', 'maintain'], ['find', 'discover'], ['give', 'provide'], ['tell', 'inform'], ['end', 'finish'],
  ['team', 'group'], ['work', 'effort'], ['people', 'folks'], ['answer', 'response'], ['choose', 'pick'], ['feel', 'sense']
]
const SWAP = new Map<string, string>()
for (const [a, b] of SWAPS) {
  if (!SWAP.has(a)) SWAP.set(a, b)
  if (!SWAP.has(b)) SWAP.set(b, a)
}

/** Real words commonly typed in place of each other (autocorrect leaves them alone). */
const SLIPS: Array<[string, string]> = [
  ['their', 'there'], ['then', 'than'], ['affect', 'effect'], ['to', 'too'], ['lose', 'loose'], ['weather', 'whether'],
  ['accept', 'except'], ['form', 'from'], ['quite', 'quiet'], ['advice', 'advise'], ['principal', 'principle'], ['of', 'off']
]
const SLIP = new Map<string, string>()
for (const [a, b] of SLIPS) {
  SLIP.set(a, b)
  SLIP.set(b, a)
}

function matchCase(model: string, word: string): string {
  if (model === model.toUpperCase() && model.length > 1) return word.toUpperCase()
  if (model[0] === model[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1)
  return word
}

export interface WordChoice {
  /** Index of the word inside the sentence. */
  a: number
  b: number
  orig: string
  alt: string
}

function words(sentence: string): Array<{ a: number; b: number; w: string }> {
  const out: Array<{ a: number; b: number; w: string }> = []
  const re = /[A-Za-z]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sentence))) out.push({ a: m.index, b: m.index + m[0].length, w: m[0] })
  return out
}

/** A word the writer first types differently (a near-synonym), then reconsiders. */
export function findSwap(sentence: string, rng: Random): WordChoice | null {
  const cands = words(sentence).filter((x) => x.a > 0 && SWAP.has(x.w.toLowerCase()))
  if (!cands.length) return null
  const c = rng.pick(cands)
  return { a: c.a, b: c.b, orig: c.w, alt: matchCase(c.w, SWAP.get(c.w.toLowerCase())!) }
}

/** A real-word slip (then/than, their/there…) that is only noticed later. */
export function findSlip(sentence: string, rng: Random): WordChoice | null {
  const cands = words(sentence).filter((x) => x.a > 0 && (SLIP.has(x.w.toLowerCase()) || SWAP.has(x.w.toLowerCase())))
  if (!cands.length) return null
  const c = rng.pick(cands)
  const lower = c.w.toLowerCase()
  const alt = SLIP.get(lower) ?? SWAP.get(lower)!
  return { a: c.a, b: c.b, orig: c.w, alt: matchCase(c.w, alt) }
}

/**
 * Text that word processors won't rewrite with a different length (so counting
 * Left/Right arrow presses across it stays exact): letters, digits, spaces and
 * simple punctuation, no "..", no dashes, quotes or brackets.
 */
export function isArrowSafe(span: string): boolean {
  return /^[A-Za-z0-9 ,;:!?.]*$/.test(span) && !span.includes('..')
}
