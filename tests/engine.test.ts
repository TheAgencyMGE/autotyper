import { describe, expect, it } from 'vitest'
import { HumanTypingEngine, estimateDurationMs, replayPlan, type TypeAction } from '../src/core/typing/engine'
import { KeyOpTranslator } from '../src/core/typing/keyOps'
import { lineEdit, applyRegions } from '../src/core/typing/mutations'
import { PRESETS } from '../src/core/typing/profiles'
import { TEMPLATES } from '../src/main/codegen/templates'
import type { HumanizationProfile } from '../src/shared/types'
import { HelpfulEditor } from './editorSim'

const JS = `import React, { useState } from 'react'

// Simple counter component
export default function Counter({ start = 0 }) {
  const [count, setCount] = useState(start)
  const user = "Ryan";
  const items = [1, 2, 3].map((x) => x * 2)

  function handleClick() {
    if (count > 10) {
      console.log(\`Too many: \${count}\`)
      return
    }
    setCount(count + 1)
  }

  function handleReset() {
    if (count > 0) {
      console.log(\`Resetting: \${count}\`)
      setCount(0)
    }
  }

  return (
    <button onClick={handleClick} className="btn">
      Clicked {count} times, user: {user}
    </button>
  )
}
`

const PY = `def fibonacci(n: int) -> list[int]:
    """Return the first n Fibonacci numbers."""
    result = [0, 1]
    while len(result) < n:
        result.append(result[-1] + result[-2])
    return result[:n]


def squares(n: int) -> list[int]:
    """Return the first n square numbers."""
    result = []
    for i in range(n):
        result.append(i * i)
    return result


if __name__ == "__main__":
    print({"values": fibonacci(10)})
`

const ALL = [JS, PY, ...TEMPLATES.map((t) => t.code)]
const HUMAN_PRESETS: HumanizationProfile[] = [PRESETS.fast, PRESETS.normal, PRESETS.slow, PRESETS.veryHuman]
const MAX_REVISIONS: HumanizationProfile = { ...PRESETS.veryHuman, revisionRate: 1, mistakeRate: 0.04 }

function plan(text: string, profile: HumanizationProfile, seed: number, allowNavigation = true): TypeAction[] {
  return new HumanTypingEngine(profile, seed).plan(text, { allowNavigation })
}

function typeInto(text: string, profile: HumanizationProfile, seed: number, editorSafe: boolean): string {
  const editor = new HelpfulEditor()
  const tr = new KeyOpTranslator({ editorSafe })
  for (const a of plan(text, profile, seed, editorSafe)) editor.apply(tr.toOps(a))
  return editor.text
}

describe('HumanTypingEngine', () => {
  it('always reproduces the source exactly — typos, rewrites, pastes and TODOs included', () => {
    for (const profile of [PRESETS.instant, ...HUMAN_PRESETS, MAX_REVISIONS]) {
      for (const text of ALL) {
        for (let seed = 1; seed <= 12; seed++) expect(replayPlan(plan(text, profile, seed))).toBe(text)
      }
    }
  })

  it('never needs the linear fallback for realistic code', () => {
    let fallbacks = 0
    for (const text of ALL) {
      for (let seed = 1; seed <= 15; seed++) {
        const e = new HumanTypingEngine(MAX_REVISIONS, seed)
        e.plan(text, { allowNavigation: true })
        if (e.fellBack) fallbacks++
      }
    }
    expect(fallbacks).toBe(0)
  })

  it('performs every revision behaviour across a range of seeds', () => {
    const notes: string[] = []
    let pastes = 0
    for (const text of ALL) {
      for (let seed = 1; seed <= 20; seed++) {
        for (const a of plan(text, MAX_REVISIONS, seed)) {
          if (a.note) notes.push(a.note)
          if (a.kind === 'paste') pastes++
        }
      }
    }
    const has = (re: RegExp) => notes.some((n) => re.test(n))
    expect(pastes).toBeGreaterThan(0)
    expect(has(/TODO to come back/)).toBe(true)
    expect(has(/Going back to the TODO/)).toBe(true)
    expect(has(/going back to fix it/)).toBe(true)
    expect(has(/Scrapping that draft|rewriting it/)).toBe(true)
    expect(has(/False start/)).toBe(true)
    expect(has(/Re-reading/)).toBe(true)
  })

  it('types TODO comments in the right comment syntax, then removes them', () => {
    const typedTodo = (text: string) => {
      for (let seed = 1; seed <= 40; seed++) {
        const acts = plan(text, MAX_REVISIONS, seed)
        const typed = acts.filter((a) => a.kind === 'text' && a.tag === 'todo').map((a) => (a as { text: string }).text).join('')
        if (typed) return typed
      }
      return ''
    }
    expect(typedTodo(JS)).toMatch(/^\/\/ /)
    expect(typedTodo(PY)).toMatch(/^# /)
  })

  it('makes realistic slips at a bounded rate, including anticipation swaps', () => {
    const long = JS.repeat(4)
    let notices = 0
    let swaps = 0
    for (let seed = 1; seed <= 20; seed++) {
      const actions = plan(long, { ...PRESETS.veryHuman, revisionRate: 0 }, seed, false)
      notices += actions.filter((a) => a.kind === 'pause' && a.reason === 'notice').length
      for (let k = 1; k < actions.length; k++) {
        const a = actions[k - 1]
        const b = actions[k]
        if (a.kind === 'text' && b.kind === 'text' && a.mistake && b.mistake && a.text !== b.text) swaps++
      }
    }
    const perRun = notices / 20
    expect(perRun).toBeGreaterThan(1)
    expect(perRun).toBeLessThan(long.length / 30)
    expect(swaps).toBeGreaterThan(0)
  })

  it('never makes mistakes or revisions when disabled or instant', () => {
    const off = { ...PRESETS.normal, mistakeRate: 0, revisionRate: 0 }
    expect(plan(JS, off, 7).some((a) => a.kind === 'backspace' || a.kind === 'key')).toBe(false)
    expect(plan(JS, PRESETS.instant, 7).some((a) => a.kind === 'backspace' || a.kind === 'key')).toBe(false)
  })

  it('never navigates when navigation is not allowed', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(plan(JS, MAX_REVISIONS, seed, false).some((a) => a.kind === 'key' || a.kind === 'paste')).toBe(false)
    }
  })

  it('keeps every delay within bounds and instant at zero', () => {
    for (const a of plan(JS, PRESETS.veryHuman, 3)) {
      expect(a.delayMs).toBeGreaterThanOrEqual(0)
      expect(a.delayMs).toBeLessThanOrEqual(9000)
    }
    expect(estimateDurationMs(JS, PRESETS.instant)).toBe(0)
  })

  it('lands near the configured speed band', () => {
    const text = JS.repeat(4)
    const quiet = { ...PRESETS.normal, thinkingPauses: false, revisionRate: 0, pauseFrequency: 0 }
    const ms = estimateDurationMs(text, quiet)
    const wpm = text.length / 5 / (ms / 60000)
    expect(wpm).toBeGreaterThan(PRESETS.normal.minWpm * 0.5)
    expect(wpm).toBeLessThan(PRESETS.normal.maxWpm * 1.25)
    expect(estimateDurationMs(text, PRESETS.slow)).toBeGreaterThan(ms)
    expect(estimateDurationMs(text, PRESETS.fast)).toBeLessThan(ms)
  })

  it('tracks progress to the full length', () => {
    const actions = plan(PY, MAX_REVISIONS, 5)
    expect(actions[actions.length - 1].pos).toBe(PY.length)
    expect(actions[actions.length - 1].kind).toBe('finish')
    expect(Math.max(...actions.map((a) => a.pos))).toBeLessThanOrEqual(PY.length)
  })
})

describe('line edits for copy-paste', () => {
  it('edits only the differing tokens', () => {
    const e = lineEdit("app.get('/api/todos', (req, res) => {", "app.post('/api/todos', (req, res) => {")!
    expect(e.regions).toEqual([{ a: 4, b: 7, text: 'post' }])
    expect(applyRegions("app.get('/api/todos', (req, res) => {", e.regions)).toBe("app.post('/api/todos', (req, res) => {")
  })

  it('refuses edits that would type brackets or quotes mid-line', () => {
    expect(lineEdit('foo(a)', 'foo(a, "b")')).toBeNull()
  })
})

describe('KeyOpTranslator + editor behaviour', () => {
  it('editor-safe mode survives auto-close, auto-indent, overtype, navigation and pastes', () => {
    for (const profile of [PRESETS.instant, ...HUMAN_PRESETS, MAX_REVISIONS]) {
      for (const text of ALL) {
        for (let seed = 1; seed <= 8; seed++) expect(typeInto(text, profile, seed, true)).toBe(text)
      }
    }
  })

  it('without editor-safe mode a helpful editor corrupts the text (why the mode exists)', () => {
    expect(typeInto(JS, { ...PRESETS.fast, revisionRate: 0 }, 1, false)).not.toBe(JS)
  })

  it('dismisses suggestions before commit characters and arrow keys', () => {
    const tr = new KeyOpTranslator({ editorSafe: true })
    const ops = tr.toOps({ kind: 'text', text: 'foo.bar(', delayMs: 0, pos: 8, line: 1 })
    expect(ops).toEqual([
      { type: 'text', text: 'foo' },
      { type: 'key', key: 'esc' },
      { type: 'text', text: '.bar' },
      { type: 'key', key: 'esc' },
      { type: 'text', text: '(' }
    ])
    expect(tr.toOps({ kind: 'key', key: 'up', delayMs: 0, pos: 0, line: 1 })).toEqual([{ type: 'key', key: 'esc' }, { type: 'key', key: 'up' }])
    // No Esc between selection keys (it would cancel the selection).
    expect(tr.toOps({ kind: 'key', key: 'shift+up', delayMs: 0, pos: 0, line: 1 })).toEqual([{ type: 'key', key: 'shift+up' }])
  })
})
