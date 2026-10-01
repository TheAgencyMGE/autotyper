import { globalShortcut } from 'electron'
import type { Settings } from '@shared/types'

export interface HotkeyHandlers {
  stop: () => void
  pauseResume: () => void
}

/**
 * System-wide hotkeys: they work while the target editor has focus.
 * Returns human-readable problems (e.g. a combination the OS reserves).
 */
export function registerHotkeys(hotkeys: Settings['hotkeys'], handlers: HotkeyHandlers): string[] {
  globalShortcut.unregisterAll()
  const problems: string[] = []
  const bind = (accel: string, label: string, fn: () => void) => {
    if (!accel) return
    try {
      if (!globalShortcut.register(accel, fn)) problems.push(`${label} hotkey "${accel}" is taken by another app or reserved by the OS.`)
    } catch {
      problems.push(`${label} hotkey "${accel}" is not a valid shortcut.`)
    }
  }
  bind(hotkeys.stop, 'Emergency stop', handlers.stop)
  bind(hotkeys.pauseResume, 'Pause/Resume', handlers.pauseResume)
  return problems
}
