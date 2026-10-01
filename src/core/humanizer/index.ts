/**
 * AutoWriter's humanizer: a local, offline AI-tell score plus helpers for the
 * Claude rewrite. Scoring and fact-checking come from humanizer-skill by
 * Adam Boudjemaa (MIT): https://github.com/Aboudjem/humanizer-skill
 */
import { diffFacts, type FactDiff } from './vendor/facts.js'
import { scoreText } from './vendor/metrics.js'

export type HumanizerVoice = 'auto' | 'casual' | 'professional' | 'technical' | 'warm' | 'blunt'
export type HumanizerPurpose = 'general' | 'essay' | 'email' | 'marketing' | 'technical'

export interface TextScore {
  /** 0 = reads human, 100 = heavy AI tells. */
  score: number
  verdict: string
  words: number
}

export function scoreWriting(text: string): TextScore {
  const r = scoreText(text)
  return { score: r.score, verdict: r.verdict, words: r.metrics.wordCount }
}

export function checkFacts(before: string, after: string): FactDiff {
  return diffFacts(before, after)
}

/**
 * The skill's rewrite mode ends with a "---" line and a "Changes: …" summary.
 * Split them so only the rewritten text gets typed.
 */
export function splitRewrite(output: string): { text: string; summary?: string } {
  const m = /\n\s*-{3,}\s*\n+\s*Changes:\s*([\s\S]*)$/i.exec(output)
  if (!m) return { text: output.trim() }
  return { text: output.slice(0, m.index).trim(), summary: m[1].trim() }
}
