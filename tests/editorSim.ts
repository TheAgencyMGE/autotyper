import type { KeyOp } from '../src/core/typing/keyOps'

/**
 * A deliberately "helpful" editor model approximating VS Code defaults:
 * auto-closing brackets and quotes, overtyping auto-inserted closers,
 * auto-indent on Enter (and splitting `{|}` onto three lines), pair-deleting
 * backspace, auto-surround of selections, and VS Code's Home behaviour.
 */
interface Cell {
  ch: string
  auto: boolean
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' }
const CLOSERS = new Set([')', ']', '}', '"', "'", '`'])
const QUOTES = new Set(['"', "'", '`'])

export class HelpfulEditor {
  buf: Cell[] = []
  cursor = 0
  anchor: number | null = null

  get text(): string {
    return this.buf.map((c) => c.ch).join('')
  }

  apply(ops: KeyOp[]): void {
    for (const op of ops) {
      if (op.type === 'text') for (const ch of op.text) this.typeChar(ch)
      else if (op.type === 'paste') this.paste(op.text)
      else this.key(op.key)
    }
  }

  private lineStart(i = this.cursor): number {
    let s = i
    while (s > 0 && this.buf[s - 1].ch !== '\n') s--
    return s
  }

  private lineEnd(i = this.cursor): number {
    let e = i
    while (e < this.buf.length && this.buf[e].ch !== '\n') e++
    return e
  }

  private deleteSelection(): boolean {
    if (this.anchor === null || this.anchor === this.cursor) {
      this.anchor = null
      return false
    }
    const a = Math.min(this.anchor, this.cursor)
    const b = Math.max(this.anchor, this.cursor)
    this.buf.splice(a, b - a)
    this.cursor = a
    this.anchor = null
    return true
  }

  private insert(s: string, auto = false): void {
    this.buf.splice(this.cursor, 0, ...s.split('').map((ch) => ({ ch, auto })))
    this.cursor += s.length
  }

  /**
   * An IntelliSense-style suggestion list: opens after typing an identifier
   * character or a Backspace, and while open it swallows Up/Down (they move
   * through the list, not the caret). Esc or any non-identifier char closes it.
   */
  suggestOpen = false

  private typeChar(ch: string): void {
    this.suggestOpen = /[A-Za-z0-9_$]/.test(ch)
    if (this.anchor !== null && this.anchor !== this.cursor && PAIRS[ch]) {
      // Auto-surround the selection.
      const a = Math.min(this.anchor, this.cursor)
      const b = Math.max(this.anchor, this.cursor)
      const inner = this.buf.slice(a, b)
      this.buf.splice(a, b - a, { ch, auto: false }, ...inner, { ch: PAIRS[ch], auto: false })
      this.cursor = b + 2
      this.anchor = null
      return
    }
    this.deleteSelection()
    const next = this.buf[this.cursor]
    const prev = this.buf[this.cursor - 1]
    if (CLOSERS.has(ch) && next && next.ch === ch && next.auto) {
      next.auto = false
      this.cursor++
      return
    }
    const nextOk = !next || /\s/.test(next.ch) || CLOSERS.has(next.ch) || next.ch === ';' || next.ch === ','
    if (PAIRS[ch] && nextOk) {
      const prevIsWord = !!prev && /[A-Za-z0-9_]/.test(prev.ch)
      if (!QUOTES.has(ch) || !prevIsWord) {
        this.insert(ch)
        this.buf.splice(this.cursor, 0, { ch: PAIRS[ch], auto: true })
        return
      }
    }
    this.insert(ch)
  }

  private key(key: string): void {
    switch (key) {
      case 'esc':
        this.suggestOpen = false
        this.anchor = null
        return
      case 'enter': {
        this.deleteSelection()
        const ls = this.lineStart()
        const indent = /^[ \t]*/.exec(this.buf.slice(ls, this.lineEnd()).map((c) => c.ch).join(''))![0]
        const before = this.buf[this.cursor - 1]?.ch
        const after = this.buf[this.cursor]?.ch
        const opens = before === '{' || before === '[' || before === '(' || before === ':'
        this.insert('\n' + indent + (opens ? '  ' : ''))
        if (opens && after && PAIRS[before!] === after) {
          const keep = this.cursor
          this.insert('\n' + indent)
          this.cursor = keep
        }
        return
      }
      case 'backspace': {
        this.suggestOpen = true
        if (this.deleteSelection()) return
        if (this.cursor === 0) return
        const prev = this.buf[this.cursor - 1]
        const next = this.buf[this.cursor]
        if (next && next.auto && PAIRS[prev.ch] === next.ch) this.buf.splice(this.cursor, 1)
        this.buf.splice(this.cursor - 1, 1)
        this.cursor--
        return
      }
      case 'shift+end':
        this.anchor = this.anchor ?? this.cursor
        this.cursor = this.lineEnd()
        return
      case 'shift+home': {
        this.anchor = this.anchor ?? this.cursor
        const ls = this.lineStart()
        const le = this.lineEnd()
        let fnw = ls
        while (fnw < le && /[ \t]/.test(this.buf[fnw].ch)) fnw++
        this.cursor = this.cursor === fnw ? ls : fnw
        return
      }
      case 'ctrl+c':
        this.clipboard = this.selectionText()
        return
      default: {
        const shift = key.startsWith('shift+')
        const base = shift ? key.slice(6) : key
        if (!['up', 'down', 'left', 'right', 'end'].includes(base)) throw new Error(`HelpfulEditor: unsupported key ${key}`)
        if (this.suggestOpen && (base === 'up' || base === 'down')) return // moved within the suggestion list
        this.suggestOpen = false
        if (shift) this.anchor = this.anchor ?? this.cursor
        else this.anchor = null
        this.move(base)
        return
      }
    }
  }

  clipboard = ''

  private selectionText(): string {
    if (this.anchor === null) return ''
    const a = Math.min(this.anchor, this.cursor)
    const b = Math.max(this.anchor, this.cursor)
    return this.buf.slice(a, b).map((c) => c.ch).join('')
  }

  private move(dir: string): void {
    const ls = this.lineStart()
    const col = this.cursor - ls
    switch (dir) {
      case 'end':
        this.cursor = this.lineEnd()
        return
      case 'left':
        if (this.cursor > 0) this.cursor--
        return
      case 'right':
        if (this.cursor < this.buf.length) this.cursor++
        return
      case 'up': {
        if (ls === 0) {
          this.cursor = 0
          return
        }
        const ps = this.lineStart(ls - 1)
        this.cursor = Math.min(ps + col, ls - 1)
        return
      }
      case 'down': {
        const le = this.lineEnd()
        if (le >= this.buf.length) {
          this.cursor = le
          return
        }
        const ns = le + 1
        this.cursor = Math.min(ns + col, this.lineEnd(ns))
        return
      }
    }
  }

  /** Pasting inserts text verbatim: no auto-closing, no auto-indent. */
  paste(text: string): void {
    if (this.anchor !== null && this.anchor !== this.cursor) {
      const a = Math.min(this.anchor, this.cursor)
      const b = Math.max(this.anchor, this.cursor)
      this.buf.splice(a, b - a)
      this.cursor = a
    }
    this.anchor = null
    this.buf.splice(this.cursor, 0, ...text.split('').map((ch) => ({ ch, auto: false })))
    this.cursor += text.length
  }
}
