import type { HumanizationProfile, TypingMode } from '@shared/types'
import { DocModel, type NavKey } from './document'
import { isBracket, isDigit, isFastBigram, isIdentChar, isLetter, keyDistance, needsShift, typoNeighbors, wordDifficulty } from './keyboard'
import { commentSyntax, findTokenMutation, hasSurrogates, lineEdit, mutateLine, todoComment, type CommentSyntax, type EditRegion } from './mutations'
import { normalizeProfile } from './profiles'
import { findSlip, findSwap, isArrowSafe, splitSentences } from './prose'
import { Random } from './random'

export type { NavKey }
export type PauseReason = 'think' | 'hesitate' | 'notice' | 'break' | 'review' | 'recall'
/** What a step is part of, for the live activity display and logs. */
export type ActionTag = 'typo' | 'revise' | 'navigate' | 'paste' | 'todo'

interface ActionBase {
  /** Milliseconds to wait before performing the step. */
  delayMs: number
  /** Source characters currently in their final place once the step is done (progress). */
  pos: number
  /** 1-based caret line after the step. */
  line: number
  tag?: ActionTag
  /** Human-readable description of a behaviour that starts at this step. */
  note?: string
}

/**
 * One step of a typing plan. The plan describes intent in editor-neutral
 * terms; the KeyOpTranslator turns it into concrete keystrokes.
 */
export type TypeAction = ActionBase &
  (
    | { kind: 'text'; text: string; mistake?: boolean }
    | { kind: 'backspace' }
    | { kind: 'newline'; indent: string }
    | { kind: 'key'; key: NavKey }
    | { kind: 'clearEol' }
    | { kind: 'copy' }
    | { kind: 'paste'; text: string }
    | { kind: 'pause'; reason: PauseReason }
    | { kind: 'finish' }
  )

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type Step = DistributiveOmit<TypeAction, 'pos' | 'line'>

export interface PlanOptions {
  /**
   * Allow behaviours that move the caret with arrow keys (copy/paste, TODO
   * returns, late fixes, re-reading). Only safe in code editors with word wrap
   * off and editor-safe mode on.
   */
  allowNavigation?: boolean
  /** 'code' (AutoCoder, the default) or 'text' (AutoWriter: prose into documents). */
  mode?: TypingMode
}

const MIN_KEY_DELAY = 18
const MAX_KEY_DELAY = 1600
const MAX_THINK_PAUSE = 2800
const INSTANT_CHUNK = 200
/** Lines longer than this may soft-wrap, making arrow-key navigation unpredictable. */
const NAV_MAX_LINE = 100
const WORD_BOUNDARY = new Set(' \t.,;:!?()[]{}<>"\'`=+-*/&|')

const BLOCK_START =
  /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|def|interface|type\s+\w+\s*=|enum|struct|impl|fn|func|public|private|protected|describe\(|it\(|test\(|const\s+\w+\s*=\s*(\(|async|function|React))/
const COMMENT_START = /^\s*(\/\/|#(?!include|define|!)|\/\*|\*|<!--|--\s)/
const PY_BLOCK = /^(async\s+def|def|class|if|elif|else|for|while|with|try|except|finally)\b.*:\s*$/

interface PendingTodo {
  docLine: number
  text: string
  bodyStart: number
  bodyEnd: number
  wait: number
}

interface PendingFix {
  docLine: number
  /** Length of the (final) text after the wrong token on that line. */
  suffixLen: number
  wrong: string
  orig: string
  wait: number
}

interface RunState {
  lines: string[]
  nav: boolean
  revisions: boolean
  comment: CommentSyntax
  /** Doc line index of each source line once it has been typed (-1 = not yet). */
  docLineOf: number[]
  pendingTodo: PendingTodo | null
  pendingFix: PendingFix | null
  cooldown: number
  sinceBreak: number
  nextBreakAt: number
}

const splitIndent = (line: string): [string, string] => {
  const indent = /^[ \t]*/.exec(line)![0]
  return [indent, line.slice(indent.length)]
}

/**
 * Human typing engine.
 *
 * Plans a complete, timed editing session over a document model:
 *  - per-keystroke timing from a drifting speed, key distance, bigrams, word
 *    difficulty, shift/brackets, comments and fatigue;
 *  - a Markov-style slip model (neighbour keys, anticipation swaps, doubled
 *    keys) where slips are noticed probabilistically and always corrected;
 *  - non-linear programmer behaviours: copy/paste-and-edit, TODO stubs filled
 *    in later, drafts and false starts, going back to fix an earlier line,
 *    re-reading, distraction breaks.
 *
 * Every plan is replayed against a fresh document model and must reproduce
 * the source exactly; otherwise a simpler linear plan is used instead.
 *
 * Timing and slip model adapted in part from HumanTyping by Lax3n (MIT):
 * https://github.com/Lax3n/HumanTyping
 */
export class HumanTypingEngine {
  private readonly profile: HumanizationProfile
  private readonly seed: number
  private rng!: Random
  private wpm = 0
  private burstLeft = 0
  private burstFactor = 1
  private fatigue = 1
  private typoCooldown = 0
  private doc = new DocModel()
  private out: TypeAction[] = []
  private committed = 0
  /** Prose mode: slips are always fixed before the next space/punctuation, so autocorrect never sees them. */
  private strictSlips = false
  /** Set when the most recent plan had to fall back to linear typing. */
  fellBack = false

  constructor(profile: HumanizationProfile, seed?: number) {
    this.profile = normalizeProfile(profile)
    this.seed = (seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0
  }

  get isInstant(): boolean {
    return this.profile.preset === 'instant'
  }

  plan(source: string, opts: PlanOptions = {}): TypeAction[] {
    const text = source.replace(/\r\n?/g, '\n')
    this.fellBack = false
    if (this.isInstant) return this.planInstant(text.split('\n'))
    const prose = opts.mode === 'text'
    const plan = (nav: boolean, revisions: boolean) => (prose ? this.runProse(text, nav, revisions) : this.run(text, nav, revisions))
    try {
      const actions = plan(!!opts.allowNavigation, true)
      if (replayPlan(actions) === text) return actions
    } catch {
      /* fall through to the conservative plan */
    }
    this.fellBack = true
    return plan(false, false)
  }

  // ================================================================ planning

  private reset(): void {
    this.rng = new Random(this.seed)
    this.doc = new DocModel()
    this.out = []
    this.committed = 0
    this.fatigue = 1
    this.burstLeft = 0
    this.burstFactor = 1
    this.typoCooldown = this.rng.int(8, 20)
    this.strictSlips = false
    // Session speed: a normal draw inside the band (HumanTyping samples session WPM the same way).
    const { minWpm, maxWpm } = this.profile
    this.wpm = clamp((minWpm + maxWpm) / 2 + this.rng.gaussian(2) * (maxWpm - minWpm) * 0.2, minWpm, maxWpm)
  }

  private run(text: string, nav: boolean, revisions: boolean): TypeAction[] {
    this.reset()
    const lines = text.split('\n')
    const st: RunState = {
      lines,
      nav,
      revisions: revisions && this.profile.revisionRate > 0,
      comment: commentSyntax(text),
      docLineOf: new Array(lines.length).fill(-1),
      pendingTodo: null,
      pendingFix: null,
      cooldown: this.rng.int(3, 7),
      sinceBreak: 0,
      nextBreakAt: this.rng.int(350, 900)
    }

    let i = 0
    while (i < lines.length) {
      if (i > 0) this.lineBoundary(st)
      const consumed = this.tryBlockBehaviours(st, i)
      if (consumed > 0) {
        i += consumed
        continue
      }
      this.typeSourceLine(st, i)
      i++
    }
    if (st.pendingFix) this.applyLateFix(st)
    if (st.pendingTodo) this.fillTodo(st)
    this.emit({ kind: 'finish', delayMs: 0 })
    return this.out
  }

  /** Instant mode: whole lines in chunks, no delays, no slips. */
  private planInstant(lines: string[]): TypeAction[] {
    const out: TypeAction[] = []
    let pos = 0
    lines.forEach((line, li) => {
      const [indent, content] = splitIndent(line)
      if (li > 0) {
        pos += 1 + indent.length
        out.push({ kind: 'newline', indent, delayMs: 0, pos, line: li + 1 })
      } else if (indent) {
        pos += indent.length
        out.push({ kind: 'text', text: indent, delayMs: 0, pos, line: 1 })
      }
      for (let c = 0; c < content.length; c += INSTANT_CHUNK) {
        const chunk = content.slice(c, c + INSTANT_CHUNK)
        pos += chunk.length
        out.push({ kind: 'text', text: chunk, delayMs: 0, pos, line: li + 1 })
      }
    })
    out.push({ kind: 'finish', delayMs: 0, pos, line: lines.length })
    return out
  }

  // ------------------------------------------------------------ primitives

  private emit(step: Step, gain = 0): void {
    this.committed += gain
    applyToDoc(this.doc, step as TypeAction)
    this.out.push({ ...step, pos: Math.max(0, this.committed), line: this.doc.line + 1 } as TypeAction)
  }

  private pause(reason: PauseReason, ms: number, note?: string, tag?: ActionTag): void {
    this.emit({ kind: 'pause', reason, delayMs: Math.round(ms), note, tag })
  }

  private newline(indent: string, final: boolean, tag?: ActionTag): void {
    this.emit({ kind: 'newline', indent, delayMs: this.newlineDelay(indent), tag }, final ? 1 + indent.length : 0)
  }

  private clearEol(): void {
    this.emit({ kind: 'clearEol', delayMs: 0 })
  }

  /** Arrow/selection keys: deliberate taps for short moves, key-repeat when held. */
  private keys(key: NavKey, n: number, style: 'auto' | 'read' = 'auto', tag: ActionTag = 'navigate'): void {
    const held = style === 'auto' && n > 3
    for (let t = 0; t < n; t++) {
      let d: number
      if (t === 0) d = this.rng.uniform(170, 380)
      else if (style === 'read') d = this.rng.uniform(260, 720)
      else if (held) d = this.rng.uniform(30, 55)
      else d = this.rng.uniform(95, 190)
      this.emit({ kind: 'key', key, delayMs: Math.round(d), tag })
    }
  }

  /** Move the caret to the end of a document line, like a person would with arrows. */
  private goToLineEnd(target: number): void {
    if (this.doc.hasSelection) this.keys('end', 1)
    const diff = target - this.doc.line
    const dir: NavKey = diff < 0 ? 'up' : 'down'
    const n = Math.abs(diff)
    // Occasionally overshoot by a line and come back.
    const canOvershoot = n >= 4 && (dir === 'up' ? target > 0 : target < this.doc.lastLine)
    if (canOvershoot && this.rng.chance(0.2)) {
      this.keys(dir, n + 1)
      this.pause('review', this.rng.uniform(120, 320), undefined, 'navigate')
      this.keys(dir === 'up' ? 'down' : 'up', 1)
    } else if (n) this.keys(dir, n)
    this.keys('end', 1)
  }

  private holdBackspace(n: number, lostFinal: number, tag: ActionTag): void {
    for (let t = 0; t < n; t++) {
      const d = t === 0 ? this.rng.uniform(180, 360) : n > 4 ? this.rng.uniform(38, 70) : this.rng.uniform(90, 150)
      this.emit({ kind: 'backspace', delayMs: Math.round(d), tag }, t === 0 ? -lostFinal : 0)
    }
  }

  /** Whether arrow navigation across these document lines is predictable (no soft wrap). */
  private navSafe(from: number, to: number): boolean {
    const [a, b] = from < to ? [from, to] : [to, from]
    for (let l = a; l <= b; l++) {
      const s = this.doc.lines[l]
      if (s === undefined || s.length > NAV_MAX_LINE || hasSurrogates(s)) return false
    }
    return true
  }

  private chance(p: number): boolean {
    return this.rng.chance(p * this.profile.revisionRate)
  }

  // ---------------------------------------------------- Markov typing runs

  /**
   * Type `target` at the caret. Slips (neighbour key, anticipation swap,
   * doubled key) are noticed with a probability that grows with how far the
   * typing has drifted past them, and always at word boundaries; correction
   * compares what's on screen with the intended text, so a run always
   * converges exactly.
   */
  private typeRun(target: string, o: { final: boolean; typos: boolean; tag?: ActionTag }): void {
    const base = this.committed
    let cur = ''
    let match = 0
    let mental = 0
    let backspacing = false
    let inComment = COMMENT_START.test(target)
    const allowTypos = o.typos && this.profile.mistakeRate > 0
    let guard = target.length * 12 + 40

    const gainTo = (m: number) => (o.final ? base + m - this.committed : 0)

    while (cur !== target && guard-- > 0) {
      const err = match < cur.length
      if (err) {
        let correct = backspacing || mental >= target.length
        if (!correct) {
          const last = cur[cur.length - 1]
          const distance = cur.length - match
          if (WORD_BOUNDARY.has(last)) correct = true
          else if (this.strictSlips && WORD_BOUNDARY.has(target[mental] ?? ' ')) correct = true
          else if (distance >= 2) correct = this.rng.chance(0.8)
          else correct = this.rng.chance(0.6)
        }
        if (correct) {
          if (!backspacing) this.pause('notice', Math.max(100, 350 + this.rng.gaussian() * 100), undefined, 'typo')
          cur = cur.slice(0, -1)
          match = Math.min(match, cur.length)
          mental = cur.length
          backspacing = true
          this.emit({ kind: 'backspace', delayMs: Math.round(Math.max(30, 120 + this.rng.gaussian() * 20)), tag: 'typo' }, gainTo(match))
          continue
        }
      }
      if (backspacing) this.typoCooldown = this.rng.int(10, 30)
      backspacing = false
      if (mental >= target.length) break

      const ch = target[mental]
      if (!inComment && (target.startsWith('//', mental) || (ch === '#' && mental === 0))) inComment = true
      const prev = mental > 0 ? target[mental - 1] : this.doc.lines[this.doc.line][this.doc.col - 1] ?? '\n'
      const word = wordAt(target, mental)

      // Random mid-line hesitation at the start of a word.
      if (this.profile.pauseFrequency > 0 && prev === ' ' && isIdentChar(ch) && this.rng.chance(this.profile.pauseFrequency * 0.035)) {
        this.pause('hesitate', this.rng.uniform(400, 1800))
      }

      const typeChar = (c: string, mistake: boolean) => {
        const atMatch = match === cur.length && target[match] === c
        cur += c
        if (atMatch) match++
        this.emit({ kind: 'text', text: c, delayMs: Math.round(this.charDelay(c, cur.length > 1 ? cur[cur.length - 2] : prev, word, inComment)), mistake: mistake || undefined, tag: mistake ? 'typo' : o.tag }, gainTo(match))
      }

      const eligible = allowTypos && !err && this.typoCooldown <= 0 && isLetter(ch) && mental > 0 && isIdentChar(target[mental - 1])
      this.typoCooldown--
      if (eligible) {
        const mult = { common: 0.5, normal: 1, complex: 1.5 }[wordDifficulty(word)]
        const next = target[mental + 1]
        // Anticipation: the next letter lands first ("user" -> "uesr").
        if (next && isLetter(next) && next.toLowerCase() !== ch.toLowerCase() && this.rng.chance(this.profile.mistakeRate * 0.4)) {
          typeChar(next, true)
          typeChar(ch, true)
          mental += 2
          continue
        }
        if (this.rng.chance(this.profile.mistakeRate * mult)) {
          const near = typoNeighbors(ch)
          // Mostly a neighbouring key; sometimes the key is hit twice.
          const wrong = near.length && this.rng.chance(0.8) ? this.rng.pick(near) : ch
          if (wrong === ch) {
            typeChar(ch, false)
            typeChar(ch, true)
          } else typeChar(wrong, true)
          mental = cur.length
          continue
        }
      }
      typeChar(ch, false)
      mental++
    }
    if (cur !== target) throw new Error('typing run did not converge')
    if (o.final) this.committed = base + target.length
  }

  // ================================================================= prose

  /**
   * AutoWriter: paragraphs and sentences instead of lines and blocks. Pauses
   * gather at sentence and paragraph boundaries; a writer swaps a word for a
   * better one, restarts a sentence, or notices a real-word slip (then/than)
   * a sentence later and arrows back to fix it.
   */
  private runProse(text: string, nav: boolean, revisions: boolean): TypeAction[] {
    this.reset()
    this.strictSlips = true
    const paras = text.split('\n')
    const b = this.profile.behaviors
    const revise = revisions && this.profile.revisionRate > 0
    let cooldown = this.rng.int(1, 3)
    let fix: { line: number; endCol: number; wrong: string; orig: string; after: number } | null = null

    const applyFix = () => {
      const f = fix!
      fix = null
      const dist = this.doc.col - f.endCol
      const span = this.doc.lines[this.doc.line].slice(f.endCol, this.doc.col)
      if (this.doc.line === f.line && nav && dist <= 160 && isArrowSafe(span)) {
        this.pause('notice', this.rng.uniform(600, 1600), `Spotted "${f.wrong}", going back to fix it`, 'revise')
        if (dist) this.keys('left', dist, 'auto', 'revise')
        this.keys('shift+left', f.wrong.length, 'auto', 'revise')
        this.emit({ kind: 'backspace', delayMs: Math.round(this.rng.uniform(120, 260)), tag: 'revise' })
        this.typeRun(f.orig, { final: true, typos: false, tag: 'revise' })
        if (dist) this.keys('right', dist, 'auto', 'revise')
      } else {
        // Too far (or not safe to arrow across): delete back to the mistake and retype.
        this.pause('notice', this.rng.uniform(600, 1600), `Spotted "${f.wrong}", deleting back to fix it`, 'revise')
        this.holdBackspace(dist + f.wrong.length, dist, 'revise')
        this.typeRun(f.orig + span, { final: true, typos: true })
      }
    }

    paras.forEach((para, pi) => {
      if (pi > 0) this.newline('', true)
      if (!para) return
      if (pi > 0 && this.profile.thinkingPauses && !paras[pi - 1].trim()) this.pause('think', this.rng.uniform(900, 3200))
      if (b.distractions && pi > 0 && this.rng.chance(0.02 + this.profile.pauseFrequency * 0.04)) {
        this.pause('break', this.rng.uniform(3000, 10000), 'Short break')
        this.fatigue = Math.max(1, this.fatigue * 0.85)
      }

      for (const s of splitSentences(para)) {
        if (this.profile.thinkingPauses && this.rng.chance(0.35)) this.pause('think', this.rng.uniform(250, 1100))
        cooldown--
        let done = false
        if (revise && cooldown <= 0 && s.trim().length > 14) {
          if (b.rewrites && this.chance(0.06)) {
            const spaces = [...s.matchAll(/ /g)].map((m) => m.index!).filter((k) => k > s.length * 0.25 && k < s.length * 0.7)
            if (spaces.length) {
              const cut = this.rng.pick(spaces) + 1
              this.typeRun(s.slice(0, cut), { final: true, typos: true })
              this.pause('hesitate', this.rng.uniform(700, 1800), 'Restarting the sentence', 'revise')
              this.holdBackspace(cut, cut, 'revise')
              this.typeRun(s, { final: true, typos: true })
              done = true
            }
          }
          if (!done && b.rewrites && this.chance(0.14)) {
            const w = findSwap(s, this.rng)
            if (w) {
              this.typeRun(s.slice(0, w.a), { final: true, typos: true })
              this.typeRun(w.alt, { final: false, typos: false, tag: 'revise' })
              this.pause('review', this.rng.uniform(350, 1100), `Swapped "${w.alt}" for "${w.orig}"`, 'revise')
              this.holdBackspace(w.alt.length, 0, 'revise')
              this.typeRun(s.slice(w.a), { final: true, typos: true })
              done = true
            }
          }
          if (!done && b.lateFixes && !fix && this.chance(0.1)) {
            const w = findSlip(s, this.rng)
            if (w) {
              this.typeRun(s.slice(0, w.a), { final: true, typos: true })
              this.typeRun(w.alt, { final: false, typos: false })
              fix = { line: this.doc.line, endCol: this.doc.col, wrong: w.alt, orig: w.orig, after: this.rng.int(0, 1) }
              this.typeRun(s.slice(w.b), { final: true, typos: true })
              done = true
            }
          }
          if (done) cooldown = this.rng.int(2, 5)
        }
        if (!done) this.typeRun(s, { final: true, typos: true })
        if (fix && fix.after-- <= 0) applyFix()
      }
      if (fix) applyFix()
    })
    this.emit({ kind: 'finish', delayMs: 0 })
    return this.out
  }

  // --------------------------------------------------------------- timing

  private currentWpm(): number {
    const { minWpm, maxWpm, burstiness } = this.profile
    const range = Math.max(1, maxWpm - minWpm)
    this.wpm = clamp(this.wpm + this.rng.gaussian() * range * 0.05 * (0.5 + burstiness), minWpm, maxWpm)
    if (this.burstLeft > 0) this.burstLeft--
    else if (this.rng.chance(0.02 * burstiness)) {
      this.burstLeft = this.rng.int(8, 30)
      this.burstFactor = this.rng.chance(0.55) ? this.rng.uniform(1.12, 1.3) : this.rng.uniform(0.72, 0.88)
    } else this.burstFactor = 1
    return clamp(this.wpm * this.burstFactor, minWpm * 0.8, maxWpm * 1.2)
  }

  /** Milliseconds per keystroke at the current speed (1 word = 5 keystrokes), including fatigue. */
  private baseMs(): number {
    if (this.profile.behaviors.fatigue) this.fatigue = Math.min(1.25, this.fatigue * 1.00006)
    return (12000 / this.currentWpm()) * this.fatigue
  }

  private charDelay(ch: string, prev: string, word: string, inComment: boolean): number {
    const base = this.baseMs()
    let f = 1
    if (isFastBigram(prev, ch)) f *= 0.6
    else {
      const dist = keyDistance(prev, ch)
      if (dist > 0 && dist < 2) f *= 0.75
      else if (dist > 4) f *= 1.2
    }
    if (isIdentChar(ch)) {
      const diff = wordDifficulty(word)
      if (diff === 'common') f *= 0.72
      else if (diff === 'complex') f *= 1.25
    }
    if (isLetter(ch) && needsShift(ch)) f += needsShift(prev) && isLetter(prev) ? 0.1 : 0.55
    else if (isDigit(ch)) f *= 1.15
    else if (isBracket(ch)) f *= 1.4
    else if (needsShift(ch)) f *= 1.45
    else if (!isIdentChar(ch) && ch !== ' ') f *= 1.15

    if (isIdentChar(ch) && !isIdentChar(prev)) f *= 1.1
    if (inComment) f *= 0.9
    f = Math.max(f, 0.3)
    f *= this.profile.pauseVariation ? Math.exp(this.rng.gaussian(2.2) * 0.26) : this.rng.uniform(0.93, 1.07)
    let d = base * f

    if (this.profile.pauseVariation) {
      if (ch === ' ') d += base * this.rng.uniform(0.2, 0.9)
      if (prev && '.,;:'.includes(prev)) d += base * this.rng.uniform(0.6, 2.2)
      else if ((prev === '(' || prev === '{' || prev === '[') && ch !== ' ') d += base * this.rng.uniform(0, 0.6)
    }
    return clamp(d, MIN_KEY_DELAY, MAX_KEY_DELAY)
  }

  private newlineDelay(indent: string): number {
    const base = this.baseMs()
    const lineEnd = this.profile.pauseVariation ? this.rng.uniform(1.2, 3.2) : 1.4
    const indentCost = Math.min(indent.length, 12) * base * 0.12
    return Math.round(clamp(base * lineEnd + indentCost, MIN_KEY_DELAY, MAX_KEY_DELAY * 1.5))
  }

  private thinkingPause(prevLine: string, line: string): void {
    if (!this.profile.thinkingPauses || line.trim() === '') return
    const rng = this.rng
    let ms = 0
    let reason: PauseReason = 'think'
    if (prevLine.trim() === '' && rng.chance(0.75)) ms += rng.uniform(450, 1500)
    if (BLOCK_START.test(line) && rng.chance(0.55)) ms += rng.uniform(350, 1300)
    const trimmed = line.trim()
    const symbols = trimmed.replace(/[A-Za-z0-9\s]/g, '').length
    if ((trimmed.length > 70 || (trimmed.length > 18 && symbols / trimmed.length > 0.28)) && rng.chance(0.45)) {
      ms += rng.uniform(280, 1000)
      if (ms < 1000) reason = 'hesitate'
    }
    if (ms === 0 && rng.chance(0.035)) {
      ms = rng.uniform(250, 800)
      reason = 'hesitate'
    }
    if (ms) this.pause(reason, Math.min(ms, MAX_THINK_PAUSE))
  }

  // ------------------------------------------------------------ line flow

  /** Runs at the end of each typed line: returns to TODOs / earlier mistakes, re-reads, breaks. */
  private lineBoundary(st: RunState): void {
    st.cooldown--
    if (st.pendingFix && --st.pendingFix.wait <= 0) this.applyLateFix(st)
    if (st.pendingTodo && --st.pendingTodo.wait <= 0) this.fillTodo(st)

    const b = this.profile.behaviors
    if (b.distractions && this.rng.chance(0.004 + this.profile.pauseFrequency * 0.008)) {
      this.pause('break', this.rng.uniform(2500, 9000), 'Short break')
      this.fatigue = Math.max(1, this.fatigue * 0.85)
    }
    if (this.profile.thinkingPauses && st.sinceBreak >= st.nextBreakAt) {
      st.sinceBreak = 0
      st.nextBreakAt = this.rng.int(350, 900)
      this.pause('break', this.rng.uniform(900, 2400))
      this.fatigue = Math.max(1, this.fatigue * 0.93)
    }

    if (!st.revisions || !st.nav || st.cooldown > 0 || st.pendingFix || st.pendingTodo) return
    if (b.rereading && this.doc.line >= 3 && this.chance(0.035)) {
      const r = Math.min(this.rng.int(3, 8), this.doc.line)
      if (!this.navSafe(this.doc.line - r, this.doc.line)) return
      this.clearEol()
      this.keys('up', r, 'read')
      this.out[this.out.length - r].note = 'Re-reading the last few lines'
      this.pause('review', this.rng.uniform(500, 1600), undefined, 'navigate')
      this.keys('down', r)
      this.keys('end', 1)
      st.cooldown = this.rng.int(4, 9)
    }
  }

  private typeSourceLine(st: RunState, i: number): void {
    const [indent, content] = splitIndent(st.lines[i])
    if (i > 0) this.newline(indent, true)
    else if (indent) this.emit({ kind: 'text', text: indent, delayMs: this.newlineDelay(indent) }, indent.length)
    st.docLineOf[i] = this.doc.line
    if (i > 0) this.thinkingPause(st.lines[i - 1], st.lines[i])
    st.sinceBreak += content.length

    const b = this.profile.behaviors
    if (st.revisions && st.cooldown <= 0 && content.trim().length >= 8) {
      // Wrong identifier now, noticed a few lines later.
      if (b.lateFixes && st.nav && !st.pendingFix && !st.pendingTodo && st.lines[i].length <= NAV_MAX_LINE && i < st.lines.length - 2 && this.chance(0.07)) {
        const m = findTokenMutation(content, this.rng)
        const wait = this.rng.int(1, 3)
        if (m && st.lines.slice(i, i + wait + 1).every((l) => l.length <= NAV_MAX_LINE)) {
          this.typeRun(content.slice(0, m.a), { final: true, typos: true })
          this.typeRun(m.wrong, { final: false, typos: false })
          this.typeRun(content.slice(m.b), { final: true, typos: true })
          st.pendingFix = { docLine: this.doc.line, suffixLen: content.length - m.b, wrong: m.wrong, orig: m.orig, wait }
          st.cooldown = this.rng.int(3, 8)
          return
        }
      }
      if (b.rewrites && this.chance(0.045)) {
        if (this.falseStart(content)) {
          st.cooldown = this.rng.int(4, 9)
          return
        }
      }
      if (b.rewrites && this.chance(0.035)) {
        const draft = mutateLine(content, this.rng)
        if (draft) {
          this.typeRun(draft, { final: false, typos: true, tag: 'revise' })
          this.clearEol()
          this.pause('review', this.rng.uniform(500, 1500), 'Deleting that line and rewriting it', 'revise')
          this.holdBackspace(draft.length, 0, 'revise')
          this.typeRun(content, { final: true, typos: true })
          st.cooldown = this.rng.int(4, 9)
          return
        }
      }
    }
    this.typeRun(content, { final: true, typos: true })
  }

  /** Type part of the line, hesitate, delete back a few words and continue. */
  private falseStart(content: string): boolean {
    const spaces: number[] = []
    for (let k = 1; k < content.length; k++) if (content[k] === ' ') spaces.push(k)
    const candidates = spaces.filter((k) => k > content.length * 0.3 && k < content.length * 0.8)
    if (!candidates.length) return false
    const cut = this.rng.pick(candidates) + 1
    const earlier = spaces.filter((k) => k + 1 < cut)
    const back = earlier.length && this.rng.chance(0.7) ? this.rng.pick(earlier) + 1 : 0
    this.typeRun(content.slice(0, cut), { final: true, typos: true })
    this.pause('hesitate', this.rng.uniform(600, 1600), 'False start, retyping part of the line', 'revise')
    this.clearEol()
    this.holdBackspace(cut - back, cut - back, 'revise')
    this.typeRun(content.slice(back), { final: true, typos: true })
    return true
  }

  // ------------------------------------------------- multi-line behaviours

  private tryBlockBehaviours(st: RunState, i: number): number {
    const b = this.profile.behaviors
    if (!st.revisions || st.cooldown > 0) return 0
    if (st.nav && !st.pendingFix && !st.pendingTodo) {
      if (b.todoComments) {
        const n = this.tryTodo(st, i)
        if (n) return n
      }
      if (b.copyPaste && i > 0) {
        const n = this.tryCopyPaste(st, i)
        if (n) return n
      }
      if (b.rewrites && i > 0 && this.chance(0.02)) this.draftAndScrap(st, i)
    }
    return 0
  }

  /** Find the body of a block opened on line i ({ … } or Python indentation). */
  private findBlock(lines: string[], i: number): { bodyStart: number; bodyEnd: number; closing: number } | null {
    const [indent, content] = splitIndent(lines[i])
    const trimmed = content.trimEnd()
    if (trimmed.endsWith('{')) {
      for (let j = i + 1; j < lines.length && j < i + 40; j++) {
        const [ind, c] = splitIndent(lines[j])
        if (!c) continue
        if (ind.length <= indent.length) {
          return ind === indent && c.startsWith('}') ? { bodyStart: i + 1, bodyEnd: j, closing: j } : null
        }
      }
      return null
    }
    if (PY_BLOCK.test(trimmed)) {
      let j = i + 1
      while (j < lines.length && j < i + 40) {
        const [ind, c] = splitIndent(lines[j])
        if (c && ind.length <= indent.length) break
        j++
      }
      while (j > i + 1 && !lines[j - 1].trim()) j--
      return { bodyStart: i + 1, bodyEnd: j, closing: -1 }
    }
    return null
  }

  /** Header now, "// TODO: come back to this later" as the body, next part, then back to fill it in. */
  private tryTodo(st: RunState, i: number): number {
    const { lines } = st
    const block = this.findBlock(lines, i)
    if (!block) return 0
    const { bodyStart, bodyEnd, closing } = block
    const bodyLen = bodyEnd - bodyStart
    if (bodyLen < 2 || bodyLen > 25 || !lines[bodyStart].trim()) return 0
    const after = closing >= 0 ? closing + 1 : bodyEnd
    const remaining = lines.length - after
    if (remaining < 2) return 0
    const horizon = Math.min(this.rng.int(2, 8), remaining)
    const traversed = [...lines.slice(closing >= 0 ? closing : bodyEnd, after + horizon), lines[i]]
    if (traversed.some((l) => l.length > NAV_MAX_LINE || hasSurrogates(l))) return 0
    if (!this.chance(0.3)) return 0

    const [indent, content] = splitIndent(lines[i])
    if (i > 0) this.newline(indent, true)
    else if (indent) this.emit({ kind: 'text', text: indent, delayMs: this.newlineDelay(indent) }, indent.length)
    st.docLineOf[i] = this.doc.line
    this.typeRun(content, { final: true, typos: true })

    const [bodyIndent] = splitIndent(lines[bodyStart])
    const todo = todoComment(st.comment, this.rng)
    this.pause('think', this.rng.uniform(500, 1400), 'Leaving a TODO to come back to later', 'todo')
    this.newline(bodyIndent, true, 'todo')
    this.typeRun(todo, { final: false, typos: true, tag: 'todo' })
    const todoLine = this.doc.line
    if (closing >= 0) {
      const [cIndent, cContent] = splitIndent(lines[closing])
      this.newline(cIndent, true)
      this.typeRun(cContent, { final: true, typos: false })
      st.docLineOf[closing] = this.doc.line
    }
    st.pendingTodo = { docLine: todoLine, text: todo, bodyStart, bodyEnd, wait: horizon }
    st.cooldown = this.rng.int(2, 5)
    return after - i
  }

  private fillTodo(st: RunState): void {
    const t = st.pendingTodo!
    st.pendingTodo = null
    const back = this.doc.line
    this.clearEol()
    this.pause('recall', this.rng.uniform(900, 2400), `Going back to the TODO on line ${t.docLine + 1}`, 'todo')
    this.goToLineEnd(t.docLine)
    this.keys('shift+left', t.text.length, 'auto', 'todo')
    this.emit({ kind: 'backspace', delayMs: Math.round(this.rng.uniform(150, 300)), tag: 'todo' })

    const inserted = t.bodyEnd - t.bodyStart - 1
    for (let j = 0; j < st.docLineOf.length; j++) if (st.docLineOf[j] > t.docLine) st.docLineOf[j] += inserted
    for (let b = t.bodyStart; b < t.bodyEnd; b++) {
      const [indent, content] = splitIndent(st.lines[b])
      if (b > t.bodyStart) this.newline(indent, true)
      st.docLineOf[b] = this.doc.line
      this.typeRun(content, { final: true, typos: true })
    }
    this.clearEol()
    this.pause('review', this.rng.uniform(300, 900))
    this.goToLineEnd(back + inserted)
    st.cooldown = this.rng.int(3, 7)
  }

  /** Copy an earlier similar line/block, paste it, then edit only what differs. */
  private tryCopyPaste(st: RunState, i: number): number {
    const { lines, docLineOf } = st
    let best: { k: number; m: number; common: number; edits: Array<{ regions: EditRegion[] }> } | null = null

    for (let k = i - 1; k >= Math.max(0, i - 40); k--) {
      let m = 0
      let common = 0
      let total = 0
      const edits: Array<{ regions: EditRegion[] }> = []
      while (m < 8 && k + m < i && i + m < lines.length) {
        const [ia, ca] = splitIndent(lines[k + m])
        const [ib, cb] = splitIndent(lines[i + m])
        if (ia !== ib || lines[k + m].length > NAV_MAX_LINE || lines[i + m].length > NAV_MAX_LINE) break
        if (docLineOf[k + m] !== docLineOf[k] + m || docLineOf[k] < 0) break
        const edit = lineEdit(ca, cb)
        if (!edit) break
        edits.push(edit)
        common += edit.common
        total += Math.max(ca.length, cb.length, 1)
        m++
      }
      // Drop trailing lines that share little, then judge the block as a whole.
      while (m > 0 && edits[m - 1].regions.length && (edits[m - 1] as { common?: number }).common === 0) {
        edits.pop()
        m--
      }
      if (!m || total < 24 || common / total < 0.55) continue
      const [, firstContent] = splitIndent(lines[k])
      if (firstContent.length < 6) continue
      if (!best || common > best.common) best = { k, m, common, edits }
    }
    if (!best || !this.chance(0.7)) return 0

    const { k, m, edits } = best
    const back = this.doc.line
    if (!this.navSafe(docLineOf[k], back)) return 0

    // Go select the source lines and copy them.
    this.clearEol()
    this.pause('review', this.rng.uniform(500, 1400), `Copying ${m} similar line${m > 1 ? 's' : ''} from line ${docLineOf[k] + 1}`, 'paste')
    const [, contentK] = splitIndent(lines[k])
    this.goToLineEnd(docLineOf[k])
    this.keys('left', contentK.length, 'auto', 'paste')
    if (m > 1) this.keys('shift+down', m - 1, 'auto', 'paste')
    this.keys('shift+end', 1, 'auto', 'paste')
    this.emit({ kind: 'copy', delayMs: Math.round(this.rng.uniform(150, 350)), tag: 'paste' })
    this.goToLineEnd(back)

    // New line, paste, then fix the differences top-down.
    const [indentI] = splitIndent(lines[i])
    this.newline(indentI, true)
    const pasteText = [contentK, ...lines.slice(k + 1, k + m)].join('\n')
    let gain = 0
    for (let t = 0; t < m; t++) {
      const removed = edits[t].regions.reduce((n, r) => n + (r.b - r.a), 0)
      gain += splitIndent(lines[k + t])[1].length - removed + (t > 0 ? 1 + splitIndent(lines[k + t])[0].length : 0)
    }
    this.emit({ kind: 'paste', text: pasteText, delayMs: Math.round(this.rng.uniform(150, 350)), tag: 'paste' }, gain)
    const last = this.doc.line
    for (let t = 0; t < m; t++) docLineOf[i + t] = last - (m - 1 - t)
    this.pause('review', this.rng.uniform(300, 1000))

    for (let t = 0; t < m; t++) {
      const regions = [...edits[t].regions].sort((x, y) => y.a - x.a)
      if (!regions.length) continue
      const [indent] = splitIndent(lines[i + t])
      this.goToLineEnd(docLineOf[i + t])
      for (let r = 0; r < regions.length; r++) {
        const reg = regions[r]
        if (r > 0) this.keys('end', 1, 'auto', 'revise')
        const cur = this.doc.lines[this.doc.line]
        const suffix = cur.length - (indent.length + reg.b)
        if (suffix > 0) this.keys('left', suffix, 'auto', 'revise')
        if (reg.b > reg.a) {
          this.keys('shift+left', reg.b - reg.a, 'auto', 'revise')
          this.emit({ kind: 'backspace', delayMs: Math.round(this.rng.uniform(120, 260)), tag: 'revise' })
        }
        if (reg.text) this.typeRun(reg.text, { final: true, typos: false, tag: 'revise' })
      }
    }
    this.goToLineEnd(last)
    st.cooldown = this.rng.int(3, 7)
    return m
  }

  /** Type a first draft of the next few lines, decide it's wrong, select it all and delete it. */
  private draftAndScrap(st: RunState, i: number): void {
    const { lines } = st
    const d = this.rng.int(2, 3)
    if (i + d > lines.length) return
    const block = lines.slice(i, i + d)
    if (block.some((l) => !l.trim() || l.length > NAV_MAX_LINE || hasSurrogates(l))) return
    if (!this.navSafe(this.doc.line, this.doc.line)) return

    this.pause('think', this.rng.uniform(300, 900), 'Drafting a first attempt…', 'revise')
    block.forEach((line, t) => {
      const [indent, content] = splitIndent(line)
      let draft = mutateLine(content, this.rng) ?? content
      if (t === d - 1 && this.rng.chance(0.5)) draft = draft.slice(0, Math.max(1, Math.floor(draft.length * this.rng.uniform(0.3, 0.7))))
      this.newline(indent, false, 'revise')
      this.typeRun(draft, { final: false, typos: true, tag: 'revise' })
    })
    this.clearEol()
    this.pause('review', this.rng.uniform(900, 2600), 'Scrapping that draft and rewriting it', 'revise')
    this.keys('shift+up', d, 'auto', 'revise')
    this.keys('shift+end', 1, 'auto', 'revise')
    this.emit({ kind: 'backspace', delayMs: Math.round(this.rng.uniform(150, 300)), tag: 'revise' })
    st.cooldown = this.rng.int(4, 9)
  }

  /** Go back up to the line with the wrong token and fix it, then return. */
  private applyLateFix(st: RunState): void {
    const f = st.pendingFix!
    st.pendingFix = null
    const back = this.doc.line
    this.clearEol()
    this.pause('notice', this.rng.uniform(600, 1600), `Spotted "${f.wrong}" on line ${f.docLine + 1}, going back to fix it`, 'revise')
    this.goToLineEnd(f.docLine)
    if (f.suffixLen > 0) this.keys('left', f.suffixLen, 'auto', 'revise')
    this.keys('shift+left', f.wrong.length, 'auto', 'revise')
    this.emit({ kind: 'backspace', delayMs: Math.round(this.rng.uniform(120, 260)), tag: 'revise' })
    this.typeRun(f.orig, { final: true, typos: false, tag: 'revise' })
    this.pause('review', this.rng.uniform(150, 450))
    this.goToLineEnd(back)
    st.cooldown = this.rng.int(3, 7)
  }
}

function wordAt(s: string, i: number): string {
  let a = i
  while (a > 0 && isIdentChar(s[a - 1])) a--
  let b = i
  while (b < s.length && isIdentChar(s[b])) b++
  return s.slice(a, b)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function applyToDoc(doc: DocModel, a: TypeAction): void {
  switch (a.kind) {
    case 'text':
      doc.insert(a.text)
      break
    case 'paste':
      doc.insert(a.text)
      break
    case 'backspace':
      doc.backspace()
      break
    case 'newline':
      doc.newline(a.indent)
      break
    case 'key':
      doc.key(a.key)
      break
    case 'clearEol':
    case 'finish':
      doc.clearEol()
      break
  }
}

/** Total planned duration for a text (same seed ⇒ same plan). */
export function estimateDurationMs(text: string, profile: HumanizationProfile, seed = 1, opts: PlanOptions = { allowNavigation: true }): number {
  return new HumanTypingEngine(profile, seed).plan(text, opts).reduce((s, a) => s + a.delayMs, 0)
}

/** Replay a plan onto a plain document model (no editor conveniences) and return the text. */
export function replayPlan(actions: Iterable<TypeAction>): string {
  const doc = new DocModel()
  for (const a of actions) applyToDoc(doc, a)
  return doc.text
}
