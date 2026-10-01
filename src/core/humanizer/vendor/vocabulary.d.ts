export const TIER1_WORDS: string[]
export const TIER2_WORDS: string[]
export const PHRASES: string[]
export function lexicalTells(text: string, tokens: string[]): { tier1: number; tier2: number; phrases: number; weighted: number; density: number }
