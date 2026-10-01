import { useCallback, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, RefreshCw } from 'lucide-react'
import { LIMITS, PRESETS } from '@core/typing/profiles'
import type { HumanBehaviors, HumanizationPresetId, HumanizationProfile, ProjectInfo, ProjectNode, ProviderId, ProviderStatus, Settings, TypingMode, WindowInfo } from '@shared/types'
import { activeModel, appName, behaviourLabels, STYLE_PHRASE, styleOptions } from '../lib/copy'
import { Choice, Option } from './Choice'

type Menu = 'project' | 'model' | 'target' | 'style' | null

export interface SentenceProps {
  mode: TypingMode
  /** 'idea' when AutoTyper writes it; 'paste' when the user brings their own. */
  source: 'idea' | 'paste'
  compact?: boolean
  disabled?: boolean
  settings: Settings
  providers: ProviderStatus[]
  project: ProjectInfo | null
  targetFile?: string
  windows: WindowInfo[]
  selected?: WindowInfo
  profile: HumanizationProfile
  refreshing: boolean
  canOpenInEditor: boolean
  onPickProject: () => void
  onClearProject: () => void
  onSelectFile: (path: string | undefined) => void
  onOpenInEditor: () => void
  onSelectWindow: (id: string) => void
  onRefreshWindows: () => void
  onModel: (provider: ProviderId, model: string) => void
  onConnectAi: () => void
  onProfile: (p: HumanizationProfile) => void
}

/**
 * The settings, written as a sentence:
 * "For a new file, write it with Claude Opus 5.5 and type it into VS Code, like a person."
 */
export function Sentence(p: SentenceProps) {
  const [open, setOpen] = useState<Menu>(null)
  const close = useCallback(() => setOpen(null), [])
  const toggle = (m: Menu) => () => setOpen((cur) => (cur === m ? null : m))

  const active = activeModel(p.providers, p.settings.codegen)
  const connected = !!active
  const modelLabel = active ? active.model.name : 'an AI (connect one first)'
  const fileName = p.targetFile?.split('/').pop()
  const projectLabel = p.project ? (fileName ? `${fileName} in ${p.project.name}` : p.project.name) : 'a new file'

  const target = (
    <Choice
      label={p.selected ? appName(p.selected) : 'an app you choose'}
      unset={!p.selected}
      ariaLabel="Type into"
      open={open === 'target'}
      onToggle={toggle('target')}
      onClose={close}
      align={p.compact ? 'right' : 'left'}
      disabled={p.disabled}
    >
      <TargetMenu {...p} onDone={close} />
    </Choice>
  )
  const style = (
    <Choice label={STYLE_PHRASE[p.profile.preset]} ariaLabel="Typing style" open={open === 'style'} onToggle={toggle('style')} onClose={close} align="right" disabled={p.disabled}>
      <StyleMenu mode={p.mode} profile={p.profile} onProfile={p.onProfile} />
    </Choice>
  )
  const model = connected ? (
    <Choice label={modelLabel} ariaLabel="Written by" open={open === 'model'} onToggle={toggle('model')} onClose={close} disabled={p.disabled}>
      <ModelMenu {...p} onDone={close} />
    </Choice>
  ) : (
    <button type="button" className="choice unset" onClick={p.onConnectAi} disabled={p.disabled}>
      {modelLabel}
    </button>
  )

  return (
    <p className={`sentence ${p.compact ? 'compact' : ''}`}>
      {p.source === 'paste' ? (
        <>
          Type it into {target}, {style}.
        </>
      ) : p.mode === 'code' ? (
        <>
          For{' '}
          <Choice label={projectLabel} ariaLabel="Project" open={open === 'project'} onToggle={toggle('project')} onClose={close} disabled={p.disabled}>
            <ProjectMenu {...p} />
          </Choice>
          , write it with {model} and type it into {target}, {style}.
        </>
      ) : (
        <>
          Write it with {model} and type it into {target}, {style}.
        </>
      )}
    </p>
  )
}

// ------------------------------------------------------------------ project

function ProjectMenu(p: SentenceProps) {
  if (!p.project) {
    return (
      <>
        <div className="popover-head">
          <span className="popover-title">Start from a project</span>
        </div>
        <p className="popover-note" style={{ paddingTop: 0 }}>
          Point AutoCoder at a folder and it will follow the project’s structure and style. It only reads files and never changes them.
        </p>
        <div style={{ padding: '16px 8px 4px' }}>
          <button className="btn btn-outline" onClick={p.onPickProject}>
            <Folder /> Choose a folder…
          </button>
        </div>
      </>
    )
  }
  return (
    <>
      <div className="popover-head">
        <span className="popover-title">{p.project.name}</span>
        <button className="link" onClick={p.onPickProject}>
          Change
        </button>
      </div>
      <div className="label" style={{ padding: '0 8px' }}>
        Which file is this for?
      </div>
      <div className="tree" role="tree">
        {p.project.tree.children?.map((n) => <TreeNode key={n.path} node={n} depth={0} selected={p.targetFile} onSelect={p.onSelectFile} />)}
      </div>
      <hr className="divider" />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '0 8px' }}>
        {p.targetFile ? (
          <button className="link" onClick={p.onOpenInEditor} disabled={!p.canOpenInEditor} title={p.canOpenInEditor ? '' : 'Choose a code editor to type into first'}>
            Open {p.targetFile.split('/').pop()} in {p.selected ? appName(p.selected) : 'your editor'}
          </button>
        ) : (
          <span className="small">Pick a file, or leave it as a new file.</span>
        )}
        <button className="link" style={{ color: 'var(--graphite)' }} onClick={p.onClearProject}>
          Don’t use a project
        </button>
      </div>
    </>
  )
}

function TreeNode({ node, depth, selected, onSelect }: { node: ProjectNode; depth: number; selected?: string; onSelect: (p: string | undefined) => void }) {
  const [open, setOpen] = useState(depth < 1)
  const pad = { paddingLeft: 8 + depth * 16 }
  if (node.type === 'dir') {
    return (
      <>
        <button className="tree-item" style={pad} onClick={() => setOpen(!open)} role="treeitem" aria-expanded={open}>
          {open ? <ChevronDown /> : <ChevronRight />}
          {node.name}
        </button>
        {open && node.children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />)}
      </>
    )
  }
  const isSel = selected === node.path
  return (
    <button className={`tree-item ${isSel ? 'selected' : ''}`} style={pad} onClick={() => onSelect(isSel ? undefined : node.path)} role="treeitem" aria-selected={isSel}>
      <FileText />
      {node.name}
    </button>
  )
}

// -------------------------------------------------------------------- model

function ModelMenu(p: SentenceProps & { onDone: () => void }) {
  const active = activeModel(p.providers, p.settings.codegen)
  const connected = p.providers.filter((x) => x.state === 'connected' && x.models.length)
  return (
    <>
      <div className="popover-head">
        <span className="popover-title">Who writes it</span>
        <button className="link" onClick={p.onConnectAi}>
          Connections
        </button>
      </div>
      {connected.map((prov) => (
        <div className="options" role="menu" key={prov.id}>
          <div className="group-label">{prov.name}</div>
          {prov.models.slice(0, prov.id === 'openrouter' ? 40 : 12).map((m) => (
            <Option
              key={`${prov.id}:${m.id}`}
              name={m.name}
              desc={m.free && prov.id !== 'openrouter' ? 'Free' : undefined}
              selected={active?.provider.id === prov.id && active.model.id === m.id}
              onClick={() => {
                p.onModel(prov.id, m.id)
                p.onDone()
              }}
            />
          ))}
        </div>
      ))}
      <p className="popover-note">Connect more providers (ChatGPT, Gemini, OpenRouter, Ollama) under Connections.</p>
    </>
  )
}

// ------------------------------------------------------------------- target

function TargetMenu(p: SentenceProps & { onDone: () => void }) {
  const primary = p.mode === 'code' ? 'code' : 'document'
  const best = p.windows.filter((w) => w.category === primary)
  const alsoWorks = p.windows.filter((w) => w.isEditor && w.category !== primary)
  const others = p.windows.filter((w) => !w.isEditor)
  const pick = (id: string) => {
    p.onSelectWindow(id)
    p.onDone()
  }
  const group = (label: string, list: WindowInfo[]) =>
    list.length > 0 && (
      <div className="options" role="menu">
        <div className="group-label">{label}</div>
        {list.map((w) => (
          <Option key={w.id} name={appName(w)} desc={w.title} oneLine selected={w.id === p.selected?.id} onClick={() => pick(w.id)} />
        ))}
      </div>
    )
  return (
    <>
      <div className="popover-head">
        <span className="popover-title">Type into</span>
        <button className="btn btn-quiet" onClick={p.onRefreshWindows} disabled={p.refreshing}>
          <RefreshCw /> {p.refreshing ? 'Looking…' : 'Refresh'}
        </button>
      </div>
      {p.windows.length === 0 && (
        <p className="popover-note">{p.mode === 'code' ? 'Open VS Code, Cursor or Notepad, then refresh.' : 'Open Word, Google Docs or Notepad, then refresh.'}</p>
      )}
      {group(p.mode === 'code' ? 'Code editors' : 'Documents', best)}
      {group('Also works', alsoWorks)}
      {group('Other windows', others)}
      <p className="popover-note">
        Before you start, click into the {p.mode === 'code' ? 'editor' : 'document'} where the {p.mode === 'code' ? 'code' : 'text'} should go.
      </p>
    </>
  )
}

// -------------------------------------------------------------------- style

export function StyleMenu({ mode, profile, onProfile }: { mode: TypingMode; profile: HumanizationProfile; onProfile: (p: HumanizationProfile) => void }) {
  const [fine, setFine] = useState(profile.preset === 'custom')
  const choose = (id: HumanizationPresetId) => {
    if (id === 'custom') {
      onProfile({ ...(profile.preset === 'instant' ? PRESETS.normal : profile), preset: 'custom' })
      setFine(true)
    } else onProfile({ ...PRESETS[id], behaviors: { ...PRESETS[id].behaviors } })
  }
  const edit = (patch: Partial<HumanizationProfile>) => onProfile({ ...profile, ...patch, preset: 'custom' })
  const toggle = (k: keyof HumanBehaviors, v: boolean) => edit({ behaviors: { ...profile.behaviors, [k]: v } })

  return (
    <>
      <div className="popover-head">
        <span className="popover-title">How it types</span>
        {profile.preset !== 'instant' && (
          <button className="link" onClick={() => setFine(!fine)}>
            {fine ? 'Hide details' : 'Fine-tune'}
          </button>
        )}
      </div>
      {!fine && (
        <div className="options" role="menu">
          {styleOptions(mode).map((s) => (
            <Option key={s.id} name={s.name} desc={s.desc} selected={profile.preset === s.id} onClick={() => choose(s.id)} />
          ))}
        </div>
      )}
      {fine && profile.preset !== 'instant' && (
        <div className="style-detail">
          <div className="range-row">
            <label className="field">
              <span className="label">Slowest (wpm)</span>
              <input className="input num" type="number" min={LIMITS.minWpm} max={LIMITS.maxWpm} value={profile.minWpm} onChange={(e) => edit({ minWpm: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span className="label">Fastest (wpm)</span>
              <input className="input num" type="number" min={LIMITS.minWpm} max={LIMITS.maxWpm} value={profile.maxWpm} onChange={(e) => edit({ maxWpm: Number(e.target.value) })} />
            </label>
          </div>
          <Slider label="Typos" value={profile.mistakeRate} max={LIMITS.maxMistakeRate} step={0.002} display={profile.mistakeRate ? `${(profile.mistakeRate * 100).toFixed(1)}% of letters` : 'none'} onChange={(v) => edit({ mistakeRate: v })} />
          <Slider label="Random pauses" value={profile.pauseFrequency} display={level(profile.pauseFrequency)} onChange={(v) => edit({ pauseFrequency: v })} />
          <Slider label="Second thoughts" value={profile.revisionRate} display={level(profile.revisionRate)} onChange={(v) => edit({ revisionRate: v })} />
          <Slider label="Speed swings" value={profile.burstiness} display={level(profile.burstiness)} onChange={(v) => edit({ burstiness: v })} />
          <hr className="divider" style={{ margin: 0 }} />
          <div>
            <label className="switch">
              <span className="switch-text">
                <span>Stops to think</span>
                <span className="small">{mode === 'code' ? 'Longer pauses before new blocks and tricky lines.' : 'Longer pauses between sentences and paragraphs.'}</span>
              </span>
              <input type="checkbox" checked={profile.thinkingPauses} onChange={(e) => edit({ thinkingPauses: e.target.checked })} />
            </label>
            {behaviourLabels(mode).map((b) => (
              <label key={b.key} className="switch">
                <span className="switch-text">
                  <span>{b.label}</span>
                  <span className="small">{b.hint}.</span>
                </span>
                <input type="checkbox" checked={profile.behaviors[b.key]} onChange={(e) => toggle(b.key, e.target.checked)} />
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function level(v: number): string {
  if (v === 0) return 'never'
  if (v < 0.25) return 'rarely'
  if (v < 0.5) return 'sometimes'
  if (v < 0.8) return 'often'
  return 'a lot'
}

function Slider(p: { label: string; value: number; max?: number; step?: number; display: string; onChange: (v: number) => void }) {
  return (
    <label className="field" style={{ gap: 4 }}>
      <span className="slider-head">
        <span>{p.label}</span>
        <span>{p.display}</span>
      </span>
      <input type="range" min={0} max={p.max ?? 1} step={p.step ?? 0.05} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  )
}
