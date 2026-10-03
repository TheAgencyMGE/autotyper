import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectLanguage, EXTENSION_FOR } from '@core/codegen/language'
import { stripCodeFences } from '@core/codegen/prompt'
import { splitRewrite } from '@core/humanizer'
import { findTells, quickFix } from '@core/humanizer/tells'
import { PRESETS } from '@core/typing/profiles'
import type { HumanizationProfile, HumanizeResult, LogEntry, ProjectInfo, ProviderId, ProviderStatus, Settings, SettingsPatch, TypingMode, TypingStatus, WindowInfo } from '@shared/types'
import { Building } from './components/Building'
import { ActivityDrawer, TopBar } from './components/Chrome'
import { Compose } from './components/Compose'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Connections } from './components/Connections'
import type { HumanizerOptions } from './components/HumanizerPanel'
import type { SentenceProps } from './components/Sentence'
import { SettingsDialog } from './components/SettingsDialog'
import { Workspace } from './components/Workspace'
import { activeModel, appName } from './lib/copy'

const api = window.autotyper

const IDLE: TypingStatus = {
  state: 'idle', typedChars: 0, totalChars: 0, currentLine: 0, totalLines: 0, wpm: 0, etaMs: 0, elapsedMs: 0, mistakesMade: 0, revisions: 0, speedMultiplier: 1
}
const OPENABLE = new Set(['vscode', 'cursor', 'windsurf', 'notepadpp', 'sublime', 'zed'])
const NOTE_TTL_MS = 5000

type View = 'compose' | 'workspace'
type Source = 'idea' | 'paste'

/** Everything the user is working on in one mode. Each mode keeps its own draft. */
interface Draft {
  source: Source
  prompt: string
  pasted: string
  /** What gets previewed and typed. */
  content: string
}

const EMPTY_DRAFT: Draft = { source: 'idea', prompt: '', pasted: '', content: '' }

function loadDraft(mode: TypingMode): Draft {
  try {
    const raw = localStorage.getItem(`autotyper.${mode}.draft`)
    if (raw) return { ...EMPTY_DRAFT, ...JSON.parse(raw) }
    // Carry over the draft from the AutoCoder days.
    if (mode === 'code') return { ...EMPTY_DRAFT, prompt: localStorage.getItem('autocoder.prompt') ?? '', content: localStorage.getItem('autocoder.code') ?? '' }
  } catch {
    /* storage unavailable */
  }
  return { ...EMPTY_DRAFT }
}

function loadHumanizerOptions(): HumanizerOptions {
  try {
    const raw = localStorage.getItem('autotyper.humanizer')
    if (raw) return { voice: 'auto', purpose: 'general', aggressive: false, doubleCheck: true, ...JSON.parse(raw) }
  } catch {
    /* storage unavailable */
  }
  return { voice: 'auto', purpose: 'general', aggressive: false, doubleCheck: true }
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [mode, setModeState] = useState<TypingMode>('code')
  const [drafts, setDrafts] = useState<Record<TypingMode, Draft>>(() => ({ code: loadDraft('code'), text: loadDraft('text') }))
  const [view, setView] = useState<View>('compose')
  const [showRun, setShowRun] = useState(false)
  const [editable, setEditable] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [justFinished, setJustFinished] = useState(false)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [targetFile, setTargetFile] = useState<string>()
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [profile, setProfile] = useState<HumanizationProfile>(PRESETS.veryHuman)
  const [status, setStatus] = useState<TypingStatus>(IDLE)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [estimateMs, setEstimateMs] = useState<number | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [quickFixed, setQuickFixed] = useState<number | null>(null)
  const [humanizerOptions, setHumanizerOptionsState] = useState<HumanizerOptions>(loadHumanizerOptions)
  const [humanizing, setHumanizing] = useState(false)
  const [humanizeResult, setHumanizeResult] = useState<HumanizeResult | null>(null)
  const [undoText, setUndoText] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const rawGen = useRef('')
  const toastTimer = useRef<number | undefined>(undefined)

  const draft = drafts[mode]
  const content = draft.content
  const active = status.state === 'typing' || status.state === 'paused' || status.state === 'countdown'
  const busy = generating || humanizing
  const selected = windows.find((w) => w.id === selectedId)
  const language = useMemo(() => detectLanguage(content, targetFile), [content, targetFile])
  const automationReady = logs.some((l) => l.source === 'automation' && l.level === 'success')

  const notify = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  const updateDraft = useCallback((m: TypingMode, patch: Partial<Draft>) => {
    setDrafts((all) => {
      const next = { ...all, [m]: { ...all[m], ...patch } }
      try {
        localStorage.setItem(`autotyper.${m}.draft`, JSON.stringify(next[m]))
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }, [])
  const setContent = useCallback((c: string) => updateDraft(mode, { content: c }), [mode, updateDraft])

  const setHumanizerOptions = (o: HumanizerOptions) => {
    setHumanizerOptionsState(o)
    try {
      localStorage.setItem('autotyper.humanizer', JSON.stringify(o))
    } catch {
      /* storage unavailable */
    }
  }

  const setMode = (m: TypingMode) => {
    if (m === mode || active) return
    setModeState(m)
    setView('compose')
    setEditable(false)
    setJustFinished(false)
    setHumanizeResult(null)
    setUndoText(null)
    void api.settings.update({ mode: m })
  }

  // ------------------------------------------------------------ bootstrapping

  const refreshWindows = useCallback(async () => {
    setRefreshing(true)
    try {
      const list = await api.windows.list()
      setWindows(list)
      // Never silently retarget: if the chosen window vanished, clear the selection.
      setSelectedId((cur) => (cur && !list.some((w) => w.id === cur) ? undefined : cur))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void api.settings.get().then((s) => {
      setSettings(s)
      setProfile(s.humanization)
      setModeState(s.mode ?? 'code')
      if (s.lastProjectDir) void api.project.open(s.lastProjectDir).then((p) => p && setProject(p))
    })
    void api.ai.status().then(setProviders)
    void api.log.history().then(setLogs)
    void api.typing.status().then((s) => {
      setStatus(s)
      if (s.state === 'typing' || s.state === 'paused' || s.state === 'countdown') setShowRun(true)
    })
    void refreshWindows()
    const offs = [
      api.log.onEntry((e) => {
        setLogs((l) => [...l.slice(-599), e])
        // The connections manager logs when a provider's state changes; pick up the new status.
        if (e.source === 'ai') void api.ai.status().then(setProviders)
      }),
      api.typing.onStatus((s) => {
        setStatus(s)
        if (s.state === 'typing' || s.state === 'paused' || s.state === 'countdown') setShowRun(true)
      }),
      api.onHotkey((e) => {
        if (e.action === 'stop') notify('Stopped with the shortcut. Nothing more will be typed.')
      }),
      api.settings.onChanged((s) => setSettings(s))
    ]
    return () => offs.forEach((off) => off())
  }, [refreshWindows, notify])

  useEffect(() => {
    if (automationReady) void refreshWindows()
  }, [automationReady, refreshWindows])

  useEffect(() => {
    if (active) return
    const id = window.setInterval(() => {
      if (document.hasFocus()) void refreshWindows()
    }, 5000)
    return () => window.clearInterval(id)
  }, [active, refreshWindows])

  useEffect(() => {
    if (!settings) return
    const id = window.setTimeout(() => void api.settings.update({ humanization: profile }), 400)
    return () => window.clearTimeout(id)
  }, [profile, settings])

  useEffect(() => {
    if (!content) {
      setEstimateMs(null)
      return
    }
    const id = window.setTimeout(() => void api.typing.estimate(content, profile, mode).then(setEstimateMs), 250)
    return () => window.clearTimeout(id)
  }, [content, profile, mode])

  // The most recent "what it's doing" note from the humanizer, while it's fresh.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  // AutoWriter marks phrases that read as AI right in the document.
  const tellMarks = useMemo(() => (mode === 'text' && !humanizing ? findTells(content).map((t) => ({ start: t.start, end: t.end, why: t.why })) : undefined), [mode, content, humanizing])

  const recentNote = useMemo(() => {
    const last = [...logs].reverse().find((l) => l.source === 'humanizer' && l.level === 'info' && !l.message.startsWith('Rewriting'))
    return last && now - last.ts < NOTE_TTL_MS ? last.message : undefined
  }, [logs, now])

  // ----------------------------------------------------------- writing it

  const generate = useCallback(async () => {
    if (!draft.prompt.trim() || busy) return
    const m = mode
    setView('workspace')
    setGenerating(true)
    setEditable(false)
    setJustFinished(false)
    setHumanizeResult(null)
    setUndoText(null)
    const previous = draft.content
    rawGen.current = ''
    updateDraft(m, { content: '' })
    let frame = 0
    const off = api.codegen.onChunk((delta) => {
      rawGen.current += delta
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          updateDraft(m, { content: stripCodeFences(rawGen.current) })
        })
      }
    })
    try {
      const res = await api.codegen.generate({ mode: m, prompt: draft.prompt, projectRoot: m === 'code' ? project?.root : undefined, targetFile: m === 'code' ? targetFile : undefined })
      cancelAnimationFrame(frame)
      if (res.ok && res.code !== undefined) {
        updateDraft(m, { content: res.code })
        setJustFinished(true)
        window.setTimeout(() => setJustFinished(false), 4000)
      } else if (res.cancelled) {
        updateDraft(m, { content: stripCodeFences(rawGen.current) || previous })
      } else {
        updateDraft(m, { content: previous })
        if (res.needsConnection) {
          setAiOpen(true)
          if (!previous) setView('compose')
        } else notify(res.error ?? 'Couldn’t write that. Try again.')
      }
    } finally {
      off()
      setGenerating(false)
    }
  }, [draft, busy, mode, project, targetFile, updateDraft, notify])

  const continueWithPasted = () => {
    updateDraft(mode, { content: draft.pasted })
    setHumanizeResult(null)
    setUndoText(null)
    setEditable(false)
    setView('workspace')
  }

  const humanize = useCallback(
    async (textArg?: string) => {
      const original = textArg ?? draft.content
      if (!original.trim() || busy) return
      const m = mode
      setView('workspace')
      setHumanizing(true)
      setEditable(false)
      setHumanizeResult(null)
      let raw = ''
      let frame = 0
      const off = api.humanizer.onChunk((delta) => {
        // A NUL marks the start of the second, corrective pass: show it fresh.
        if (delta === '\u0000') {
          raw = ''
          return
        }
        raw += delta
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0
            updateDraft(m, { content: splitRewrite(raw).text })
          })
        }
      })
      try {
        const res = await api.humanizer.rewrite({ text: original, ...humanizerOptions })
        cancelAnimationFrame(frame)
        setHumanizeResult(res)
        if (res.ok && res.text) {
          updateDraft(m, { content: res.text })
          setUndoText(original)
          setQuickFixed(null)
        } else {
          updateDraft(m, { content: original })
          if (res.needsConnection) setAiOpen(true)
          else if (res.error && !res.cancelled) notify(res.error)
        }
      } finally {
        off()
        setHumanizing(false)
      }
    },
    [draft.content, busy, mode, humanizerOptions, updateDraft, notify]
  )

  // ------------------------------------------------------------------- typing

  const requestStart = useCallback(async () => {
    if (active || !content.trim()) return
    if (!selected) {
      notify('Choose an app to type into first.')
      return
    }
    const list = await api.windows.list()
    setWindows(list)
    if (!list.some((w) => w.id === selected.id && w.pid === selected.pid)) {
      setSelectedId(undefined)
      notify(`That ${appName(selected)} window has closed. Choose where to type again.`)
      return
    }
    setConfirming(true)
  }, [active, selected, content, notify])

  const confirmStart = useCallback(async () => {
    setConfirming(false)
    if (!selected) return
    setEditable(false)
    const res = await api.typing.start({ mode, code: content, windowId: selected.id, profile, confirmed: true })
    if (res.ok) setShowRun(true)
    else notify(res.error ?? 'Couldn’t start typing.')
  }, [selected, content, profile, mode, notify])

  // ------------------------------------------------------------------ actions

  const saveContent = async () => {
    const base = mode === 'text' ? 'autowriter.txt' : (targetFile?.split('/').pop() ?? `autocoder.${EXTENSION_FOR[language]}`)
    const path = await api.files.save(content, base)
    if (path) notify(`Saved to ${path}`)
  }

  const pickProject = async () => {
    const p = await api.project.pick()
    if (p) {
      setProject(p)
      setTargetFile(undefined)
    }
  }

  const saveSettings = async (patch: SettingsPatch) => setSettings(await api.settings.update(patch))

  if (!settings) return <div className="app" />

  const sentence: SentenceProps = {
    mode,
    source: draft.source,
    settings,
    providers,
    project,
    targetFile,
    windows,
    selected,
    profile,
    refreshing,
    disabled: active || busy,
    canOpenInEditor: !!selected && OPENABLE.has(selected.editor),
    onPickProject: pickProject,
    onClearProject: () => {
      setProject(null)
      setTargetFile(undefined)
      void api.settings.update({ lastProjectDir: '' })
    },
    onSelectFile: setTargetFile,
    onOpenInEditor: async () => {
      if (!project || !targetFile || !selected) return
      const res = await api.windows.openFileInEditor(selected.id, project.root, targetFile)
      notify(res.ok ? `Opening ${targetFile.split('/').pop()} in ${appName(selected)}` : (res.error ?? 'Couldn’t open the file.'))
    },
    onSelectWindow: setSelectedId,
    onRefreshWindows: refreshWindows,
    onModel: async (provider, model) => setSettings(await api.settings.update({ codegen: { provider, model } })),
    onConnectAi: () => setAiOpen(true),
    onProfile: setProfile
  }

  const aiLabel = activeModel(providers, settings.codegen)?.model.name ?? null
  const warnings = logs.some((l) => (l.level === 'error' || l.level === 'warn') && Date.now() - l.ts < 60_000)
  const inRun = showRun && status.state !== 'idle'
  const runMode = status.mode ?? mode

  return (
    <div className="app">
      <TopBar
        mode={inRun ? runMode : mode}
        onMode={setMode}
        modeLocked={active || busy}
        aiLabel={aiLabel}
        onAi={() => setAiOpen(true)}
        busy={active || busy}
        onHome={() => !active && (setShowRun(false), setView('compose'))}
        showNew={!inRun && view === 'workspace'}
        onNew={() => setView('compose')}
        onActivity={() => setActivityOpen(true)}
        activityAlert={warnings}
        onSettings={() => setSettingsOpen(true)}
        settingsDisabled={active}
      />

      <main className="stage">
        {inRun ? (
          <Building
            key="run"
            status={status}
            code={drafts[runMode].content}
            recentNote={recentNote}
            stopHotkey={settings.hotkeys.stop}
            pauseHotkey={settings.hotkeys.pauseResume}
            onPause={() => void api.typing.pause()}
            onResume={() => void api.typing.resume()}
            onStop={() => void api.typing.stop()}
            onSpeed={(m) => void api.typing.setSpeed(m)}
            onBackToCode={() => {
              setShowRun(false)
              setView('workspace')
            }}
            onNewBuild={() => {
              setShowRun(false)
              setView('compose')
            }}
          />
        ) : view === 'compose' ? (
          <Compose
            key={`compose-${mode}`}
            mode={mode}
            source={draft.source}
            onSource={(s) => updateDraft(mode, { source: s })}
            prompt={draft.prompt}
            onPrompt={(v) => updateDraft(mode, { prompt: v })}
            pasted={draft.pasted}
            onPasted={(v) => updateDraft(mode, { pasted: v })}
            onBuild={generate}
            canBuild={!!draft.prompt.trim() && !busy}
            onContinue={continueWithPasted}
            onHumanize={() => {
              updateDraft(mode, { content: draft.pasted })
              setUndoText(null)
              void humanize(draft.pasted)
            }}
            hasPrevious={!!content.trim()}
            onBackToLast={() => setView('workspace')}
            sentence={sentence}
          />
        ) : (
          <Workspace
            key={`workspace-${mode}`}
            mode={mode}
            source={draft.source}
            prompt={draft.prompt}
            onEditRequest={() => setView('compose')}
            sentence={sentence}
            selected={selected}
            estimateMs={estimateMs}
            canStart={!active && !busy && !!selected && !!content.trim()}
            onStart={requestStart}
            humanizer={
              mode === 'text'
                ? {
                    text: content,
                    options: humanizerOptions,
                    onOptions: setHumanizerOptions,
                    running: humanizing,
                    result: humanizeResult,
                    quickFixed,
                    aiLabel,
                    onQuickFix: () => {
                      const fixed = quickFix(content)
                      if (!fixed.changes.length) return
                      setUndoText(content)
                      setContent(fixed.text)
                      setQuickFixed(fixed.changes.length)
                      setHumanizeResult(null)
                    },
                    canUndo: undoText !== null,
                    disabled: active || generating,
                    onRewrite: () => void humanize(),
                    onCancel: () => void api.humanizer.cancel(),
                    onUndo: () => {
                      if (undoText === null) return
                      setContent(undoText)
                      setUndoText(null)
                      setQuickFixed(null)
                      setHumanizeResult(null)
                    }
                  }
                : undefined
            }
            sheet={{
              variant: mode,
              code: content,
              onChange: setContent,
              language,
              fileLabel: mode === 'text' ? 'Document' : (targetFile?.split('/').pop() ?? `untitled.${EXTENSION_FOR[language]}`),
              editable,
              onToggleEdit: () => setEditable(!editable),
              generating: busy,
              justFinished,
              locked: active,
              typedChars: status.typedChars,
              showTyped: status.state !== 'idle' && status.mode === mode && status.totalChars === content.replace(/\r\n?/g, '\n').length,
              onCopy: async () => {
                await navigator.clipboard.writeText(content)
                notify('Copied to the clipboard.')
              },
              onRegenerate: generate,
              onClear: () => {
                setContent('')
                setEditable(true)
              },
              onSave: saveContent,
              canRegenerate: draft.source === 'idea' && !!draft.prompt.trim(),
              highlights: tellMarks
            }}
          />
        )}
      </main>

      {activityOpen && (
        <ActivityDrawer
          entries={logs}
          onClear={() => {
            void api.log.clear()
            setLogs([])
          }}
          onClose={() => setActivityOpen(false)}
        />
      )}
      {confirming && selected && (
        <ConfirmDialog
          mode={mode}
          target={selected}
          code={content}
          profile={profile}
          estimateMs={estimateMs}
          countdownSeconds={settings.countdownSeconds}
          editorSafe={settings.editorSafeMode}
          stopHotkey={settings.hotkeys.stop}
          targetFile={mode === 'code' ? targetFile : undefined}
          onConfirm={confirmStart}
          onCancel={() => setConfirming(false)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          providers={providers}
          onManageAi={() => {
            setSettingsOpen(false)
            setAiOpen(true)
          }}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {aiOpen && (
        <Connections
          providers={providers}
          onConnect={async (id: ProviderId, key: string) => {
            const list = await api.ai.connect(id, key)
            setProviders(list)
            const s = list.find((x) => x.id === id)
            if (s?.state === 'connected' && !s.error) notify(`${s.name} is connected.`)
            return list
          }}
          onSignIn={async (id) => {
            const list = await api.ai.signIn(id)
            setProviders(list)
            const s = list.find((x) => x.id === id)
            if (s?.state === 'connected' && s.source === 'signed-in') notify(`Signed in to ${s.name}.`)
            return list
          }}
          onDisconnect={async (id) => {
            const list = await api.ai.disconnect(id)
            setProviders(list)
            return list
          }}
          onRefresh={async (id) => {
            const list = await api.ai.refresh(id)
            setProviders(list)
            return list
          }}
          onOpenKeyPage={(id) => void api.ai.openKeyPage(id)}
          onClose={() => setAiOpen(false)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
