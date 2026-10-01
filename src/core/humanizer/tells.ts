/**
 * Local, offline detection and fixing of AI-writing "tells".
 *
 * The word and phrase lists come from humanizer-skill (Adam Boudjemaa, MIT)
 * and the pattern catalogue of blader/humanizer (Siqi Chen, MIT). Detection is
 * purely lexical; the quick fix only makes safe, mechanical edits (plain-word
 * swaps, cutting filler, replacing em dashes) and never touches numbers,
 * names or quotes.
 */
import { PHRASES, TIER1_WORDS, TIER2_WORDS } from './vendor/vocabulary.js'

export type TellKind = 'ai-word' | 'filler' | 'opener' | 'dash' | 'inflation' | 'chatbot' | 'not-x-but-y'

export interface Tell {
  start: number
  end: number
  text: string
  kind: TellKind
  /** Why it reads as AI, in plain words. */
  why: string
  /** What the quick fix would put instead ('' = delete), or undefined if it needs a person (or AI) to rewrite. */
  fix?: string
}

interface Rule {
  re: RegExp
  kind: TellKind
  why: string
  /** Replacement (may use $1…), '' to delete, or undefined for "flag only". */
  fix?: string
  /** After deleting at a sentence start, capitalise what follows. */
  capNext?: boolean
}

const WORD_SWAPS: Record<string, string> = {
  utilize: 'use', utilizes: 'uses', utilized: 'used', utilizing: 'using',
  leverage: 'use', leverages: 'uses', leveraged: 'used', leveraging: 'using',
  showcase: 'show', showcases: 'shows', showcased: 'showed', showcasing: 'showing',
  foster: 'build', fosters: 'builds', fostered: 'built', fostering: 'building',
  enhance: 'improve', enhances: 'improves', enhanced: 'improved', enhancing: 'improving',
  bolster: 'strengthen', bolsters: 'strengthens', garner: 'get', garners: 'gets',
  seamless: 'smooth', seamlessly: 'smoothly', groundbreaking: 'new', robust: 'solid',
  pivotal: 'key', crucial: 'important', multifaceted: 'complex', realm: 'area',
  interplay: 'interaction', underscore: 'show', underscores: 'shows', underscoring: 'showing',
  testament: 'proof', vibrant: 'lively', commence: 'start', commences: 'starts', endeavor: 'effort',
  facilitate: 'help', facilitates: 'helps', myriad: 'many', plethora: 'lots'
}

const PHRASE_RULES: Rule[] = [
  { re: /\b(?:it['’]s|it is) (?:worth noting|important to note|important to remember|worth mentioning) that\s+/gi, kind: 'filler', why: 'Throat-clearing before the point', fix: '', capNext: true },
  { re: /\bin today['’]s [^,.;]{0,40}(?:world|landscape|age|era|environment),\s*/gi, kind: 'filler', why: 'Generic scene-setting opener', fix: '', capNext: true },
  { re: /\b(?:in conclusion|in summary|to sum up|ultimately),\s*/gi, kind: 'filler', why: 'Announces a wrap-up instead of just ending', fix: '', capNext: true },
  { re: /\b(?:moreover|furthermore|additionally),\s*/gi, kind: 'opener', why: 'Stiff connector; people rarely talk like this', fix: 'Also, ' },
  { re: /\b(?:serves|stands) as a testament to\b/gi, kind: 'inflation', why: 'Inflated significance', fix: 'shows' },
  { re: /\ba testament to\b/gi, kind: 'inflation', why: 'Inflated significance', fix: 'proof of' },
  { re: /\bplays? a (?:crucial|pivotal|vital|key) role in\b/gi, kind: 'inflation', why: 'Inflated significance', fix: 'matters for' },
  { re: /\bdelve into\b/gi, kind: 'ai-word', why: 'Classic AI vocabulary', fix: 'dig into' },
  { re: /\bdelves into\b/gi, kind: 'ai-word', why: 'Classic AI vocabulary', fix: 'digs into' },
  { re: /\bdelving into\b/gi, kind: 'ai-word', why: 'Classic AI vocabulary', fix: 'digging into' },
  { re: /\b(?:navigate|navigating) the complexities of\b/gi, kind: 'inflation', why: 'Vague, grand phrasing', fix: 'handle' },
  { re: /\bunlock(?:s|ing)? (?:the|its|their|your) (?:full )?potential\b/gi, kind: 'inflation', why: 'Sales language' },
  { re: /\b(?:ever-evolving|rapidly evolving|fast-paced|cutting-edge|game-changing|state-of-the-art)\b/gi, kind: 'inflation', why: 'Sales language' },
  { re: /\bnot (?:just|only|merely) [^,.;]{1,40}, but\b/gi, kind: 'not-x-but-y', why: '“Not X, but Y” staging' },
  { re: /\b(?:synerg(?:y|ies)|transformative|undoubtedly|holistic|paradigm shift|embark(?:s|ing)? on)\b/gi, kind: 'inflation', why: 'Buzzword; say what actually happens' },
  { re: /\bpave(?:s|d)? the way\b/gi, kind: 'inflation', why: 'Stock AI phrase' },
  { re: /(?:^|\n)\s*(?:certainly|absolutely|great question|of course)!\s*/gi, kind: 'chatbot', why: 'Chatbot residue', fix: '', capNext: true },
  { re: /\s*\b(?:i hope this helps|let me know if you (?:have any|need any) (?:other |further )?(?:questions|help))[.!]?/gi, kind: 'chatbot', why: 'Chatbot sign-off', fix: '' },
  { re: /\s*—\s*/g, kind: 'dash', why: 'Em dash as an all-purpose connector', fix: ', ' }
]

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function wordRules(): Rule[] {
  const listed = new Set([...TIER1_WORDS, ...TIER2_WORDS].map((w: string) => w.toLowerCase()))
  const rules: Rule[] = []
  for (const w of new Set([...listed, ...Object.keys(WORD_SWAPS)])) {
    if (w.startsWith('delv')) continue // handled with "into" above
    if (['moreover', 'furthermore'].includes(w)) continue // handled as openers
    rules.push({ re: new RegExp(`\\b${escapeRe(w)}\\b`, 'gi'), kind: 'ai-word', why: 'Overused AI vocabulary', fix: WORD_SWAPS[w] })
  }
  for (const p of PHRASES as string[]) {
    if (/worth noting|important to note|in today|in conclusion|rapidly evolving|cutting-edge/.test(p)) continue // covered above
    rules.push({ re: new RegExp(escapeRe(p), 'gi'), kind: 'inflation', why: 'Stock AI phrase' })
  }
  return rules
}

const RULES: Rule[] = [...PHRASE_RULES, ...wordRules()]

function matchCase(original: string, replacement: string): string {
  if (!replacement || !original) return replacement
  if (original === original.toUpperCase() && original.length > 1 && /[A-Z]/.test(original)) return replacement.toUpperCase()
  if (/^[A-Z]/.test(original)) return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  if (/^[a-z]/.test(original)) return replacement.charAt(0).toLowerCase() + replacement.slice(1)
  return replacement
}

/** All tells in the text, in order, without overlaps (earlier/longer matches win). */
export function findTells(text: string): Tell[] {
  const found: Tell[] = []
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.re.exec(text))) {
      if (!m[0].trim() && rule.kind !== 'dash') {
        rule.re.lastIndex++
        continue
      }
      const fix = rule.fix === undefined ? undefined : matchCase(m[0].trim(), m[0].replace(rule.re, rule.fix))
      found.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: rule.kind, why: rule.why, fix })
      rule.re.lastIndex = m.index + Math.max(1, m[0].length)
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Tell[] = []
  for (const t of found) if (!out.length || t.start >= out[out.length - 1].end) out.push(t)
  return out
}

export interface QuickFixResult {
  text: string
  changes: Array<{ from: string; to: string }>
}

/**
 * Apply every safe, mechanical fix. Tells that need real rewriting (like
 * "not X, but Y" staging) are left for a person or the AI rewrite.
 */
export function quickFix(text: string): QuickFixResult {
  const tells = findTells(text).filter((t) => t.fix !== undefined)
  let out = ''
  let last = 0
  const changes: QuickFixResult['changes'] = []
  let capitaliseNext = false
  for (const t of tells) {
    let chunk = text.slice(last, t.start)
    if (capitaliseNext) chunk = capitaliseFirst(chunk)
    out += chunk
    const rule = RULES.find((r) => r.kind === t.kind && new RegExp(r.re.source, 'i').test(t.text))
    let replacement = t.fix!
    // Keep the leading line break / space that some patterns consume.
    const lead = /^\s*/.exec(t.text)![0]
    if (t.kind === 'chatbot' && lead.includes('\n')) replacement = lead.replace(/[^\n]/g, '') + replacement
    if (t.kind === 'dash') replacement = ', '
    else if (/^[A-Z]/.test(t.text.trimStart()) && replacement) replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1)
    out += replacement
    changes.push({ from: t.text.trim(), to: replacement.trim() })
    capitaliseNext = !!rule?.capNext && (out.length === 0 || /(^|[.!?]\s+|\n\s*)$/.test(out))
    last = t.end
  }
  let rest = text.slice(last)
  if (capitaliseNext) rest = capitaliseFirst(rest)
  out += rest
  // Tidy up what deletions can leave behind.
  out = out.replace(/ ,/g, ',').replace(/,\s*,/g, ',').replace(/ {2,}/g, ' ').replace(/,\s*([.!?])/g, '$1')
  return { text: out, changes }
}

function capitaliseFirst(s: string): string {
  return s.replace(/^(\s*)([a-z])/, (_m, sp: string, c: string) => sp + c.toUpperCase())
}
