import Anthropic from '@anthropic-ai/sdk'
import type { AiModel } from '@shared/types'
import type { Credentials, ProviderAdapter, StreamOptions } from './types'

/** Preferred order when several models are available; anything else follows, newest first. */
const PREFERRED = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5-1']

/**
 * Claude via the official Anthropic SDK. Besides a pasted key or
 * ANTHROPIC_API_KEY, an Anthropic CLI login (`ant auth login`) works too:
 * the SDK reads it on its own when no key is given.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic' as const
  readonly name = 'Claude'
  readonly keyPage = 'https://console.anthropic.com/settings/keys'
  readonly keyPlaceholder = 'sk-ant-…'
  readonly envVars = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']

  ambientCredentials(): Credentials {
    return { source: 'cli-profile' }
  }

  private client(creds: Credentials): Anthropic {
    if (creds.apiKey) return new Anthropic({ apiKey: creds.apiKey })
    return new Anthropic() // environment or CLI profile
  }

  async listModels(creds: Credentials): Promise<AiModel[]> {
    const found: Array<AiModel & { created: string }> = []
    for await (const m of this.client(creds).models.list({ limit: 100 })) {
      if (!m.id.startsWith('claude-') || m.id.startsWith('claude-mythos')) continue
      found.push({ id: m.id, name: m.display_name || m.id, created: String(m.created_at ?? '') })
    }
    const rank = (id: string) => (PREFERRED.includes(id) ? PREFERRED.indexOf(id) : PREFERRED.length)
    found.sort((a, b) => rank(a.id) - rank(b.id) || b.created.localeCompare(a.created))
    return found.map(({ id, name }) => ({ id, name }))
  }

  async stream(creds: Credentials, o: StreamOptions): Promise<string> {
    const client = this.client(creds)
    // Server-side fallback reroutes a safety-classifier decline to another model
    // inside the same call ("default" picks the route by refusal category).
    const params = {
      model: o.model,
      max_tokens: o.maxTokens,
      system: o.system,
      messages: [{ role: 'user' as const, content: o.prompt }],
      output_config: { effort: 'medium' as const },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    }
    const stream = client.beta.messages.stream(params as unknown as Parameters<typeof client.beta.messages.stream>[0], { signal: o.signal })
    stream.on('text', (delta) => o.onText(delta))
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rephrasing it.')
    return message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  }

  isMissingCredentials(e: unknown): boolean {
    // No credentials anywhere: the SDK throws a plain Error before making a request.
    return !(e instanceof Anthropic.APIError) && /could not resolve authentication|no (api )?key|credential/i.test((e as Error)?.message ?? '')
  }

  describeError(e: unknown): string {
    if (e instanceof Anthropic.AuthenticationError) return 'Anthropic didn’t accept that key. Check it was copied in full.'
    if (e instanceof Anthropic.PermissionDeniedError) return 'This key doesn’t have access to the Anthropic API.'
    if (e instanceof Anthropic.NotFoundError) return 'Your Anthropic account can’t use that model. Pick another one.'
    if (e instanceof Anthropic.RateLimitError) return 'Anthropic is rate-limiting requests right now. Try again in a moment.'
    if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach Anthropic. Check your internet connection.'
    if (e instanceof Anthropic.InternalServerError) return 'Anthropic had a problem on their side. Try again shortly.'
    if (e instanceof Anthropic.APIError) return `Anthropic returned an error (${e.status ?? 'unknown'}).`
    return (e as Error)?.message || 'Something went wrong talking to Anthropic.'
  }
}
