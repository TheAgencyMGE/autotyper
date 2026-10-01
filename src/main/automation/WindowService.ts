import { spawn } from 'node:child_process'
import type { WindowInfo } from '@shared/types'
import { classifyWindow, OPENS_FILES_IN_PLACE } from './editors'
import type { AutomationBackend } from './types'
import { UnsupportedBackend } from './UnsupportedBackend'
import { WindowsBackend } from './windows/WindowsBackend'

export function createAutomationBackend(workDir: string, onLog: (level: 'info' | 'warn' | 'error', msg: string) => void): AutomationBackend {
  if (process.platform === 'win32') return new WindowsBackend(workDir, onLog)
  return new UnsupportedBackend(process.platform)
}

/** Window discovery and targeting on top of an AutomationBackend. */
export class WindowService {
  constructor(readonly backend: AutomationBackend) {}

  private selfElevated: boolean | null = null

  async list(): Promise<WindowInfo[]> {
    const raw = await this.backend.listWindows()
    this.selfElevated ??= await this.backend.selfElevated().catch(() => false)
    const self = this.selfElevated
    return raw
      // AutoTyper's own windows (a second instance, the overlay) are never valid targets.
      .filter((w) => !/^(AutoTyper|AutoCoder)( overlay)?$/.test(w.title))
      .map(classifyWindow)
      .sort((a, b) => a.rank - b.rank || a.appName.localeCompare(b.appName) || a.title.localeCompare(b.title))
      // Windows won't deliver keystrokes from a normal app into an administrator one.
      .map(({ rank: _rank, ...w }) => ({ ...w, blocked: !!w.elevated && !self }))
  }

  /** Re-resolve a target from a fresh enumeration; null if it closed or the handle was reused. */
  async resolve(id: string, pid?: number): Promise<WindowInfo | null> {
    const found = (await this.list()).find((w) => w.id === id)
    if (!found || (pid !== undefined && found.pid !== pid)) return null
    return found
  }

  /**
   * Ask the target editor to open a file (read-only operation from our side:
   * nothing is written to disk). Uses the executable of the running window,
   * so no install location is assumed.
   */
  async openFile(win: WindowInfo, absPath: string): Promise<void> {
    if (!win.exePath) throw new Error(`Can't locate the executable for ${win.appName}.`)
    if (!OPENS_FILES_IN_PLACE.has(win.editor)) throw new Error(`${win.appName} doesn't support opening files in its existing window. Open the file there manually.`)
    const child = spawn(win.exePath, [absPath], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
  }
}
