/**
 * Keyboard knowledge used by the humanizer.
 *
 * Key-distance timing, the neighbour-key error model and the word-difficulty
 * factors are adapted from HumanTyping by Lax3n (MIT License):
 * https://github.com/Lax3n/HumanTyping
 */

// Physical QWERTY grid (unshifted legends), including the number row and punctuation.
const GRID = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./']

// Shifted characters live on the same physical key as their base legend.
const SHIFT_BASE: Record<string, string> = {
  '~': '`', '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/'
}

const POS: Record<string, [number, number]> = (() => {
  const map: Record<string, [number, number]> = {}
  GRID.forEach((row, r) => [...row].forEach((ch, c) => (map[ch] = [r, c])))
  return map
})()

function keyOf(ch: string): string {
  const lower = ch.toLowerCase()
  return SHIFT_BASE[lower] ?? lower
}

/** Euclidean distance between two keys in key-widths. Space (thumb) counts as close to everything. */
export function keyDistance(a: string, b: string): number {
  if (!a || !b) return 4
  if (a === ' ' || b === ' ') return 1.5
  const pa = POS[keyOf(a)]
  const pb = POS[keyOf(b)]
  if (!pa || !pb) return 4
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1])
}

/**
 * Physically adjacent keys usable as a typo for `ch`, preserving case.
 * Restricted to letters and digits: brackets/quotes would trigger editor
 * auto-closing and are never produced as a slip.
 */
export function typoNeighbors(ch: string): string[] {
  const p = POS[keyOf(ch)]
  if (!p) return []
  const out: string[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const k = GRID[p[0] + dr]?.[p[1] + dc]
      if (k && /[a-z0-9]/.test(k)) out.push(k)
    }
  }
  const upper = ch !== ch.toLowerCase()
  return upper ? out.map((k) => k.toUpperCase()) : out
}

export const isLetter = (ch: string): boolean => /^[A-Za-z]$/.test(ch)
export const isIdentChar = (ch: string): boolean => /^[A-Za-z0-9_$]$/.test(ch)
export const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9'

/** Characters that need Shift on a US layout; they are measurably slower to type. */
const SHIFTED = new Set('~!@#$%^&*()_+{}|:"<>?')
export const needsShift = (ch: string): boolean => SHIFTED.has(ch) || (isLetter(ch) && ch !== ch.toLowerCase())

const BRACKETS = new Set('()[]{}<>')
export const isBracket = (ch: string): boolean => BRACKETS.has(ch)

/** Very common English/code bigrams are typed noticeably faster (motor memory). */
const FAST_BIGRAMS = new Set([
  'th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'st', 'es', 'or', 'te', 'of', 'ed', 'is', 'it',
  'al', 'ar', 'nt', 'to', 'ng', 'se', 'ou', 'le', 'co', 'ns', 'io', 'ti', 'ur', 'et', 'ra', 'de', 'ct', 'fu',
  'un', 'nc', 'rn', 'tu', 'im', 'mp', 'po', 'rt', 'ex', 'xp', 'ss', 'as', 'cl', 'ha', 've', 'me', 'hi', 'ri',
  'ro', 'ic', 'ne', 'ea', 'ce'
])
export const isFastBigram = (a: string, b: string): boolean => FAST_BIGRAMS.has((a + b).toLowerCase())

/** Words a programmer types from muscle memory: English staples plus language keywords. */
const COMMON_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'it', 'for', 'not', 'on', 'with', 'as', 'you', 'do',
  'at', 'this', 'but', 'by', 'from', 'they', 'we', 'or', 'an', 'will', 'my', 'one', 'all', 'if', 'get', 'set', 'new',
  'const', 'let', 'var', 'function', 'return', 'import', 'export', 'default', 'else', 'while', 'class', 'true', 'false',
  'null', 'undefined', 'async', 'await', 'def', 'self', 'print', 'is', 'None', 'True', 'False', 'public', 'private',
  'static', 'void', 'int', 'string', 'try', 'catch', 'throw', 'typeof', 'console', 'log', 'props', 'div', 'span',
  'className', 'onClick', 'useState', 'useEffect', 'map', 'length', 'value', 'type', 'key', 'id', 'name', 'data'
])

export type WordDifficulty = 'common' | 'normal' | 'complex'

export function wordDifficulty(word: string): WordDifficulty {
  if (!word) return 'normal'
  if (COMMON_WORDS.has(word) || COMMON_WORDS.has(word.toLowerCase())) return 'common'
  if (word.length > 8 || /[zxqj]/i.test(word)) return 'complex'
  return 'normal'
}
