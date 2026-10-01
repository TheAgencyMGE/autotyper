import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { Check, Copy, Download, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import type { CodeLanguage } from '@core/codegen/language'

interface Props {
  /** 'code' for AutoCoder; 'text' shows a document page for AutoWriter. */
  variant: 'code' | 'text'
  code: string
  onChange: (code: string) => void
  language: CodeLanguage
  fileLabel: string
  editable: boolean
  onToggleEdit: () => void
  generating: boolean
  justFinished: boolean
  locked: boolean
  typedChars: number
  showTyped: boolean
  onCopy: () => void
  onRegenerate: () => void
  onClear: () => void
  onSave: () => void
  canRegenerate: boolean
  /** Ranges to mark as "reads like AI" (AutoWriter). */
  highlights?: Array<{ start: number; end: number; why: string }>
}

// ---- A paper-and-ink editor theme: restrained colour, italic comments.

const paperTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#23211d', fontSize: '13.5px', height: '100%' },
    '.cm-scroller': { fontFamily: "'IBM Plex Mono', Consolas, monospace", lineHeight: '1.75' },
    '.cm-content': { padding: '20px 0 40px', caretColor: '#2a3fb0' },
    '.cm-line': { padding: '0 28px 0 8px' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#bdb6a6', paddingLeft: '16px' },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '28px', fontSize: '12px' },
    '.cm-activeLine': { backgroundColor: 'rgba(42, 63, 176, 0.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#6f6a60' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(42, 63, 176, 0.14) !important' },
    '.cm-cursor': { borderLeftColor: '#2a3fb0', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(42, 63, 176, 0.1)', outline: 'none' }
  },
  { dark: false }
)

const pageTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#23211d', height: '100%' },
    '.cm-scroller': { fontFamily: "'Newsreader Variable', Georgia, serif", fontSize: '18px', lineHeight: '1.7' },
    '.cm-content': { padding: '40px 0 60px', maxWidth: '680px', margin: '0 auto', caretColor: '#2a3fb0' },
    '.cm-line': { padding: '0 40px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(42, 63, 176, 0.14) !important' },
    '.cm-cursor': { borderLeftColor: '#2a3fb0', borderLeftWidth: '2px' }
  },
  { dark: false }
)

const inkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: '#2a3fb0' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#4f6b3a' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#9a9486', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#9a5b2e' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: '#23211d', fontWeight: '500' },
  { tag: [t.typeName, t.className, t.tagName], color: '#6b4f8a' },
  { tag: [t.attributeName, t.propertyName], color: '#7a5c2e' },
  { tag: [t.punctuation, t.bracket, t.operator], color: '#6f6a60' }
])

// ---- "typed so far" highlight: a wash over [0, pos) plus a caret.

// ---- "reads like AI" marks for AutoWriter.

const setTells = StateEffect.define<Array<{ start: number; end: number; why: string }>>()

const tellsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setTells)) {
        const len = tr.state.doc.length
        const b = new RangeSetBuilder<Decoration>()
        for (const t of e.value) {
          if (t.end <= len && t.start < t.end) b.add(t.start, t.end, Decoration.mark({ class: 'cm-tell', attributes: { title: t.why } }))
        }
        return b.finish()
      }
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

const setTyped = StateEffect.define<number>()

class CaretWidget extends WidgetType {
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-typing-caret'
    return el
  }
}

const typedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setTyped)) {
        const pos = Math.min(e.value, tr.state.doc.length)
        if (pos <= 0) return Decoration.none
        const b = new RangeSetBuilder<Decoration>()
        b.add(0, pos, Decoration.mark({ class: 'cm-typed' }))
        b.add(pos, pos, Decoration.widget({ widget: new CaretWidget(), side: 1 }))
        return b.finish()
      }
    }
    return tr.docChanged ? Decoration.none : deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

function languageExtension(lang: CodeLanguage): Extension[] {
  switch (lang) {
    case 'javascript':
      return [javascript()]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'typescript':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })]
    case 'python':
      return [python()]
    case 'html':
      return [html()]
    case 'css':
      return [css()]
    case 'json':
      return [json()]
    default:
      return []
  }
}

const LANGUAGE_NAME: Record<CodeLanguage, string> = {
  javascript: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  typescript: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  markdown: 'Markdown',
  text: 'Plain text'
}

export function CodeSheet(p: Props) {
  const ref = useRef<ReactCodeMirrorRef>(null)
  const isText = p.variant === 'text'
  const extensions = useMemo(
    () => (isText ? [typedField, tellsField, pageTheme, EditorView.lineWrapping] : [...languageExtension(p.language), syntaxHighlighting(inkHighlight), typedField, paperTheme, EditorView.lineWrapping]),
    [p.language, isText]
  )
  const lines = p.code ? p.code.split('\n').length : 0
  const words = p.code.trim() ? p.code.trim().split(/\s+/).length : 0
  const readOnly = !p.editable || p.locked || p.generating

  // The editor view is created after the first render; re-run the decorations once it exists.
  const [ready, setReady] = useState(0)

  useEffect(() => {
    const view = ref.current?.view
    if (!view || !isText) return
    view.dispatch({ effects: setTells.of(p.highlights ?? []) })
  }, [p.highlights, p.code, isText, ready])

  useEffect(() => {
    const view = ref.current?.view
    if (!view) return
    const pos = p.showTyped ? p.typedChars : 0
    view.dispatch({
      effects: [setTyped.of(pos), ...(p.showTyped && pos > 0 ? [EditorView.scrollIntoView(Math.min(pos, view.state.doc.length), { y: 'center' })] : [])]
    })
  }, [p.typedChars, p.showTyped, p.code, ready])

  const [base, ext] = splitName(p.fileLabel)

  return (
    <section className={`sheet ${isText ? 'page' : ''}`} aria-label={isText ? 'Your text' : 'Your code'}>
      <header className="sheet-head">
        <span className="sheet-file">
          {base}
          <span>{ext}</span>
        </span>
        <button className={`btn btn-quiet ${p.editable ? 'is-on' : ''}`} onClick={p.onToggleEdit} disabled={p.locked || p.generating || !p.code} aria-pressed={p.editable}>
          {p.editable ? <Check /> : <Pencil />} {p.editable ? 'Done editing' : 'Edit'}
        </button>
        <button className="btn btn-quiet" onClick={p.onCopy} disabled={!p.code}>
          <Copy /> Copy
        </button>
        <button className="btn btn-quiet" onClick={p.onSave} disabled={!p.code || p.generating}>
          <Download /> Save
        </button>
        {p.canRegenerate && (
          <button className="btn btn-quiet" onClick={p.onRegenerate} disabled={p.locked || p.generating}>
            <RotateCcw /> Regenerate
          </button>
        )}
        <button className="btn btn-quiet btn-icon" onClick={p.onClear} disabled={!p.code || p.locked || p.generating} title="Clear the code" aria-label="Clear the code">
          <Trash2 />
        </button>
      </header>
      <div className="sheet-body">
        {p.generating && <div className="generating-line" />}
        <CodeMirror
          ref={ref}
          onCreateEditor={() => setReady((n) => n + 1)}
          value={p.code}
          onChange={p.onChange}
          theme="none"
          extensions={extensions}
          readOnly={readOnly}
          editable={!readOnly}
          basicSetup={{
            lineNumbers: !isText,
            foldGutter: false,
            highlightActiveLine: !readOnly && !isText,
            highlightActiveLineGutter: !readOnly && !isText,
            autocompletion: false,
            closeBrackets: !isText,
            bracketMatching: !isText,
            indentOnInput: !isText
          }}
          height="100%"
          style={{ height: '100%' }}
        />
        {!p.code && !p.generating && <div className="sheet-empty">{isText ? 'Your text will appear here.' : 'The code will appear here.'}</div>}
      </div>
      <footer className="sheet-foot">
        {isText ? (
          <span className="num">{words.toLocaleString()} words</span>
        ) : (
          <>
            <span>{LANGUAGE_NAME[p.language]}</span>
            <span className="num">{lines.toLocaleString()} lines</span>
          </>
        )}
        <span className="num">{p.code.length.toLocaleString()} characters</span>
        <span className={`status ${p.justFinished ? 'just-done' : ''}`}>
          {p.generating ? 'Writing…' : p.editable ? 'Editing' : p.justFinished ? 'Ready' : ''}
        </span>
      </footer>
    </section>
  )
}

function splitName(name: string): [string, string] {
  const i = name.lastIndexOf('.')
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, '']
}
