import { BrowserWindow } from 'electron'

/** Hides AutoTyper's own windows from screen sharing and capture (setContentProtection). */
export class ScreenShareGuard {
  private hidden = false
  private readonly windows = new Set<BrowserWindow>()

  get isHidden(): boolean {
    return this.hidden
  }

  /** Register one of AutoTyper's windows so it follows the hide setting. */
  track(win: BrowserWindow): void {
    this.windows.add(win)
    win.once('closed', () => this.windows.delete(win))
    win.setContentProtection(this.hidden)
  }

  /** The on/off switch for hiding AutoTyper from screen capture. */
  setHidden(hide: boolean): void {
    if (hide === this.hidden) return
    this.hidden = hide
    for (const w of this.windows) if (!w.isDestroyed()) w.setContentProtection(hide)
  }

  /** Cleanup on quit. */
  dispose(): void {
    this.setHidden(false)
  }
}
