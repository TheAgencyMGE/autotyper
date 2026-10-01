import { describe, expect, it } from 'vitest'
import { HumanTypingEngine, replayPlan, type TypeAction } from '../src/core/typing/engine'
import { DocModel } from '../src/core/typing/document'
import { KeyOpTranslator } from '../src/core/typing/keyOps'
import { PRESETS } from '../src/core/typing/profiles'
import { splitSentences } from '../src/core/typing/prose'
import type { HumanizationProfile } from '../src/shared/types'
import { HelpfulEditor } from './editorSim'

const ESSAY = `The Quiet Value of Small Teams

Small teams often move faster than large ones. They need fewer meetings, and every person can see how their work affects the whole. When a problem appears, the people who notice it are usually the ones who can fix it.

But small teams also have limits. A group of four cannot maintain a dozen products, and it is easy to lose sight of the bigger picture. The main risk is that important work falls between the cracks!

So what should a growing company do? Keep teams small, give them clear ownership, and make it simple for them to ask each other for help. That is harder than it sounds, but it is worth the effort.`

const EMAIL = `Hi Sam,

Thanks for sending the draft over. I think the second section is very clear, but the introduction could be shorter. Maybe we can talk about it on Thursday?

Best,
Alex`

const MAX: HumanizationProfile = { ...PRESETS.veryHuman, revisionRate: 1, mistakeRate: 0.04 }

const plan = (text: string, profile: HumanizationProfile, seed: number, allowNavigation = true): TypeAction[] =>
  new HumanTypingEngine(profile, seed).plan(text, { allowNavigation, mode: 'text' })

describe('AutoWriter (prose mode)', () => {
  it('splits sentences without losing a character', () => {
    for (const p of ESSAY.split('\n')) expect(splitSentences(p).join('')).toBe(p)
    expect(splitSentences('One. Two! Three? four')).toEqual(['One. ', 'Two! ', 'Three? ', 'four'])
  })

  it('always reproduces the text exactly', () => {
    for (const profile of [PRESETS.instant, PRESETS.fast, PRESETS.normal, PRESETS.slow, PRESETS.veryHuman, MAX]) {
      for (const text of [ESSAY, EMAIL]) {
        for (let seed = 1; seed <= 25; seed++) expect(replayPlan(plan(text, profile, seed))).toBe(text)
      }
    }
  })

  it('never lets a misspelled word reach a space or punctuation (autocorrect-safe)', () => {
    const real = new Set((ESSAY + ' ' + EMAIL).match(/[A-Za-z]+/g)!.map((w) => w.toLowerCase()))
    const allowed = (w: string) => real.has(w.toLowerCase()) || w.length === 0
    for (let seed = 1; seed <= 25; seed++) {
      const doc = new DocModel()
      for (const a of plan(ESSAY, MAX, seed)) {
        if (a.kind === 'text' && /^[ .,;:!?]$/.test(a.text)) {
          const before = doc.lines[doc.line].slice(0, doc.col).match(/[A-Za-z]+$/)?.[0] ?? ''
          // Swaps and slips are real words too; anything else would be a typo autocorrect could rewrite.
          if (!allowed(before)) expect.soft(before, `seed ${seed}`).toMatch(/^(large|little|fast|start|assist|demonstrate|utilize|crucial|however|really|frequently|perhaps|obtain|create|believe|primary|difficult|simple|shift|concept|piece|require|wish|obvious|great|poor|fresh|former|several|too|around|sufficient|issue|outcome|method|seem|maintain|discover|provide|inform|finish|group|effort|folks|response|pick|sense|there|than|effect|to|loose|whether|except|from|quiet|advise|principle|off|big|small|quick|begin|help|show|use|important|but|very|often|maybe|get|make|think|main|hard|easy|change|idea|part|need|want|clear|good|bad|new|old|many|also|about|enough|problem|result|way|look|keep|find|give|tell|end|team|work|people|answer|choose|feel|their|then|affect|lose|weather|accept|form|quite|advice|principal|of)$/i)
        }
        applyForTest(doc, a)
      }
    }
  })

  it('swaps words, restarts sentences and goes back to fix slips', () => {
    const notes = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) for (const a of plan(ESSAY, MAX, seed)) if (a.note) notes.add(a.note.replace(/".*?"/g, '"x"'))
    expect([...notes].some((n) => n.startsWith('Swapped'))).toBe(true)
    expect([...notes].some((n) => n.startsWith('Restarting'))).toBe(true)
    expect([...notes].some((n) => /going back to fix|deleting back to fix/.test(n))).toBe(true)
  })

  it('never uses vertical navigation, pastes or editor-safe clean-up in documents', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const tr = new KeyOpTranslator({ editorSafe: false })
      for (const a of plan(ESSAY, MAX, seed)) {
        expect(a.kind === 'paste' || a.kind === 'copy' || (a.kind === 'key' && /up|down|end|home/.test(a.key))).toBe(false)
        for (const op of tr.toOps(a)) {
          if (op.type === 'key') expect(['enter', 'backspace', 'left', 'right', 'shift+left']).toContain(op.key)
        }
      }
    }
  })

  it('reproduces the text through a code editor with editor-safe keystrokes (prose in a .txt file)', () => {
    for (const text of [ESSAY, EMAIL]) {
      for (let seed = 1; seed <= 15; seed++) {
        const editor = new HelpfulEditor()
        const tr = new KeyOpTranslator({ editorSafe: true })
        for (const a of plan(text, MAX, seed)) editor.apply(tr.toOps(a))
        expect(editor.text).toBe(text)
      }
    }
  })

  it('never needs the linear fallback', () => {
    for (const text of [ESSAY, EMAIL]) {
      for (let seed = 1; seed <= 30; seed++) {
        const e = new HumanTypingEngine(MAX, seed)
        e.plan(text, { allowNavigation: true, mode: 'text' })
        expect(e.fellBack).toBe(false)
      }
    }
  })
})

function applyForTest(doc: DocModel, a: TypeAction): void {
  if (a.kind === 'text' || a.kind === 'paste') doc.insert(a.text)
  else if (a.kind === 'backspace') doc.backspace()
  else if (a.kind === 'newline') doc.newline(a.indent)
  else if (a.kind === 'key') doc.key(a.key)
  else if (a.kind === 'clearEol' || a.kind === 'finish') doc.clearEol()
}
