import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiModel } from '../src/shared/types'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, safeStorage: {} }))

const { AiConnections, NotConnectedError } = await import('../src/main/ai/AiConnections')
const { pickGemini, pickOpenAI, pickOpenRouter } = await import('../src/main/ai/openaiCompatible')
const { signInWithOpenRouter } = await import('../src/main/ai/oauth')
const { AnthropicAdapter } = await import('../src/main/ai/anthropic')
type Adapter = import('../src/main/ai/types').ProviderAdapter

// ---- test doubles

function fakeSettings() {
  const secrets: Record<string, { value: string; via: 'key' | 'sign-in' }> = {}
  let codegen = { provider: 'anthropic', model: 'claude-opus-5-5' }
  return {
    secrets,
    get: () => ({ codegen }),
    setCodegen: (c: typeof codegen) => (codegen = c),
    getSecret: (id: string) => secrets[id],
    setSecret: vi.fn((id: string, value: string, via: 'key' | 'sign-in' = 'key') => {
      if (value) secrets[id] = { value, via }
      else delete secrets[id]
    })
  }
}
const log = { success: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }

function fakeAdapter(id: string, opts: { goodKey?: string; models?: AiModel[]; local?: boolean; env?: string[] } = {}): Adapter {
  const models = opts.models ?? [{ id: `${id}-best`, name: `${id} best` }]
  return {
    id: id as never,
    name: id,
    envVars: opts.env ?? [],
    local: opts.local,
    ambientCredentials: () => (opts.local ? { apiKey: 'local', source: 'local' } : null),
    listModels: async (c) => {
      if (opts.local) throw Object.assign(new Error('ECONNREFUSED'), { missing: true })
      if (c.apiKey !== opts.goodKey) throw new Error('bad key')
      return models
    },
    stream: async (_c, o) => {
      o.onText('hello')
      return `${id}:${o.model}`
    },
    describeError: (e) => `${id}: ${(e as Error).message}`,
    isMissingCredentials: (e) => !!(e as { missing?: boolean }).missing
  }
}

describe('AiConnections', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.FAKE_KEY
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('treats "nothing set up" and "local server not running" as disconnected, not errors', async () => {
    const ai = new AiConnections(fakeSettings() as never, log as never, [fakeAdapter('anthropic'), fakeAdapter('ollama', { local: true })])
    const list = await ai.refresh()
    expect(list.map((s) => s.state)).toEqual(['disconnected', 'disconnected'])
    expect(list.every((s) => !s.error)).toBe(true)
  })

  it('never saves a key the provider rejects', async () => {
    const settings = fakeSettings()
    const ai = new AiConnections(settings as never, log as never, [fakeAdapter('openai', { goodKey: 'sk-good' })])
    const list = await ai.connect('openai', 'sk-typo')
    expect(settings.setSecret).not.toHaveBeenCalled()
    expect(list[0].state).toBe('error')
    expect(list[0].error).toMatch(/bad key/)
  })

  it('saves a verified key and lists its models', async () => {
    const settings = fakeSettings()
    const ai = new AiConnections(settings as never, log as never, [fakeAdapter('openai', { goodKey: 'sk-good' })])
    const list = await ai.connect('openai', '  sk-good  ')
    expect(settings.secrets.openai).toEqual({ value: 'sk-good', via: 'key' })
    expect(list[0]).toMatchObject({ state: 'connected', source: 'saved-key' })
  })

  it('picks up keys from environment variables', async () => {
    process.env.FAKE_KEY = 'sk-good'
    const ai = new AiConnections(fakeSettings() as never, log as never, [fakeAdapter('gemini', { goodKey: 'sk-good', env: ['FAKE_KEY'] })])
    expect((await ai.refresh())[0]).toMatchObject({ state: 'connected', source: 'environment' })
  })

  it('writes with the chosen provider, falling back to any connected one', async () => {
    const settings = fakeSettings()
    const ai = new AiConnections(settings as never, log as never, [fakeAdapter('anthropic', { goodKey: 'a' }), fakeAdapter('openai', { goodKey: 'o' })])
    await ai.connect('openai', 'o')
    // Chosen provider (anthropic) isn't connected, so the connected one writes.
    const chunks: string[] = []
    const out = await ai.write({ system: 's', prompt: 'p', maxTokens: 10, signal: new AbortController().signal, onText: (t) => chunks.push(t) })
    expect(out.text).toBe('openai:openai-best')
    expect(chunks).toEqual(['hello'])
    settings.setCodegen({ provider: 'openai', model: 'missing-model' })
    expect((await ai.write({ system: 's', prompt: 'p', maxTokens: 10, signal: new AbortController().signal, onText: () => {} })).text).toBe('openai:openai-best')
  })

  it('refuses to write when nothing is connected', async () => {
    const ai = new AiConnections(fakeSettings() as never, log as never, [fakeAdapter('openai')])
    await expect(ai.write({ system: 's', prompt: 'p', maxTokens: 10, signal: new AbortController().signal, onText: () => {} })).rejects.toBeInstanceOf(NotConnectedError)
  })

  it('disconnect removes the saved key', async () => {
    const settings = fakeSettings()
    const ai = new AiConnections(settings as never, log as never, [fakeAdapter('openai', { goodKey: 'k' })])
    await ai.connect('openai', 'k')
    const list = await ai.disconnect('openai')
    expect(settings.secrets.openai).toBeUndefined()
    expect(list[0].state).toBe('disconnected')
  })

  it('only offers sign-in where the provider supports it', async () => {
    const ai = new AiConnections(fakeSettings() as never, log as never, [fakeAdapter('openai')])
    await expect(ai.signIn('openai')).rejects.toThrow(/doesn’t support signing in/)
  })
})

describe('Anthropic adapter', () => {
  it('reports "no credentials anywhere" as missing, not as a failure (real SDK)', async () => {
    const env = { ...process.env }
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    process.env.ANTHROPIC_CONFIG_DIR = 'Z:/definitely/not/here'
    const a = new AnthropicAdapter()
    try {
      await a.listModels({ source: 'cli-profile' })
      throw new Error('expected a credentials error')
    } catch (e) {
      expect(a.isMissingCredentials(e)).toBe(true)
    } finally {
      process.env = env
    }
  })
})

describe('model lists', () => {
  it('OpenAI: chat models only, GPT first', () => {
    const out = pickOpenAI([
      { id: 'text-embedding-3-large' },
      { id: 'gpt-5.1', created: 3 },
      { id: 'o4-mini', created: 2 },
      { id: 'gpt-4o-realtime-preview', created: 5 },
      { id: 'gpt-5-mini', created: 4 },
      { id: 'dall-e-3' },
      { id: 'gpt-4o-2024-08-06', created: 1 }
    ])
    expect(out.map((m) => m.id)).toEqual(['gpt-5-mini', 'gpt-5.1', 'o4-mini'])
    expect(out[0].name).toBe('GPT-5-mini')
  })

  it('Gemini: newest first, pro before flash, free tier marked', () => {
    const out = pickGemini([{ id: 'models/gemini-2.5-flash' }, { id: 'models/embedding-001' }, { id: 'models/gemini-3-pro' }, { id: 'models/gemini-2.5-pro' }])
    expect(out.map((m) => m.id)).toEqual(['gemini-3-pro', 'gemini-2.5-pro', 'gemini-2.5-flash'])
    expect(out.every((m) => m.free)).toBe(true)
    expect(out[0].name).toBe('Gemini 3 Pro')
  })

  it('OpenRouter: known vendors first, free models labelled', () => {
    const out = pickOpenRouter([
      { id: 'someone/obscure-model', created: 9 },
      { id: 'meta-llama/llama-4:free', name: 'Llama 4 (free)', pricing: { prompt: '0', completion: '0' } },
      { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', created: 5 },
      { id: 'openai/gpt-5.1', name: 'GPT-5.1', created: 6 }
    ])
    expect(out.map((m) => m.id)).toEqual(['anthropic/claude-opus-5.5', 'openai/gpt-5.1', 'meta-llama/llama-4:free'])
    expect(out[2]).toMatchObject({ name: 'Llama 4 (free)', free: true })
  })
})

describe('Sign in with OpenRouter (OAuth PKCE)', () => {
  it('runs the documented flow: browser → localhost callback → key exchange with the verifier', async () => {
    const realFetch = globalThis.fetch
    let exchanged: { code: string; code_verifier: string; code_challenge_method: string } | undefined
    let authUrl = ''
    // Stub only OpenRouter's key-exchange endpoint; the loopback callback uses the real network stack.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://openrouter.ai/api/v1/auth/keys') {
        exchanged = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ key: 'sk-or-issued' }), { status: 200 })
      }
      return realFetch(input, init)
    }) as typeof fetch
    try {
      const key = await signInWithOpenRouter(async (url) => {
        authUrl = url
        const u = new URL(url)
        // The "browser": OpenRouter redirects back to the callback with a code.
        setTimeout(() => void realFetch(`${u.searchParams.get('callback_url')}?code=abc123`), 20)
      })
      expect(key).toBe('sk-or-issued')
      const u = new URL(authUrl)
      expect(u.origin + u.pathname).toBe('https://openrouter.ai/auth')
      expect(u.searchParams.get('code_challenge_method')).toBe('S256')
      expect(u.searchParams.get('callback_url')).toMatch(/^http:\/\/localhost:\d+\/callback$/)
      expect(exchanged?.code).toBe('abc123')
      // The challenge sent to the browser is the SHA-256 of the verifier sent in the exchange.
      const { createHash } = await import('node:crypto')
      const expected = createHash('sha256').update(exchanged!.code_verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      expect(u.searchParams.get('code_challenge')).toBe(expected)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('can be cancelled', async () => {
    const ctrl = new AbortController()
    const p = signInWithOpenRouter(async () => {}, ctrl.signal)
    setTimeout(() => ctrl.abort(), 20)
    await expect(p).rejects.toThrow(/cancelled/)
  })
})
