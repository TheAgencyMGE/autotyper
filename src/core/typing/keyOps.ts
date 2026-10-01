import type { TypeAction } from './engine'
import { isIdentChar } from './keyboard'

/**
 * Low-level operations understood by the typing controller / automation backends.
 * `key` uses a small portable vocabulary: enter, backspace, tab, esc, delete,
 * home, end, up, down, left, right, plus "shift+" / "ctrl+" modifiers.
 * `paste` means: put `text` on the clipboard and press Ctrl+V.
 */
export type KeyOp = { type: 'text'; text: string } | { type: 'key'; key: string } | { type: 'paste'; text: string }

export interface TranslatorOptions {
  /**
   * Editor-safe mode neutralises code-editor conveniences that would otherwise
   * corrupt the typed text: auto-closing brackets/quotes/tags, auto-indent on
   * Enter, and IntelliSense accepting a suggestion on Enter, a commit
   * character or an arrow key.
   */
  editorSafe: boolean
}

/**
 * "Clear to end of line" that is a no-op when nothing follows the caret.
 * A bare Shift+End, Delete would join the next line when the selection is empty;
 * typing a space (which replaces any selection) then Backspace never can.
 */
const CLEAR_TO_EOL: KeyOp[] = [
  { type: 'key', key: 'shift+end' },
  { type: 'text', text: ' ' },
  { type: 'key', key: 'backspace' }
]

/** Remove whatever indentation the editor auto-inserted on the new line. */
const CLEAR_AUTO_INDENT: KeyOp[] = [
  { type: 'key', key: 'shift+home' },
  { type: 'text', text: ' ' },
  { type: 'key', key: 'backspace' }
]

const ESC: KeyOp = { type: 'key', key: 'esc' }

export class KeyOpTranslator {
  private prev = '\n'
  /** True when the last thing sent was typed text (a suggestion widget may be open). */
  private afterText = false

  constructor(private readonly opts: TranslatorOptions) {}

  toOps(action: TypeAction): KeyOp[] {
    const safe = this.opts.editorSafe
    switch (action.kind) {
      case 'text':
        this.afterText = true
        return this.textOps(action.text)
      case 'backspace':
        // The suggestion widget may reappear after a backspace; treat as mid-word.
        this.prev = 'a'
        this.afterText = true
        return [{ type: 'key', key: 'backspace' }]
      case 'newline': {
        const ops: KeyOp[] = safe ? [ESC, ...CLEAR_TO_EOL, { type: 'key', key: 'enter' }, ...CLEAR_AUTO_INDENT] : [{ type: 'key', key: 'enter' }]
        if (action.indent) ops.push({ type: 'text', text: action.indent })
        this.prev = action.indent ? action.indent[action.indent.length - 1] : '\n'
        this.afterText = true
        return ops
      }
      case 'key': {
        // Arrow keys would move inside an open suggestion list; dismiss it first. Editors open that
        // list asynchronously after typing (even after a Backspace), so the Esc is sent with the key
        // itself, after the key's own delay. Plain moves always get one; selection keys only at the
        // start of a selection, because Esc also cancels a selection.
        const selecting = action.key.startsWith('shift+')
        const ops: KeyOp[] = safe && (!selecting || this.afterText) ? [ESC] : []
        ops.push({ type: 'key', key: action.key })
        this.afterText = false
        this.prev = '\n'
        return ops
      }
      case 'clearEol':
        // The space + Backspace inside the clear can reopen suggestions, so the next key must dismiss them again.
        this.afterText = true
        return safe ? [ESC, ...CLEAR_TO_EOL] : []
      case 'copy':
        this.afterText = false
        return [{ type: 'key', key: 'ctrl+c' }]
      case 'paste':
        this.afterText = true
        this.prev = action.text[action.text.length - 1] ?? this.prev
        return [{ type: 'paste', text: action.text }]
      case 'finish':
        return safe ? [ESC, ...CLEAR_TO_EOL] : []
      case 'pause':
        return []
    }
  }

  private textOps(text: string): KeyOp[] {
    if (!this.opts.editorSafe) {
      this.prev = text[text.length - 1] ?? this.prev
      return [{ type: 'text', text }]
    }
    // Dismiss IntelliSense before any character that could commit a suggestion
    // (".", "(", ";", space...) when it follows an identifier.
    const ops: KeyOp[] = []
    let run = ''
    for (const ch of text) {
      if (!isIdentChar(ch) && isIdentChar(this.prev)) {
        if (run) ops.push({ type: 'text', text: run })
        run = ''
        ops.push(ESC)
      }
      run += ch
      this.prev = ch
    }
    if (run) ops.push({ type: 'text', text: run })
    return ops
  }
}
