import type { KeyOp } from '@core/typing/keyOps'

/** A window as reported by a platform backend, before editor classification. */
export interface RawWindow {
  id: string
  pid: number
  title: string
  className?: string
  processName: string
  exePath?: string
  /** Runs as administrator. */
  elevated?: boolean
}

/** Identifies a target precisely: the handle alone could be reused by another process. */
export interface WindowRef {
  id: string
  pid: number
}

export type SendResult =
  | { status: 'ok' }
  /** `executed` = number of ops that ran before focus moved away. */
  | { status: 'focus_lost'; executed: number; foreground: RawWindow | null }
  | { status: 'modifiers' }
  /** The user pressed a key or clicked while typing; `executed` ops ran before it was noticed. */
  | { status: 'user_input'; executed: number; what: string }
  | { status: 'gone'; detail: string }

/**
 * Platform keyboard/window automation. Implementations must guarantee that
 * `send` only delivers keystrokes while the referenced window is foreground,
 * checking before every op, so typing can never leak into another app.
 */
export interface AutomationBackend {
  readonly name: string
  readonly supported: boolean
  init(): Promise<void>
  listWindows(): Promise<RawWindow[]>
  foreground(): Promise<RawWindow | null>
  /** Whether AutoTyper itself runs as administrator. */
  selfElevated(): Promise<boolean>
  focus(win: WindowRef): Promise<boolean>
  send(win: WindowRef, ops: KeyOp[]): Promise<SendResult>
  dispose(): void
}
