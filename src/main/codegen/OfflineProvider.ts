import { pickTemplate, TEXT_SAMPLE } from './templates'
import type { GenerationInput } from './types'

/** Built-in samples for tests and demos, streamed so the UI behaves like a live model. */
export class OfflineProvider {
  readonly id = 'offline' as const
  readonly label = 'Offline samples'

  async generate({ request, signal, onText }: GenerationInput): Promise<string> {
    const code = request.mode === 'text' ? TEXT_SAMPLE : pickTemplate(request.prompt).code
    const chunk = 48
    for (let i = 0; i < code.length; i += chunk) {
      if (signal.aborted) throw new DOMException('Generation cancelled', 'AbortError')
      onText(code.slice(i, i + chunk))
      await new Promise((r) => setTimeout(r, 8))
    }
    return code
  }
}
