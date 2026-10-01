/** Types shared between the main process, preload bridge and renderer. */

/** AutoTyper's two modes: AutoCoder types code, AutoWriter types prose. */
export type TypingMode = 'code' | 'text'

export type HumanizationPresetId = 'instant' | 'fast' | 'normal' | 'slow' | 'veryHuman' | 'custom'

export interface HumanizationProfile {
  preset: HumanizationPresetId
  /** Lower bound of the typing speed band, in words per minute (5 chars = 1 word). */
  minWpm: number
  /** Upper bound of the typing speed band. */
  maxWpm: number
  /** Probability (0–0.08) that an eligible letter triggers a simulated typo. */
  mistakeRate: number
  /** Randomised per-keystroke rhythm and punctuation/word pauses. */
  pauseVariation: boolean
  /** Longer "thinking" pauses before blocks, blank lines and difficult lines. */
  thinkingPauses: boolean
  /** 0–1: how strongly speed drifts in bursts of faster/slower typing. */
  burstiness: number
  /** 0–1: how often random mid-line pauses and distractions happen. */
  pauseFrequency: number
  /** 0–1: how often the revision behaviours below kick in. */
  revisionRate: number
  behaviors: HumanBehaviors
}

/** Non-linear, "real programmer" editing behaviours. The final text is always exact. */
export interface HumanBehaviors {
  /** Copy an earlier similar line/block, paste it, then edit the differences. */
  copyPaste: boolean
  /** Leave a "// TODO: come back to this later" stub, write the next part, then return and fill it in. */
  todoComments: boolean
  /** False starts and drafts that get deleted and rewritten. */
  rewrites: boolean
  /** Notice a wrong identifier a few lines later and go back to fix it. */
  lateFixes: boolean
  /** Arrow back up to re-read recent lines, then return. */
  rereading: boolean
  /** Occasional longer breaks (looking away, thinking, checking docs). */
  distractions: boolean
  /** Gradual slowdown over long sessions, recovering after breaks. */
  fatigue: boolean
}

export type EditorKind =
  | 'vscode'
  | 'cursor'
  | 'windsurf'
  | 'notepad'
  | 'notepadpp'
  | 'sublime'
  | 'jetbrains'
  | 'visualstudio'
  | 'zed'
  | 'word'
  | 'googledocs'
  | 'wordpad'
  | 'onenote'
  | 'libreoffice'
  | 'webdoc'
  | 'other'

export interface WindowInfo {
  /** Opaque, platform-specific window handle (HWND on Windows). */
  id: string
  pid: number
  title: string
  processName: string
  exePath?: string
  editor: EditorKind
  /** Friendly application name, e.g. "VS Code". */
  appName: string
  /** Any app you can type text into on purpose (code editor or document editor). */
  isEditor: boolean
  /** What the app is for, used to suggest the right windows per mode. */
  category: 'code' | 'document' | 'other'
  /** Runs as administrator. */
  elevated?: boolean
  /** Windows won't let AutoTyper type into it (it's elevated and AutoTyper isn't). */
  blocked?: boolean
}

export type TypingState = 'idle' | 'countdown' | 'typing' | 'paused' | 'stopped' | 'completed' | 'error'

export type TypingActivity = 'typing' | 'thinking' | 'correcting' | 'waiting' | 'navigating' | 'revising' | 'pasting'

export interface TypingStatus {
  state: TypingState
  target?: WindowInfo
  typedChars: number
  totalChars: number
  currentLine: number
  totalLines: number
  /** Measured words per minute over the recent window. */
  wpm: number
  etaMs: number
  elapsedMs: number
  countdown?: number
  /** Human-readable detail: why paused, what went wrong, etc. */
  detail?: string
  /** What the humanizer is currently doing. */
  activity?: TypingActivity
  mistakesMade: number
  /** Copy-pastes, TODO returns, rewrites and late fixes performed so far. */
  revisions: number
  /** Live speed multiplier applied on top of the profile (1 = as planned). */
  speedMultiplier: number
  preset?: HumanizationPresetId
  mode?: TypingMode
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id: number
  ts: number
  level: LogLevel
  source: string
  message: string
}

/** AI providers AutoTyper can write with. */
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama'
/** 'offline' = built-in samples, used by tests and demos only. */
export type CodegenProvider = ProviderId | 'offline'

export interface Settings {
  humanization: HumanizationProfile
  /** Which provider and model write code and text. */
  codegen: {
    provider: CodegenProvider
    model: string
  }
  hotkeys: {
    stop: string
    pauseResume: string
  }
  /** Neutralise editor auto-close/auto-indent/IntelliSense so the final text matches exactly. */
  editorSafeMode: boolean
  countdownSeconds: number
  lastProjectDir?: string
  /** Last used mode. */
  mode: TypingMode
}

/** Settings fields the renderer may change directly (API keys have their own calls). */
export type SettingsPatch = Partial<Omit<Settings, 'codegen'>> & {
  codegen?: Partial<Settings['codegen']>
}

export interface ProjectNode {
  name: string
  /** Path relative to the project root, using forward slashes. */
  path: string
  type: 'file' | 'dir'
  children?: ProjectNode[]
}

export interface ProjectInfo {
  root: string
  name: string
  tree: ProjectNode
  fileCount: number
  truncated: boolean
}

export interface GenerateRequest {
  mode: TypingMode
  prompt: string
  /** Code currently in the preview editor, used as a starting point / for refinement. */
  existingCode?: string
  projectRoot?: string
  targetFile?: string
}

export interface GenerateResult {
  ok: boolean
  provider: CodegenProvider
  code?: string
  error?: string
  cancelled?: boolean
  /** No AI provider is connected yet; the UI should offer to connect one. */
  needsConnection?: boolean
}

export interface StartTypingRequest {
  mode: TypingMode
  code: string
  windowId: string
  profile: HumanizationProfile
  /** The user explicitly confirmed this target in the confirmation dialog. */
  confirmed: boolean
}

export interface AiModel {
  id: string
  name: string
  /** Costs nothing to use (free tier / free model / runs locally). */
  free?: boolean
}

/** One AI provider's connection, as the app sees it. */
export interface ProviderStatus {
  id: ProviderId
  name: string
  state: 'connected' | 'disconnected' | 'error'
  /** Where the credentials came from. */
  source?: 'saved-key' | 'signed-in' | 'environment' | 'cli-profile' | 'local'
  /** Models this account can use, best first. */
  models: AiModel[]
  error?: string
  checkedAt?: number
}

export type HumanizerVoiceId = 'auto' | 'casual' | 'professional' | 'technical' | 'warm' | 'blunt'
export type HumanizerPurposeId = 'general' | 'essay' | 'email' | 'marketing' | 'technical'

export interface HumanizeRequest {
  text: string
  voice: HumanizerVoiceId
  purpose: HumanizerPurposeId
  aggressive: boolean
  /** Run a second, corrective pass if the local checker still finds AI tells. */
  doubleCheck: boolean
}

export interface WritingScore {
  /** 0 = reads human, 100 = heavy AI tells. */
  score: number
  verdict: string
  words: number
}

export interface HumanizeResult {
  ok: boolean
  text?: string
  summary?: string
  before: WritingScore
  after?: WritingScore
  /** Numbers, dates, URLs or acronyms from the original that the rewrite dropped. */
  lostFacts?: string[]
  /** How many AI passes ran (1, or 2 when the double-check helped). */
  passes?: number
  /** AI tells the local checker found before and after. */
  tellsBefore?: number
  tellsAfter?: number
  error?: string
  cancelled?: boolean
  needsConnection?: boolean
}

export interface HotkeyEvent {
  action: 'stop' | 'pauseResume'
}

export interface AutoTyperApi {
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
  }
  ai: {
    status(): Promise<ProviderStatus[]>
    refresh(id?: ProviderId): Promise<ProviderStatus[]>
    /** Verify a pasted API key with the provider, then save it (encrypted). */
    connect(id: ProviderId, apiKey: string): Promise<ProviderStatus[]>
    /** Sign in with your account in the browser (providers that support it). */
    signIn(id: ProviderId): Promise<ProviderStatus[]>
    disconnect(id: ProviderId): Promise<ProviderStatus[]>
    openKeyPage(id: ProviderId): Promise<void>
  }
  humanizer: {
    rewrite(req: HumanizeRequest): Promise<HumanizeResult>
    cancel(): Promise<void>
    onChunk(cb: (text: string) => void): () => void
  }
  codegen: {
    generate(req: GenerateRequest): Promise<GenerateResult>
    cancel(): Promise<void>
    onChunk(cb: (text: string) => void): () => void
  }
  project: {
    pick(): Promise<ProjectInfo | null>
    open(root: string): Promise<ProjectInfo | null>
    readFile(root: string, relPath: string): Promise<string>
  }
  windows: {
    list(): Promise<WindowInfo[]>
    openFileInEditor(windowId: string, root: string, relPath: string): Promise<{ ok: boolean; error?: string }>
  }
  typing: {
    start(req: StartTypingRequest): Promise<{ ok: boolean; error?: string }>
    pause(): Promise<void>
    resume(): Promise<void>
    stop(): Promise<void>
    setSpeed(multiplier: number): Promise<void>
    estimate(code: string, profile: HumanizationProfile, mode: TypingMode): Promise<number>
    status(): Promise<TypingStatus>
    onStatus(cb: (s: TypingStatus) => void): () => void
  }
  files: {
    save(code: string, suggestedName: string): Promise<string | null>
  }
  log: {
    history(): Promise<LogEntry[]>
    onEntry(cb: (e: LogEntry) => void): () => void
    clear(): Promise<void>
  }
  onHotkey(cb: (e: HotkeyEvent) => void): () => void
  platform: string
}
