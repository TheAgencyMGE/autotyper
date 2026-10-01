import { EventEmitter } from 'node:events'
import { HumanTypingEngine, type TypeAction } from '@core/typing/engine'
import { KeyOpTranslator, type KeyOp } from '@core/typing/keyOps'
import { normalizeProfile } from '@core/typing/profiles'
import type { HumanizationProfile, TypingActivity, TypingMode, TypingStatus, WindowInfo } from '@shared/types'
import { NAVIGABLE_CODE_EDITORS } from '../automation/editors'
import type { Logger } from '../logging/Logger'
import type { AutomationBackend } from '../automation/types'

/** Clipboard access for simulated copy/paste; the user's clipboard is always restored. */
export interface ClipboardPort {
  snapshot(): Promise<unknown>
  restore(snapshot: unknown): Promise<void>
  writeText(text: string): Promise<void>
}

export interface TypingJob {
  mode: TypingMode
  code: string
  target: WindowInfo
  profile: HumanizationProfile
  editorSafe: boolean
  countdownSeconds: number
}

const STATUS_THROTTLE_MS = 90
const WPM_WINDOW_MS = 12_000

class StoppedError extends Error {}

/**
 * Drives one typing session: countdown → focus target → replay the humanized
 * plan keystroke by keystroke. Every send is focus-guarded by the backend; if
 * the target stops being the foreground window we auto-pause and only continue
 * after an explicit Resume re-focuses and re-verifies the same window.
 */
export class TypingController extends EventEmitter {
  private status: TypingStatus = idleStatus()
  private job: TypingJob | null = null
  private stopRequested = false
  private paused = false
  private resumeWaiters: Array<() => void> = []
  private lastEmit = 0
  private emitTimer: NodeJS.Timeout | null = null
  private samples: Array<{ t: number; pos: number }> = []
  private startedAt = 0
  private pausedTotal = 0
  private pausedAt = 0
  private speed = 1
  private clipboardSnapshot: unknown = undefined

  constructor(
    private readonly backend: AutomationBackend,
    private readonly log: Logger,
    private readonly clipboard: ClipboardPort
  ) {
    super()
  }

  get current(): TypingStatus {
    return this.status
  }

  get isActive(): boolean {
    return this.status.state === 'countdown' || this.status.state === 'typing' || this.status.state === 'paused'
  }

  /** Starts a session. Resolves once the session has begun (not when it finishes). */
  start(job: TypingJob): void {
    if (this.isActive) throw new Error('A typing session is already running.')
    const text = job.code.replace(/\r\n?/g, '\n')
    const profile = normalizeProfile(job.profile)
    this.job = { ...job, code: text, profile }
    this.stopRequested = false
    this.paused = false
    this.samples = []
    this.pausedTotal = 0
    this.status = {
      ...idleStatus(),
      state: 'countdown',
      target: job.target,
      totalChars: text.length,
      totalLines: text.split('\n').length,
      currentLine: 1,
      preset: profile.preset,
      speedMultiplier: this.speed,
      mode: job.mode
    }
    this.emitNow()
    void this.run().catch((e) => {
      if (e instanceof StoppedError) return
      this.log.error('typing', `Typing failed: ${(e as Error).message}`)
      this.finish('error', (e as Error).message)
    })
  }

  pause(reason = 'Resume whenever you’re ready.'): void {
    if (this.status.state !== 'typing' && this.status.state !== 'countdown') return
    this.paused = true
    this.pausedAt = Date.now()
    this.update({ state: 'paused', detail: reason, activity: 'waiting' }, true)
    this.log.info('typing', `Paused — ${reason}`)
  }

  async resume(): Promise<void> {
    if (this.status.state !== 'paused' || !this.job) return
    const { target } = this.job
    this.update({ detail: `Re-focusing ${target.appName}…` }, true)
    const focused = await this.focusTarget(target)
    if (!focused) {
      this.update({ detail: `Couldn’t bring ${target.appName} to the front. Click into it, then press Resume.` }, true)
      this.log.warn('typing', `Resume blocked: could not focus "${target.title}"`)
      return
    }
    await delay(220) // let the editor settle and restore its caret
    this.paused = false
    this.pausedTotal += Date.now() - this.pausedAt
    this.update({ state: 'typing', detail: undefined, activity: 'typing' }, true)
    this.log.info('typing', 'Resumed')
    const waiters = this.resumeWaiters
    this.resumeWaiters = []
    waiters.forEach((w) => w())
  }

  stop(reason = 'Stopped by user'): void {
    if (!this.isActive) return
    this.stopRequested = true
    const waiters = this.resumeWaiters
    this.resumeWaiters = []
    waiters.forEach((w) => w())
    this.finish('stopped', reason)
    this.log.warn('typing', `■ ${reason}`)
  }

  /** Live speed control: 1 = as planned, 2 = twice as fast. Applies immediately. */
  setSpeed(multiplier: number): void {
    this.speed = Math.min(4, Math.max(0.25, Number(multiplier) || 1))
    this.update({ speedMultiplier: this.speed }, true)
  }

  togglePause(): void {
    if (this.status.state === 'paused') void this.resume()
    else this.pause()
  }

  // ---------------------------------------------------------------- the loop

  private async run(): Promise<void> {
    const job = this.job!
    const { target } = job

    for (let n = job.countdownSeconds; n > 0; n--) {
      this.update({ countdown: n, detail: `Starting in ${n}…` }, true)
      await this.sleep(1000)
    }
    this.checkStopped()

    this.update({ countdown: undefined, detail: `Focusing ${target.appName}…` }, true)
    const focused = await this.focusTarget(target)
    this.checkStopped()
    if (!focused) throw new Error(`Could not bring "${target.title}" to the foreground. Nothing was typed.`)
    await this.sleep(300)

    this.startedAt = Date.now()
    this.update({ state: 'typing', detail: undefined, activity: 'typing' }, true)
    this.log.success('typing', `Typing into ${target.appName} — "${target.title}" (${job.profile.preset}, ${job.code.length} chars)`)

    const engine = new HumanTypingEngine(job.profile)
    const prose = job.mode === 'text'
    // Word processors have no auto-closing or suggestions to undo (and Esc can close their menus), but code
    // editors do, even for prose in a .txt file, so editor-safe handling follows the target app.
    const translator = new KeyOpTranslator({ editorSafe: job.editorSafe && (!prose || target.category === 'code') })
    // Code: arrow-key behaviours (copy/paste, TODO returns, going back to fix) need a code editor with
    // predictable caret movement. Prose: only character-exact Left/Right moves, safe in any text app.
    const allowNavigation = prose ? target.isEditor : job.editorSafe && NAVIGABLE_CODE_EDITORS.has(target.editor)
    if (!allowNavigation && job.profile.revisionRate > 0 && job.profile.preset !== 'instant') {
      this.log.info('humanizer', `Going back to fix things is off for ${target.appName}; typos, rewrites and pauses still apply.`)
    }
    // Plan once up front so the remaining-time estimate is exact for this run.
    const plan = engine.plan(job.code, { allowNavigation, mode: job.mode })
    if (engine.fellBack) this.log.debug('humanizer', 'Revision plan did not verify; using linear typing for this run.')
    let remainingPlanned = plan.reduce((s, a) => s + a.delayMs, 0)
    let mistakes = 0
    let revisions = 0

    try {
      for (const action of plan) {
        this.update({ activity: activityFor(action) })
        await this.sleep(action.delayMs / this.speed)
        remainingPlanned -= action.delayMs
        if (action.note) {
          revisions++
          this.log.info('humanizer', action.note)
        }
        if (action.kind === 'copy') this.clipboardSnapshot ??= await this.clipboard.snapshot().catch(() => undefined)
        await this.deliver(translator.toOps(action))

        if (action.kind === 'pause' && action.reason === 'notice' && action.tag === 'typo') mistakes++
        this.recordProgress(action.pos)
        this.update({
          typedChars: action.pos,
          currentLine: action.line,
          mistakesMade: mistakes,
          revisions,
          etaMs: Math.max(0, remainingPlanned / this.speed),
          wpm: this.measuredWpm(),
          elapsedMs: this.activeElapsed()
        })
        if (engine.isInstant) await delay(0) // keep the event loop (and Stop) responsive
      }
    } finally {
      await this.restoreClipboard()
    }

    this.finish('completed', `Typed ${job.code.length.toLocaleString()} characters into ${target.appName}.`)
    this.log.success('typing', `✓ Finished — ${job.code.length} chars in ${formatMs(this.activeElapsed())}, ${mistakes} corrected typos, ${revisions} revisions`)
  }

  private async restoreClipboard(): Promise<void> {
    const snap = this.clipboardSnapshot
    if (snap === undefined) return
    this.clipboardSnapshot = undefined
    await this.clipboard.restore(snap).catch(() => {
      /* clipboard busy; nothing else we can do */
    })
  }

  /** Windows sometimes refuses the first foreground switch (focus stealing rules); try a few times. */
  private async focusTarget(target: WindowInfo): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await delay(350)
      if (this.stopRequested) return false
      if (await this.backend.focus(target).catch(() => false)) return true
    }
    return false
  }

  /** Sends ops; a paste op puts its text on the clipboard and presses Ctrl+V, then restores the clipboard. */
  private async deliver(ops: KeyOp[]): Promise<void> {
    let batch: KeyOp[] = []
    for (const op of ops) {
      if (op.type !== 'paste') {
        batch.push(op)
        continue
      }
      await this.send(batch)
      batch = []
      this.clipboardSnapshot ??= await this.clipboard.snapshot().catch(() => undefined)
      await this.clipboard.writeText(op.text)
      await this.send([{ type: 'key', key: 'ctrl+v' }])
      await delay(150) // let the editor read the clipboard before restoring it
      await this.restoreClipboard()
    }
    await this.send(batch)
  }

  /** Sends ops, handling focus loss, held modifiers and vanished windows. */
  private async send(ops: KeyOp[]): Promise<void> {
    if (ops.length === 0) return
    const target = this.job!.target
    let remaining = ops
    let modifierSince = 0
    for (;;) {
      this.checkStopped()
      await this.waitWhilePaused()
      const res = await this.backend.send(target, remaining)
      this.checkStopped()
      switch (res.status) {
        case 'ok':
          if (modifierSince) this.update({ detail: undefined })
          return
        case 'modifiers':
          // The user is holding Ctrl/Alt/Shift/Win; typing now would fire shortcuts.
          if (!modifierSince) modifierSince = Date.now()
          else if (Date.now() - modifierSince > 800) this.update({ detail: 'Waiting for you to let go of Ctrl, Alt, Shift or Windows', activity: 'waiting' })
          await delay(60)
          continue
        case 'focus_lost': {
          remaining = remaining.slice(res.executed)
          const now = res.foreground ? `“${res.foreground.title || res.foreground.processName}”` : 'Another window'
          this.pause(`${now} came to the front, so typing paused. Nothing was typed there. Resume to carry on in ${target.appName}.`)
          continue
        }
        case 'user_input':
          // Whatever the user typed or clicked may have landed in the target, so the text there
          // no longer matches what we planned. Stop and let them tidy up before resuming.
          remaining = remaining.slice(res.executed)
          this.log.info('typing', `Input from outside AutoTyper (${res.what})`)
          this.pause(`You pressed a key or clicked, so typing paused. If that changed anything in ${target.appName}, undo it (Ctrl+Z) before you resume.`)
          continue
        case 'gone':
          this.stopRequested = true
          throw new Error(`Target window is no longer available (${res.detail}). Typing stopped.`)
      }
    }
  }

  // ----------------------------------------------------------------- helpers

  private checkStopped(): void {
    if (this.stopRequested) throw new StoppedError()
  }

  private waitWhilePaused(): Promise<void> {
    if (!this.paused) return Promise.resolve()
    return new Promise((resolve) => this.resumeWaiters.push(resolve))
  }

  /** Pausable, stoppable sleep: paused time does not count toward the delay. */
  private async sleep(ms: number): Promise<void> {
    let left = ms
    while (left > 0) {
      this.checkStopped()
      if (this.paused) {
        await this.waitWhilePaused()
        continue
      }
      const step = Math.min(left, 40)
      await delay(step)
      left -= step
    }
    this.checkStopped()
    await this.waitWhilePaused()
    this.checkStopped()
  }

  private recordProgress(pos: number): void {
    const t = Date.now()
    this.samples.push({ t, pos })
    while (this.samples.length > 2 && t - this.samples[0].t > WPM_WINDOW_MS) this.samples.shift()
  }

  private measuredWpm(): number {
    if (this.samples.length < 2) return 0
    const a = this.samples[0]
    const b = this.samples[this.samples.length - 1]
    const minutes = (b.t - a.t) / 60000
    return minutes > 0 ? Math.round((b.pos - a.pos) / 5 / minutes) : 0
  }

  private activeElapsed(): number {
    if (!this.startedAt) return 0
    const pausedNow = this.paused ? Date.now() - this.pausedAt : 0
    return Date.now() - this.startedAt - this.pausedTotal - pausedNow
  }

  private finish(state: 'completed' | 'stopped' | 'error', detail: string): void {
    this.paused = false
    void this.restoreClipboard()
    this.update({ state, detail, activity: undefined, countdown: undefined, etaMs: 0, elapsedMs: this.activeElapsed() }, true)
  }

  private update(patch: Partial<TypingStatus>, immediate = false): void {
    this.status = { ...this.status, ...patch }
    if (immediate) this.emitNow()
    else this.emitThrottled()
  }

  private emitNow(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    this.lastEmit = Date.now()
    this.emit('status', this.status)
  }

  private emitThrottled(): void {
    const since = Date.now() - this.lastEmit
    if (since >= STATUS_THROTTLE_MS) this.emitNow()
    else if (!this.emitTimer) this.emitTimer = setTimeout(() => this.emitNow(), STATUS_THROTTLE_MS - since)
  }
}

function activityFor(a: TypeAction): TypingActivity {
  if (a.tag === 'typo' || (a.kind === 'text' && a.mistake)) return 'correcting'
  if (a.tag === 'paste') return 'pasting'
  if (a.tag === 'revise' || a.tag === 'todo') return a.kind === 'key' ? 'navigating' : 'revising'
  if (a.tag === 'navigate' || a.kind === 'key') return 'navigating'
  if (a.kind === 'pause') return 'thinking'
  return 'typing'
}

function idleStatus(): TypingStatus {
  return { state: 'idle', typedChars: 0, totalChars: 0, currentLine: 0, totalLines: 0, wpm: 0, etaMs: 0, elapsedMs: 0, mistakesMade: 0, revisions: 0, speedMultiplier: 1 }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function formatMs(ms: number): string {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m ? `${m}m ${s % 60}s` : `${s}s`
}
