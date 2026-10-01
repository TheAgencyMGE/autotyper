import type { AiModel, HumanBehaviors, HumanizationPresetId, HumanizerPurposeId, HumanizerVoiceId, ProviderStatus, Settings, TypingMode, TypingStatus, WindowInfo } from '@shared/types'

export const MODE_NAME: Record<TypingMode, string> = { code: 'AutoCoder', text: 'AutoWriter' }

/** How each typing style reads inside the settings sentence ("…and type it into VS Code, like a person."). */
export const STYLE_PHRASE: Record<HumanizationPresetId, string> = {
  instant: 'all at once',
  fast: 'quickly',
  normal: 'at a steady pace',
  slow: 'slowly',
  veryHuman: 'like a person',
  custom: 'my own way'
}

export function styleOptions(mode: TypingMode): Array<{ id: HumanizationPresetId; name: string; desc: string }> {
  return [
    {
      id: 'veryHuman',
      name: 'Like a person',
      desc:
        mode === 'code'
          ? 'Pauses to think, makes typos and fixes them, copies similar code, leaves TODOs and comes back to them.'
          : 'Pauses between sentences, fixes typos, swaps words for better ones and goes back to fix slips.'
    },
    { id: 'normal', name: 'At a steady pace', desc: 'Around 55–75 words a minute, with the occasional slip and rewrite.' },
    { id: 'slow', name: 'Slowly', desc: 'Around 30–40 words a minute. Lots of thinking.' },
    { id: 'fast', name: 'Quickly', desc: 'Around 85–115 words a minute. Rarely stops.' },
    { id: 'instant', name: 'All at once', desc: mode === 'code' ? 'Line after line with no pauses and no typos.' : 'Paragraph after paragraph with no pauses and no typos.' },
    { id: 'custom', name: 'My own way', desc: 'Set the speed, typos, pauses and habits yourself.' }
  ]
}

export function styleName(mode: TypingMode, id: HumanizationPresetId): string {
  return styleOptions(mode).find((s) => s.id === id)?.name ?? ''
}

/** Which habits apply in each mode, with wording that fits it. */
export function behaviourLabels(mode: TypingMode): Array<{ key: keyof HumanBehaviors; label: string; hint: string }> {
  if (mode === 'text') {
    return [
      { key: 'rewrites', label: 'Rewrites as it goes', hint: 'Swaps a word for a better one and sometimes restarts a sentence' },
      { key: 'lateFixes', label: 'Goes back to fix slips', hint: 'Types then for than, notices a sentence later and goes back to fix it' },
      { key: 'distractions', label: 'Takes short breaks', hint: 'Now and then stops for a few seconds between paragraphs' },
      { key: 'fatigue', label: 'Gets tired', hint: 'Slows down gradually over long pieces and recovers after breaks' }
    ]
  }
  return [
    { key: 'copyPaste', label: 'Copies similar code', hint: 'Copies an earlier similar line or block, pastes it, then edits the differences' },
    { key: 'todoComments', label: 'Leaves TODOs, comes back', hint: 'Writes “TODO: come back to this later”, does the next part, then returns to fill it in' },
    { key: 'rewrites', label: 'Drafts and false starts', hint: 'Types a first attempt, deletes it and rewrites it' },
    { key: 'lateFixes', label: 'Goes back to fix mistakes', hint: 'Notices a wrong name a few lines later and goes back up to fix it' },
    { key: 'rereading', label: 'Re-reads recent code', hint: 'Arrows back up through recent lines, then returns' },
    { key: 'distractions', label: 'Takes short breaks', hint: 'Occasional longer pauses, like looking something up' },
    { key: 'fatigue', label: 'Gets tired', hint: 'Slows down gradually over long sessions and recovers after breaks' }
  ]
}

const FULL_APP_NAMES: Partial<Record<WindowInfo['editor'], string>> = {
  vscode: 'Visual Studio Code',
  visualstudio: 'Visual Studio'
}

export function appName(win: WindowInfo): string {
  if (win.editor === 'vscode' && win.appName !== 'VS Code') return win.appName
  return FULL_APP_NAMES[win.editor] ?? win.appName
}

const ACTIVITY: Record<TypingMode, Record<NonNullable<TypingStatus['activity']>, string>> = {
  code: {
    typing: 'Typing',
    thinking: 'Thinking for a moment',
    correcting: 'Fixing a typo',
    navigating: 'Moving around the file',
    revising: 'Reworking a line',
    pasting: 'Copying a similar piece',
    waiting: 'Waiting'
  },
  text: {
    typing: 'Writing',
    thinking: 'Thinking about the next sentence',
    correcting: 'Fixing a typo',
    navigating: 'Going back to fix a word',
    revising: 'Reworking a sentence',
    pasting: 'Pasting',
    waiting: 'Waiting'
  }
}

export function activityPhrase(status: TypingStatus, recentNote?: string): string {
  if (status.state === 'paused') return status.detail ?? 'Paused'
  if (recentNote) return recentNote
  if (status.activity === 'waiting' && status.detail) return status.detail
  return ACTIVITY[status.mode ?? 'code'][status.activity ?? 'typing']
}

export const SUGGESTIONS: Record<TypingMode, string[]> = {
  code: [
    'A personal portfolio with a warm editorial design, a project gallery, an about page and a contact form.',
    'A small Express API for a to-do list: create, list, complete and delete.',
    'A Python script that counts the most common words in a text file.'
  ],
  text: [
    'A short, friendly email asking my team to move Thursday’s meeting to Friday morning.',
    'A 400-word blog post about why small teams ship faster, with one concrete example.',
    'A cover letter for a junior product designer role at a small studio.'
  ]
}

export const VOICES: Array<{ id: HumanizerVoiceId; name: string }> = [
  { id: 'auto', name: 'Match the original' },
  { id: 'casual', name: 'Casual' },
  { id: 'professional', name: 'Professional' },
  { id: 'warm', name: 'Warm' },
  { id: 'blunt', name: 'Direct' },
  { id: 'technical', name: 'Technical' }
]

export const PURPOSES: Array<{ id: HumanizerPurposeId; name: string }> = [
  { id: 'general', name: 'Anything' },
  { id: 'essay', name: 'Essay' },
  { id: 'email', name: 'Email' },
  { id: 'marketing', name: 'Marketing' },
  { id: 'technical', name: 'Technical writing' }
]

/** The provider and model that will write, chosen the same way the main process picks it. */
export function activeModel(providers: ProviderStatus[], codegen: Settings['codegen']): { provider: ProviderStatus; model: AiModel } | null {
  const connected = providers.filter((p) => p.state === 'connected' && p.models.length)
  const provider = connected.find((p) => p.id === codegen.provider) ?? connected[0]
  if (!provider) return null
  return { provider, model: provider.models.find((m) => m.id === codegen.model) ?? provider.models[0] }
}
