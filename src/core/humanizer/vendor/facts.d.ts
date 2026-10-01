export type FactKind = 'urls' | 'dates' | 'percentages' | 'versions' | 'numbers' | 'acronyms'

export interface FactDiff {
  lost: Array<{ kind: FactKind; value: string }>
  ok: boolean
  counts: { before: number; after: number }
}

export function diffFacts(beforeText: string, afterText: string): FactDiff
