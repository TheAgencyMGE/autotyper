export interface ScoreSignal {
  name: string
  metric: string
  raw: number
  normalized: number
  weight: number
  points: number
}

export interface ScoreResult {
  metrics: { wordCount: number; sentenceCount: number; [key: string]: unknown }
  score: number
  scoreRaw: number
  verdict: string
  signals: ScoreSignal[]
}

export function scoreText(rawText: string, options?: { ignoreCode?: boolean; ignoreQuotes?: boolean }): ScoreResult
