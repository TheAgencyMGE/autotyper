import { clipboard, ClipboardItem } from 'electron'
import type { ClipboardPort } from './typing/TypingController'

type Saved = Array<Record<string, Blob | string>>

/**
 * Saves and restores the user's clipboard around simulated copy/paste.
 * The snapshot copies every format's data up front: the items clipboard.read()
 * returns are lazy handles, and by restore time they'd point at whatever
 * AutoTyper pasted in the meantime.
 */
export const electronClipboard: ClipboardPort = {
  async snapshot(): Promise<Saved> {
    const saved: Saved = []
    for (const item of await clipboard.read()) {
      const record: Record<string, Blob | string> = {}
      for (const type of item.types) {
        try {
          record[type] = (await item.getType(type)) as Blob
        } catch {
          /* a format the platform can't hand back; skip it */
        }
      }
      if (Object.keys(record).length) saved.push(record)
    }
    return saved
  },

  async restore(snapshot: unknown): Promise<void> {
    const saved = snapshot as Saved
    if (!saved.length) {
      clipboard.clear()
      return
    }
    await clipboard.write(saved.map((r) => new ClipboardItem(r)))
  },

  writeText: (text) => clipboard.writeText(text)
}
