import type { AutoTyperApi } from '../shared/types'

declare global {
  interface Window {
    autotyper: AutoTyperApi & { overlayAction(action: 'stop' | 'pauseResume'): void }
  }
}

export {}
