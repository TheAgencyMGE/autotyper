/**
 * Plausible "wrong versions" of code for revision behaviours, and line diffs
 * for copy-paste-then-edit. Everything here is pure and deterministic given
 * the RNG, so plans stay reproducible.
 */
import { detectLanguage } from '../codegen/language'
import type { Random } from './random'

const UNSAFE_INSERT = /[()[\]{}<>"'`\uD800-\uDFFF]/

/**
 * Text that can be typed in the middle of a line without triggering editor
 * auto-closing / auto-surround (brackets, quotes) and without surrogate pairs
 * (which editors count as one caret step but JS counts as two).
 */
export const isSafeInsert = (s: string): boolean => !UNSAFE_INSERT.test(s)
export const hasSurrogates = (s: string): boolean => /[\uD800-\uDFFF]/.test(s)

// ----------------------------------------------------------------- comments

export interface CommentSyntax {
  open: string
  close: string
}

export function commentSyntax(code: string): CommentSyntax {
  switch (detectLanguage(code)) {
    case 'python':
      return { open: '# ', close: '' }
    case 'html':
      return { open: '<!-- ', close: ' -->' }
    case 'css':
      return { open: '/* ', close: ' */' }
    default:
      return { open: '// ', close: '' }
  }
}

const TODO_MESSAGES = [
  'TODO: come back to this later',
  'will come back to this later',
  'TODO: finish this',
  'TODO: implement',
  'FIXME: fill this in',
  'TODO: handle this properly',
  'come back to this',
  'TODO: fill in after the rest works',
  'TODO'
]

export function todoComment(syntax: CommentSyntax, rng: Random): string {
  return syntax.open + rng.pick(TODO_MESSAGES) + syntax.close
}

// ---------------------------------------------------------------- mutations

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'export', 'default', 'from', 'if', 'else', 'for', 'while',
  'class', 'new', 'this', 'true', 'false', 'null', 'undefined', 'async', 'await', 'def', 'self', 'None', 'True',
  'False', 'in', 'is', 'not', 'and', 'or', 'try', 'catch', 'except', 'finally', 'with', 'as', 'typeof', 'void',
  'public', 'private', 'protected', 'static', 'interface', 'type', 'enum', 'extends', 'implements', 'lambda',
  'yield', 'break', 'continue', 'switch', 'case', 'throw', 'raise', 'pass', 'elif', 'print', 'use', 'mut', 'pub', 'fn'
])

const SYNONYM_PAIRS: Array<[string, string]> = [
  ['data', 'items'], ['value', 'val'], ['result', 'res'], ['index', 'idx'], ['count', 'total'], ['user', 'usr'],
  ['error', 'err'], ['response', 'resp'], ['request', 'req'], ['message', 'msg'], ['button', 'btn'], ['element', 'el'],
  ['event', 'evt'], ['callback', 'cb'], ['config', 'cfg'], ['handler', 'handle'], ['params', 'args'], ['state', 'store'],
  ['items', 'list'], ['name', 'title'], ['width', 'size'], ['delay', 'timeout'], ['words', 'tokens'], ['title', 'label'],
  ['todo', 'task'], ['todos', 'tasks'], ['draft', 'input'], ['remaining', 'left'], ['plans', 'tiers'], ['price', 'cost'],
  ['features', 'perks'], ['counts', 'freq'], ['parser', 'ap'], ['file', 'path'], ['attempt', 'tries'], ['operation', 'fn'],
  ['yearly', 'annual'], ['feature', 'perk'], ['plan', 'tier'], ['port', 'host'], ['lastError', 'error'], ['wait', 'ms']
]
const SYNONYMS = new Map<string, string>()
for (const [a, b] of SYNONYM_PAIRS) {
  if (!SYNONYMS.has(a)) SYNONYMS.set(a, b)
  if (!SYNONYMS.has(b)) SYNONYMS.set(b, a)
}

const OPERATOR_SWAPS: Record<string, string> = {
  '===': '==', '!==': '!=', '<=': '<', '>=': '>', '&&': '||', '||': '&&', '==': '===', '!=': '!=='
}

interface TokenSpan {
  a: number
  b: number
  text: string
}

function mutableTokens(content: string): TokenSpan[] {
  const out: TokenSpan[] = []
  const re = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|===|!==|==|!=|<=|>=|&&|\|\|/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    const text = m[0]
    if (/^[A-Za-z_$]/.test(text) && (text.length < 3 || KEYWORDS.has(text))) continue
    // Stay out of string literals: an odd number of quotes before the token means we're inside one.
    const before = content.slice(0, m.index)
    if (((before.match(/"/g)?.length ?? 0) % 2) + ((before.match(/'/g)?.length ?? 0) % 2) + ((before.match(/`/g)?.length ?? 0) % 2)) continue
    out.push({ a: m.index, b: m.index + text.length, text })
  }
  return out
}

function capitalizeLike(model: string, word: string): string {
  return model[0] === model[0].toUpperCase() && model[0] !== model[0].toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word
}

/** A believable wrong version of a single token, or null. */
export function mutateToken(tok: string, rng: Random): string | null {
  if (OPERATOR_SWAPS[tok]) return OPERATOR_SWAPS[tok]
  if (/^\d/.test(tok)) {
    const n = Number(tok)
    if (!Number.isFinite(n)) return null
    const alt = rng.chance(0.5) || n === 0 ? n + 1 : n - 1
    return String(tok.includes('.') ? alt.toFixed(tok.split('.')[1].length) : alt)
  }
  const syn = SYNONYMS.get(tok) ?? SYNONYMS.get(tok.toLowerCase())
  if (syn && rng.chance(0.7)) return capitalizeLike(tok, syn)
  const roll = rng.next()
  if (roll < 0.3 && tok.length >= 5) return tok.slice(0, -rng.int(1, 2)) // stopped short
  if (roll < 0.55) return tok.endsWith('s') ? tok.slice(0, -1) : tok + 's' // plural slip
  if (roll < 0.8 && tok.length >= 4) {
    const i = rng.int(1, tok.length - 3)
    return tok.slice(0, i) + tok[i + 1] + tok[i] + tok.slice(i + 2) // swapped letters
  }
  return syn ? capitalizeLike(tok, syn) : null
}

export interface TokenMutation {
  a: number
  b: number
  orig: string
  wrong: string
}

/** One token of `content` replaced by a plausible wrong version (safe to fix mid-line later). */
export function findTokenMutation(content: string, rng: Random): TokenMutation | null {
  const tokens = mutableTokens(content)
  for (let tries = 0; tries < 4 && tokens.length; tries++) {
    const t = rng.pick(tokens)
    const wrong = mutateToken(t.text, rng)
    if (wrong && wrong !== t.text && isSafeInsert(wrong) && isSafeInsert(t.text)) return { a: t.a, b: t.b, orig: t.text, wrong }
  }
  return null
}

/** A first-draft version of a line with one or two tokens different, or null. */
export function mutateLine(content: string, rng: Random): string | null {
  const tokens = mutableTokens(content)
  if (!tokens.length) return null
  const picks = new Set<TokenSpan>()
  const n = tokens.length > 3 && rng.chance(0.4) ? 2 : 1
  while (picks.size < n) picks.add(rng.pick(tokens))
  let out = content
  for (const t of [...picks].sort((x, y) => y.a - x.a)) {
    const wrong = mutateToken(t.text, rng)
    if (wrong) out = out.slice(0, t.a) + wrong + out.slice(t.b)
  }
  return out !== content ? out : null
}

// -------------------------------------------------------------- line diffs

export interface EditRegion {
  /** Range in the OLD line to replace. */
  a: number
  b: number
  text: string
}

export interface LineEdit {
  regions: EditRegion[]
  /** Characters of the old line that survive unchanged. */
  common: number
}

const TOKEN_RE = /[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g

export function applyRegions(old: string, regions: EditRegion[]): string {
  let out = old
  for (const r of [...regions].sort((x, y) => y.a - x.a)) out = out.slice(0, r.a) + r.text + out.slice(r.b)
  return out
}

/**
 * Minimal token-level edit turning `old` into `next`, the way a person edits a
 * pasted copy: change the few tokens that differ. Returns null when the edit
 * would require typing brackets/quotes mid-line or is too scattered.
 */
export function lineEdit(old: string, next: string): LineEdit | null {
  if (old === next) return { regions: [], common: old.length }
  if (hasSurrogates(old) || hasSurrogates(next)) return null
  const ta = old.match(TOKEN_RE) ?? []
  const tb = next.match(TOKEN_RE) ?? []
  let regions: EditRegion[] = []

  if (ta.length === tb.length) {
    let pos = 0
    for (let i = 0; i < ta.length; i++) {
      if (ta[i] !== tb[i]) {
        const prev = regions[regions.length - 1]
        if (prev && prev.b === pos) {
          prev.b = pos + ta[i].length
          prev.text += tb[i]
        } else regions.push({ a: pos, b: pos + ta[i].length, text: tb[i] })
      }
      pos += ta[i].length
    }
  }
  if (!regions.length || regions.length > 4 || applyRegions(old, regions) !== next) {
    let p = 0
    while (p < old.length && p < next.length && old[p] === next[p]) p++
    let s = 0
    while (s < old.length - p && s < next.length - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++
    regions = [{ a: p, b: old.length - s, text: next.slice(p, next.length - s) }]
  }
  if (!regions.every((r) => isSafeInsert(r.text))) return null
  const removed = regions.reduce((n, r) => n + (r.b - r.a), 0)
  return { regions, common: old.length - removed }
}
