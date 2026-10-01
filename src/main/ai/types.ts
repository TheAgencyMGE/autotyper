import type { AiModel, ProviderId, ProviderStatus } from '@shared/types'

/** Credentials resolved for one request. `apiKey` is absent when the SDK finds them itself (CLI login). */
export interface Credentials {
  apiKey?: string
  source: NonNullable<ProviderStatus['source']>
}

export interface StreamOptions {
  model: string
  system: string
  prompt: string
  maxTokens: number
  signal: AbortSignal
  onText: (delta: string) => void
}

/**
 * One AI provider. To add another, implement this and register it in
 * `createAdapters()` (src/main/ai/adapters.ts).
 */
export interface ProviderAdapter {
  readonly id: ProviderId
  readonly name: string
  /** Where to create an API key, if the provider uses keys. */
  readonly keyPage?: string
  readonly keyPlaceholder?: string
  /** Environment variables that hold a key, checked in order. */
  readonly envVars: string[]
  /** Supports "sign in with your account" in the browser (OAuth). */
  readonly signIn?: boolean
  /** Runs on this computer; nothing to sign in to. */
  readonly local?: boolean
  /** Credentials found without a saved key (e.g. a CLI login or a local server). */
  ambientCredentials?(): Credentials | null
  listModels(creds: Credentials): Promise<AiModel[]>
  /** Stream a completion; resolves with the full text. */
  stream(creds: Credentials, opts: StreamOptions): Promise<string>
  /** Turn an SDK error into one short sentence for people. */
  describeError(e: unknown): string
  /** True when the error only means "no credentials anywhere" (not a failure worth showing). */
  isMissingCredentials(e: unknown): boolean
}
