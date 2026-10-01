import type { GenerateRequest } from '@shared/types'

export interface GenerationInput {
  request: GenerateRequest
  signal: AbortSignal
  onText: (delta: string) => void
}
