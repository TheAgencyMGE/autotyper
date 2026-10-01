import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { TypingStatus } from '@shared/types'
import { IPC } from '@shared/ipc'

const WIDTH = 360
const HEIGHT = 92

/**
 * A small always-on-top, non-activating pill shown while typing, with a
 * one-click STOP. It never takes focus, so clicking it cannot redirect keystrokes.
 */
export class Overlay {
  private win: BrowserWindow | null = null
  private hideTimer: NodeJS.Timeout | null = null

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const area = screen.getPrimaryDisplay().workArea
    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: area.x + area.width - WIDTH - 20,
      y: area.y + area.height - HEIGHT - 20,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      hasShadow: false,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
    })
    this.win.setAlwaysOnTop(true, 'screen-saver')
    if (process.env.ELECTRON_RENDERER_URL) void this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
    else void this.win.loadFile(join(__dirname, '../renderer/overlay.html'))
    return this.win
  }

  update(status: TypingStatus): void {
    const active = status.state === 'countdown' || status.state === 'typing' || status.state === 'paused'
    if (active) {
      if (this.hideTimer) clearTimeout(this.hideTimer)
      this.hideTimer = null
      const win = this.ensure()
      if (!win.isVisible()) win.showInactive()
    } else if (this.win && !this.win.isDestroyed() && this.win.isVisible() && !this.hideTimer) {
      this.hideTimer = setTimeout(() => {
        this.win?.hide()
        this.hideTimer = null
      }, 2500)
    }
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(IPC.typingStatus, status)
  }

  destroy(): void {
    this.win?.destroy()
    this.win = null
  }
}
