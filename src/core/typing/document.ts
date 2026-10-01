/**
 * A minimal plain-text editor model: lines, a caret and an optional selection.
 *
 * The humanizer drives this model while planning so that every navigation
 * (arrow counts, selections, pastes) is computed against the exact document
 * state, and so a finished plan can be replayed to prove it reproduces the
 * source text byte-for-byte before a single real key is pressed.
 *
 * Editor conveniences (auto-closing, auto-indent) are not modelled here; the
 * editor-safe translator neutralises them so the real editor matches this model.
 */
export type NavKey = 'up' | 'down' | 'left' | 'right' | 'end' | 'shift+up' | 'shift+down' | 'shift+left' | 'shift+end'

interface Pos {
  line: number
  col: number
}

export class DocModel {
  lines: string[] = ['']
  line = 0
  col = 0
  anchor: Pos | null = null

  get text(): string {
    return this.lines.join('\n')
  }

  get lastLine(): number {
    return this.lines.length - 1
  }

  get hasSelection(): boolean {
    return !!this.anchor && (this.anchor.line !== this.line || this.anchor.col !== this.col)
  }

  get atLineEnd(): boolean {
    return this.col === this.lines[this.line].length
  }

  insert(text: string): void {
    this.deleteSelection()
    const cur = this.lines[this.line]
    const before = cur.slice(0, this.col)
    const after = cur.slice(this.col)
    const parts = text.split('\n')
    if (parts.length === 1) {
      this.lines[this.line] = before + text + after
      this.col += text.length
      return
    }
    const last = parts[parts.length - 1]
    const newLines = [before + parts[0], ...parts.slice(1, -1), last + after]
    this.lines.splice(this.line, 1, ...newLines)
    this.line += parts.length - 1
    this.col = last.length
  }

  newline(indent: string): void {
    this.insert('\n' + indent)
  }

  backspace(): void {
    if (this.deleteSelection()) return
    if (this.col > 0) {
      const cur = this.lines[this.line]
      this.lines[this.line] = cur.slice(0, this.col - 1) + cur.slice(this.col)
      this.col--
    } else if (this.line > 0) {
      const prevLen = this.lines[this.line - 1].length
      this.lines[this.line - 1] += this.lines[this.line]
      this.lines.splice(this.line, 1)
      this.line--
      this.col = prevLen
    }
  }

  /** Mirrors the translator's "clear to end of line" (drops auto-inserted closers in real editors). */
  clearEol(): void {
    this.anchor = null
    this.lines[this.line] = this.lines[this.line].slice(0, this.col)
  }

  key(k: NavKey): void {
    const shift = k.startsWith('shift+')
    const base = shift ? k.slice(6) : k
    if (shift) this.anchor = this.anchor ?? { line: this.line, col: this.col }
    else this.anchor = null
    switch (base) {
      case 'up':
        if (this.line > 0) {
          this.line--
          this.col = Math.min(this.col, this.lines[this.line].length)
        } else this.col = 0
        break
      case 'down':
        if (this.line < this.lastLine) {
          this.line++
          this.col = Math.min(this.col, this.lines[this.line].length)
        } else this.col = this.lines[this.line].length
        break
      case 'left':
        if (this.col > 0) this.col--
        else if (this.line > 0) {
          this.line--
          this.col = this.lines[this.line].length
        }
        break
      case 'right':
        if (this.col < this.lines[this.line].length) this.col++
        else if (this.line < this.lastLine) {
          this.line++
          this.col = 0
        }
        break
      case 'end':
        this.col = this.lines[this.line].length
        break
    }
    if (shift && !this.hasSelection) this.anchor = null
  }

  private deleteSelection(): boolean {
    if (!this.anchor) return false
    const a = this.anchor
    this.anchor = null
    const [s, e] = compare(a, { line: this.line, col: this.col }) <= 0 ? [a, { line: this.line, col: this.col }] : [{ line: this.line, col: this.col }, a]
    if (s.line === e.line && s.col === e.col) return false
    const head = this.lines[s.line].slice(0, s.col)
    const tail = this.lines[e.line].slice(e.col)
    this.lines.splice(s.line, e.line - s.line + 1, head + tail)
    this.line = s.line
    this.col = s.col
    return true
  }
}

function compare(a: Pos, b: Pos): number {
  return a.line - b.line || a.col - b.col
}
