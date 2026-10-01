import type { AutomationBackend, RawWindow, SendResult } from './types'

/**
 * Placeholder for platforms without a backend yet. To add macOS or Linux,
 * implement AutomationBackend (e.g. with CGEvent/Accessibility or xdotool/ydotool)
 * and register it in createAutomationBackend().
 */
export class UnsupportedBackend implements AutomationBackend {
  readonly name: string
  readonly supported = false

  constructor(platform: string) {
    this.name = `Unsupported (${platform})`
  }

  async init(): Promise<void> {}
  async listWindows(): Promise<RawWindow[]> {
    return []
  }
  async foreground(): Promise<RawWindow | null> {
    return null
  }
  async selfElevated(): Promise<boolean> {
    return false
  }
  async focus(): Promise<boolean> {
    return false
  }
  async send(): Promise<SendResult> {
    return { status: 'gone', detail: `Keyboard automation is not implemented for ${process.platform} yet.` }
  }
  dispose(): void {}
}
