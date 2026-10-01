import { buildUserPrompt, cleanOutput, systemPromptFor } from '@core/codegen/prompt'
import type { GenerateRequest, GenerateResult } from '@shared/types'
import { NotConnectedError, type AiConnections } from '../ai/AiConnections'
import type { Logger } from '../logging/Logger'
import type { ProjectService } from '../project/ProjectService'
import type { SettingsStore } from '../settings/SettingsStore'
import { OfflineProvider } from './OfflineProvider'

/** Stage 1 of the pipeline: an idea (+ project context) → code or prose, streamed to the preview. */
export class CodegenService {
  private controller: AbortController | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly ai: AiConnections,
    private readonly project: ProjectService,
    private readonly log: Logger
  ) {}

  cancel(): void {
    this.controller?.abort()
    this.controller = null
  }

  async generate(request: GenerateRequest, onText: (delta: string) => void): Promise<GenerateResult> {
    this.cancel()
    const controller = new AbortController()
    this.controller = controller
    const providerId = this.settings.get().codegen.provider
    const noun = request.mode === 'text' ? 'words' : 'lines'

    try {
      if (!request.prompt?.trim()) throw new Error(request.mode === 'text' ? 'Describe what you want written first.' : 'Describe what you want built first.')
      let projectContext: string | undefined
      if (request.mode === 'code' && request.projectRoot) {
        projectContext = await this.project.buildContext(request.projectRoot, request.targetFile)
        this.log.info('codegen', `Using project context from ${request.projectRoot}${request.targetFile ? ` → ${request.targetFile}` : ''}`)
      }
      const started = Date.now()
      let raw: string
      // Offline samples are only reachable by explicitly choosing them (tests and demos).
      if (providerId === 'offline') {
        this.log.info('codegen', 'Writing with the offline samples…')
        raw = await new OfflineProvider().generate({ request, signal: controller.signal, onText })
      } else {
        this.log.info('codegen', `Writing with ${this.ai.label() ?? 'AI'}…`)
        raw = (
          await this.ai.write({
            system: systemPromptFor(request.mode),
            prompt: buildUserPrompt(request, projectContext),
            maxTokens: 64000,
            signal: controller.signal,
            onText
          })
        ).text
      }
      const code = cleanOutput(raw, request.mode)
      const size = request.mode === 'text' ? code.split(/\s+/).filter(Boolean).length : code.split('\n').length
      this.log.success('codegen', `Wrote ${size} ${noun} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
      return { ok: true, provider: providerId, code }
    } catch (e) {
      const err = e as Error
      if (controller.signal.aborted || err.name === 'AbortError' || /UserAbort/.test(err.name)) {
        this.log.warn('codegen', 'Stopped writing')
        return { ok: false, provider: providerId, cancelled: true }
      }
      if (err instanceof NotConnectedError) return { ok: false, provider: providerId, error: err.message, needsConnection: true }
      this.log.error('codegen', err.message)
      return { ok: false, provider: providerId, error: err.message }
    } finally {
      if (this.controller === controller) this.controller = null
    }
  }
}
