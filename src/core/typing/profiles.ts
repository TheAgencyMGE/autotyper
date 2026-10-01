import type { HumanBehaviors, HumanizationPresetId, HumanizationProfile } from '@shared/types'

const ALL_ON: HumanBehaviors = {
  copyPaste: true,
  todoComments: true,
  rewrites: true,
  lateFixes: true,
  rereading: true,
  distractions: true,
  fatigue: true
}
const ALL_OFF: HumanBehaviors = {
  copyPaste: false,
  todoComments: false,
  rewrites: false,
  lateFixes: false,
  rereading: false,
  distractions: false,
  fatigue: false
}

export const PRESETS: Record<Exclude<HumanizationPresetId, 'custom'>, HumanizationProfile> = {
  instant: {
    preset: 'instant', minWpm: 0, maxWpm: 0, mistakeRate: 0, pauseVariation: false, thinkingPauses: false, burstiness: 0,
    pauseFrequency: 0, revisionRate: 0, behaviors: ALL_OFF
  },
  fast: {
    preset: 'fast', minWpm: 85, maxWpm: 115, mistakeRate: 0.006, pauseVariation: true, thinkingPauses: false, burstiness: 0.3,
    pauseFrequency: 0.1, revisionRate: 0.2, behaviors: { ...ALL_OFF, copyPaste: true, lateFixes: true }
  },
  normal: {
    preset: 'normal', minWpm: 55, maxWpm: 75, mistakeRate: 0.012, pauseVariation: true, thinkingPauses: true, burstiness: 0.5,
    pauseFrequency: 0.3, revisionRate: 0.45, behaviors: { ...ALL_ON, todoComments: false, distractions: false }
  },
  slow: {
    preset: 'slow', minWpm: 28, maxWpm: 42, mistakeRate: 0.014, pauseVariation: true, thinkingPauses: true, burstiness: 0.5,
    pauseFrequency: 0.45, revisionRate: 0.5, behaviors: ALL_ON
  },
  veryHuman: {
    preset: 'veryHuman', minWpm: 48, maxWpm: 78, mistakeRate: 0.022, pauseVariation: true, thinkingPauses: true, burstiness: 0.9,
    pauseFrequency: 0.55, revisionRate: 0.85, behaviors: ALL_ON
  }
}

export const PRESET_ORDER: HumanizationPresetId[] = ['instant', 'fast', 'normal', 'slow', 'veryHuman', 'custom']

export const PRESET_LABELS: Record<HumanizationPresetId, string> = {
  instant: 'Instant',
  fast: 'Fast',
  normal: 'Normal',
  slow: 'Slow',
  veryHuman: 'Very Human',
  custom: 'Custom'
}

export const BEHAVIOR_LABELS: Record<keyof HumanBehaviors, { label: string; hint: string }> = {
  copyPaste: { label: 'Copy & paste similar code', hint: 'Copies an earlier similar line or block, pastes it, then edits the differences' },
  todoComments: { label: 'TODO stubs, return later', hint: 'Leaves "// TODO: come back to this later", writes the next part, then comes back to fill it in' },
  rewrites: { label: 'Drafts & false starts', hint: 'Types a different first attempt, deletes it and rewrites it' },
  lateFixes: { label: 'Go back to fix mistakes', hint: 'Notices a wrong name a few lines later and goes back up to fix it' },
  rereading: { label: 'Re-read recent code', hint: 'Arrows back up through recent lines, then returns' },
  distractions: { label: 'Distraction breaks', hint: 'Occasional longer pauses, like looking something up' },
  fatigue: { label: 'Fatigue', hint: 'Slows down gradually over long sessions and recovers after breaks' }
}

export const LIMITS = {
  minWpm: 10,
  maxWpm: 220,
  maxMistakeRate: 0.08
}

/** Clamp a (possibly user-edited or older-version) profile into safe, sensible bounds. */
export function normalizeProfile(p: Partial<HumanizationProfile> & { preset: HumanizationPresetId }): HumanizationProfile {
  if (p.preset === 'instant') return { ...PRESETS.instant, behaviors: { ...ALL_OFF } }
  const base = p.preset === 'custom' ? PRESETS.normal : PRESETS[p.preset]
  const clamp = (v: number | undefined, lo: number, hi: number, dflt: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt
    return Math.min(hi, Math.max(lo, n))
  }
  let minWpm = Math.round(clamp(p.minWpm, LIMITS.minWpm, LIMITS.maxWpm, base.minWpm))
  let maxWpm = Math.round(clamp(p.maxWpm, LIMITS.minWpm, LIMITS.maxWpm, base.maxWpm))
  if (minWpm > maxWpm) [minWpm, maxWpm] = [maxWpm, minWpm]
  return {
    preset: p.preset,
    minWpm,
    maxWpm,
    mistakeRate: clamp(p.mistakeRate, 0, LIMITS.maxMistakeRate, base.mistakeRate),
    pauseVariation: p.pauseVariation ?? base.pauseVariation,
    thinkingPauses: p.thinkingPauses ?? base.thinkingPauses,
    burstiness: clamp(p.burstiness, 0, 1, base.burstiness),
    pauseFrequency: clamp(p.pauseFrequency, 0, 1, base.pauseFrequency),
    revisionRate: clamp(p.revisionRate, 0, 1, base.revisionRate),
    behaviors: { ...base.behaviors, ...p.behaviors }
  }
}
