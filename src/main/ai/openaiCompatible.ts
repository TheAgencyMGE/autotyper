import OpenAI, { APIConnectionError, APIError, APIUserAbortError, AuthenticationError, NotFoundError, PermissionDeniedError, RateLimitError } from 'openai'
import type { AiModel, ProviderId } from '@shared/types'
import type { Credentials, ProviderAdapter, StreamOptions } from './types'

interface RawModel {
  id: string
  name?: string
  created?: number
  pricing?: { prompt?: string; completion?: string }
}

interface Config {
  id: ProviderId
  name: string
  baseURL?: string
  keyPage?: string
  keyPlaceholder?: string
  envVars: string[]
  signIn?: boolean
  local?: boolean
  headers?: Record<string, string>
  /** An authenticated endpoint to call first when the model list itself is public (so a bad key would pass). */
  verifyPath?: string
  /** Keep chat models only, best first, with readable names. */
  pick(models: RawModel[]): AiModel[]
}

/**
 * OpenAI and the providers that speak its API (Gemini, OpenRouter, Ollama),
 * all through the official OpenAI SDK with a different base URL.
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: ProviderId
  readonly name: string
  readonly keyPage?: string
  readonly keyPlaceholder?: string
  readonly envVars: string[]
  readonly signIn?: boolean
  readonly local?: boolean

  constructor(private readonly cfg: Config) {
    this.id = cfg.id
    this.name = cfg.name
    this.keyPage = cfg.keyPage
    this.keyPlaceholder = cfg.keyPlaceholder
    this.envVars = cfg.envVars
    this.signIn = cfg.signIn
    this.local = cfg.local
  }

  ambientCredentials(): Credentials | null {
    // Ollama needs no key; it just has to be running.
    return this.cfg.local ? { apiKey: 'ollama', source: 'local' } : null
  }

  private client(creds: Credentials): OpenAI {
    return new OpenAI({
      apiKey: creds.apiKey ?? '',
      baseURL: this.cfg.baseURL,
      defaultHeaders: this.cfg.headers,
      // Local servers answer instantly or not at all.
      timeout: this.cfg.local ? 4_000 : 60_000,
      maxRetries: this.cfg.local ? 0 : 2
    })
  }

  async listModels(creds: Credentials): Promise<AiModel[]> {
    const client = this.client(creds)
    if (this.cfg.verifyPath) await client.get(this.cfg.verifyPath)
    const raw: RawModel[] = []
    for await (const m of client.models.list()) raw.push(m as unknown as RawModel)
    return this.cfg.pick(raw)
  }

  async stream(creds: Credentials, o: StreamOptions): Promise<string> {
    const stream = await this.client(creds).chat.completions.create(
      {
        model: o.model,
        stream: true,
        messages: [
          { role: 'system', content: o.system },
          { role: 'user', content: o.prompt }
        ]
      },
      { signal: o.signal, timeout: 10 * 60_000 }
    )
    let text = ''
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      const delta = choice?.delta?.content ?? ''
      if (delta) {
        text += delta
        o.onText(delta)
      }
      if (choice?.finish_reason === 'content_filter') throw new Error(`${this.name} declined this request. Try rephrasing it.`)
    }
    return text
  }

  isMissingCredentials(e: unknown): boolean {
    // Ollama not running is "not connected", not a failure.
    return this.cfg.local ? e instanceof APIConnectionError : false
  }

  describeError(e: unknown): string {
    const who = this.name
    if (e instanceof APIUserAbortError) return 'Stopped.'
    if (e instanceof AuthenticationError) return `${who} didn’t accept that key. Check it was copied in full.`
    if (e instanceof PermissionDeniedError) return `This ${who} key doesn’t have access to that.`
    if (e instanceof NotFoundError) return `Your ${who} account can’t use that model. Pick another one.`
    if (e instanceof RateLimitError) return `${who} is rate-limiting requests (or you’re out of credit). Try again in a moment.`
    if (e instanceof APIConnectionError) return this.cfg.local ? 'Ollama isn’t running. Start it, then check again.' : `Couldn’t reach ${who}. Check your internet connection.`
    if (e instanceof APIError) return `${who} returned an error (${e.status ?? 'unknown'}).`
    return (e as Error)?.message || `Something went wrong talking to ${who}.`
  }
}

// ------------------------------------------------------------ model pickers

const byCreatedDesc = (a: RawModel, b: RawModel) => (b.created ?? 0) - (a.created ?? 0)

function titleCase(id: string): string {
  return id
    .split(/[-_]/)
    .map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

export function pickOpenAI(models: RawModel[]): AiModel[] {
  return models
    .filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(audio|realtime|tts|transcribe|image|embedding|search|instruct|moderation|dall-e|whisper|codex|computer-use|\d{4}-\d{2}-\d{2})/.test(m.id))
    .sort((a, b) => Number(b.id.startsWith('gpt-')) - Number(a.id.startsWith('gpt-')) || byCreatedDesc(a, b))
    .map((m) => ({ id: m.id, name: m.id.replace(/^gpt-/, 'GPT-').replace(/^chatgpt-/, 'ChatGPT ').replace(/^o(\d)/, 'o$1') }))
}

export function pickGemini(models: RawModel[]): AiModel[] {
  const tier = (id: string) => (id.includes('pro') ? 0 : id.includes('flash-lite') ? 2 : id.includes('flash') ? 1 : 3)
  const version = (id: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0)
  return models
    .map((m) => ({ ...m, id: m.id.replace(/^models\//, '') }))
    .filter((m) => /^gemini-/.test(m.id) && !/(embedding|aqa|imagen|tts|image|live|audio|vision|thinking-exp|-exp-\d)/.test(m.id))
    .sort((a, b) => version(b.id) - version(a.id) || tier(a.id) - tier(b.id))
    .map((m) => ({ id: m.id, name: titleCase(m.id), free: true }))
}

const OPENROUTER_VENDORS = ['anthropic/', 'openai/', 'google/', 'meta-llama/', 'mistralai/', 'deepseek/', 'qwen/', 'x-ai/', 'moonshotai/']

export function pickOpenRouter(models: RawModel[]): AiModel[] {
  const isFree = (m: RawModel) => m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0')
  const vendor = (id: string) => {
    const i = OPENROUTER_VENDORS.findIndex((v) => id.startsWith(v))
    return i === -1 ? OPENROUTER_VENDORS.length : i
  }
  // Routing variants (":batch", ":floor", ":nitro"…) are the same model; only ":free" is worth listing.
  const usable = models.filter((m) => !/:(?!free\b)\w+$/.test(m.id) && !/(embed|image|audio|tts|moderation|guard|lyria|music)/i.test(m.id))
  const paid: RawModel[] = []
  OPENROUTER_VENDORS.forEach((v, i) => {
    paid.push(...usable.filter((m) => vendor(m.id) === i && !isFree(m)).sort(byCreatedDesc).slice(0, 6))
  })
  const free = usable.filter(isFree).sort(byCreatedDesc).slice(0, 30)
  return [...paid, ...free].map((m) => ({ id: m.id, name: (m.name ?? m.id).replace(/ \(free\)$/i, '') + (isFree(m) ? ' (free)' : ''), free: isFree(m) }))
}

export function pickOllama(models: RawModel[]): AiModel[] {
  return models.filter((m) => !/embed/i.test(m.id)).map((m) => ({ id: m.id, name: m.id, free: true }))
}
