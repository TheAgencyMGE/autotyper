// Real-network checks against each provider (opt-in: AUTOTYPER_NETWORK_TESTS=1 npm test).
// Uses deliberately invalid keys, so it costs nothing and needs no accounts.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, safeStorage: {} }))
const { createAdapters } = await import('../src/main/ai/adapters')
const { pickOpenRouter } = await import('../src/main/ai/openaiCompatible')

describe.runIf(process.env.AUTOTYPER_NETWORK_TESTS)('providers (real API, invalid key)', () => {
  for (const a of createAdapters().filter((x) => !x.local)) {
    it(`${a.name} rejects a bad key with a clear message`, async () => {
      let message = ''
      try {
        await a.listModels({ apiKey: 'autotyper-invalid-test-key', source: 'saved-key' })
      } catch (e) {
        message = a.describeError(e)
      }
      expect(message).toMatch(/didn’t accept that key|doesn’t have access|returned an error \((400|401|403)\)/)
    }, 30_000)
  }

  it('Ollama reports "not running" as missing, not an error, when it isn’t installed', async () => {
    const ollama = createAdapters().find((x) => x.id === 'ollama')!
    try {
      const models = await ollama.listModels(ollama.ambientCredentials!()!)
      expect(Array.isArray(models)).toBe(true) // Ollama happens to be running
    } catch (e) {
      expect(ollama.isMissingCredentials(e)).toBe(true)
    }
  }, 15_000)

  it('OpenRouter’s real (public) model list parses, with free models labelled', async () => {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    const { data } = (await res.json()) as { data: Array<{ id: string; name: string; created: number; pricing: { prompt: string; completion: string } }> }
    const picked = pickOpenRouter(data)
    expect(picked.length).toBeGreaterThan(10)
    expect(picked.some((m) => m.free)).toBe(true)
    expect(picked[0].id).toMatch(/^anthropic\//)
    console.log(`OpenRouter: ${data.length} models → ${picked.length} shown, ${picked.filter((m) => m.free).length} free; first: ${picked.slice(0, 3).map((m) => m.name).join(', ')}`)
  }, 30_000)
})
