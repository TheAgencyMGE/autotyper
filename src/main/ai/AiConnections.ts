import { shell } from 'electron'
import type { AiModel, ProviderId, ProviderStatus } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { SettingsStore } from '../settings/SettingsStore'
import { createAdapters } from './adapters'
import { signInWithOpenRouter } from './oauth'
import type { Credentials, ProviderAdapter } from './types'

export interface WriteRequest {
  system: string
  prompt: string
  maxTokens: number
  signal: AbortSignal
  onText: (delta: string) => void
}

export class NotConnectedError extends Error {}

const SOURCE_LABEL: Record<NonNullable<ProviderStatus['source']>, string> = {
  'saved-key': 'saved API key',
  'signed-in': 'your account',
  environment: 'environment key',
  'cli-profile': 'CLI login',
  local: 'this computer'
}

/**
 * All AI providers and how they're connected. Credentials are resolved in this
 * order: a key saved in AutoTyper (pasted, or issued by signing in), an
 * environment variable, then anything ambient (a CLI login, a local server).
 * Every connection is verified with a real call, which also lists the models
 * that account can use.
 */
export class AiConnections {
  private readonly adapters: ProviderAdapter[]
  private readonly statuses = new Map<ProviderId, ProviderStatus>()
  private signInController: AbortController | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly log: Logger,
    adapters: ProviderAdapter[] = createAdapters(),
    private readonly openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url)
  ) {
    this.adapters = adapters
    for (const a of adapters) this.statuses.set(a.id, { id: a.id, name: a.name, state: 'disconnected', models: [] })
  }

  list(): ProviderStatus[] {
    return this.adapters.map((a) => this.statuses.get(a.id)!)
  }

  private adapter(id: ProviderId): ProviderAdapter {
    const a = this.adapters.find((x) => x.id === id)
    if (!a) throw new Error(`Unknown provider: ${id}`)
    return a
  }

  private credentials(a: ProviderAdapter): Credentials | null {
    const saved = this.settings.getSecret(a.id)
    if (saved) return { apiKey: saved.value, source: saved.via === 'sign-in' ? 'signed-in' : 'saved-key' }
    for (const v of a.envVars) {
      const value = process.env[v]?.trim()
      if (value) return { apiKey: a.id === 'anthropic' ? undefined : value, source: 'environment' }
    }
    return a.ambientCredentials?.() ?? null
  }

  async refresh(id?: ProviderId): Promise<ProviderStatus[]> {
    const targets = id ? [this.adapter(id)] : this.adapters
    await Promise.all(targets.map((a) => this.refreshOne(a)))
    return this.list()
  }

  private async refreshOne(a: ProviderAdapter): Promise<void> {
    const creds = this.credentials(a)
    if (!creds) {
      this.statuses.set(a.id, { id: a.id, name: a.name, state: 'disconnected', models: [] })
      return
    }
    const was = this.statuses.get(a.id)?.state
    try {
      const models = await a.listModels(creds)
      this.statuses.set(a.id, { id: a.id, name: a.name, state: 'connected', source: creds.source, models, checkedAt: Date.now() })
      if (was !== 'connected') this.log.success('ai', `Connected to ${a.name} (${SOURCE_LABEL[creds.source]}), ${models.length} models available`)
    } catch (e) {
      if (a.isMissingCredentials(e)) {
        this.statuses.set(a.id, { id: a.id, name: a.name, state: 'disconnected', models: [] })
        return
      }
      const error = a.describeError(e)
      this.statuses.set(a.id, { id: a.id, name: a.name, state: 'error', source: creds.source, models: [], error, checkedAt: Date.now() })
      this.log.warn('ai', `${a.name}: ${error}`)
    }
  }

  /** Verify a pasted key before saving it, so a typo never gets stored. */
  async connect(id: ProviderId, apiKey: string): Promise<ProviderStatus[]> {
    const a = this.adapter(id)
    const key = apiKey.trim()
    const current = this.statuses.get(id)!
    if (!key) {
      this.statuses.set(id, { ...current, error: 'Paste an API key first.' })
      return this.list()
    }
    try {
      await a.listModels({ apiKey: key, source: 'saved-key' })
    } catch (e) {
      const error = a.describeError(e)
      this.log.warn('ai', `${a.name}: that key didn’t work. ${error}`)
      this.statuses.set(id, { ...current, state: current.state === 'connected' ? 'connected' : 'error', error })
      return this.list()
    }
    this.settings.setSecret(id, key, 'key')
    this.statuses.set(id, { ...current, state: 'disconnected' }) // force the "connected" log line
    return this.refresh(id)
  }

  /** Sign in with the user's account in their browser (OpenRouter's official OAuth PKCE flow). */
  async signIn(id: ProviderId): Promise<ProviderStatus[]> {
    const a = this.adapter(id)
    if (!a.signIn || id !== 'openrouter') throw new Error(`${a.name} doesn’t support signing in from other apps. Use an API key instead.`)
    this.signInController?.abort()
    const controller = new AbortController()
    this.signInController = controller
    try {
      this.log.info('ai', `Opening ${a.name} in your browser to sign in…`)
      const key = await signInWithOpenRouter(this.openExternal, controller.signal)
      this.settings.setSecret(id, key, 'sign-in')
      this.statuses.set(id, { ...this.statuses.get(id)!, state: 'disconnected' })
      return await this.refresh(id)
    } catch (e) {
      const error = (e as Error).message
      this.log.warn('ai', `${a.name}: ${error}`)
      this.statuses.set(id, { ...this.statuses.get(id)!, error })
      return this.list()
    } finally {
      if (this.signInController === controller) this.signInController = null
    }
  }

  async disconnect(id: ProviderId): Promise<ProviderStatus[]> {
    this.settings.setSecret(id, '')
    this.log.info('ai', `Removed the saved ${this.adapter(id).name} connection`)
    return this.refresh(id)
  }

  async openKeyPage(id: ProviderId): Promise<void> {
    const page = this.adapter(id).keyPage
    if (page) await this.openExternal(page)
  }

  /** The provider and model to write with: the chosen one if connected, otherwise the first connected. */
  pick(): { adapter: ProviderAdapter; creds: Credentials; model: AiModel } | null {
    const want = this.settings.get().codegen
    const connected = this.list().filter((s) => s.state === 'connected' && s.models.length)
    const status = connected.find((s) => s.id === want.provider) ?? connected[0]
    if (!status) return null
    const adapter = this.adapter(status.id)
    const creds = this.credentials(adapter)
    if (!creds) return null
    const model = status.models.find((m) => m.id === want.model) ?? status.models[0]
    return { adapter, creds, model }
  }

  /** Stream text from the chosen provider. Refreshes once if nothing looks connected yet. */
  async write(req: WriteRequest): Promise<{ text: string; label: string }> {
    let target = this.pick()
    if (!target) {
      await this.refresh()
      target = this.pick()
    }
    if (!target) throw new NotConnectedError('Connect an AI provider to have AutoTyper write this for you.')
    const { adapter, creds, model } = target
    try {
      const text = await adapter.stream(creds, { model: model.id, ...req })
      return { text, label: model.name }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError' || /abort/i.test((e as Error)?.constructor?.name ?? '')) throw e
      throw new Error(adapter.describeError(e))
    }
  }

  label(): string | null {
    const t = this.pick()
    return t ? t.model.name : null
  }
}
