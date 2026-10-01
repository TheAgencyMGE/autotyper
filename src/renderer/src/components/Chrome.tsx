import { useEffect, useRef, useState } from 'react'
import { Plus, ScrollText, Settings as SettingsIcon, X } from 'lucide-react'
import type { LogEntry, TypingMode } from '@shared/types'
import { MODE_NAME } from '../lib/copy'
import { formatTime } from '../lib/format'

interface TopBarProps {
  mode: TypingMode
  onMode: (m: TypingMode) => void
  modeLocked: boolean
  /** Name of the model that will write, or null when nothing is connected. */
  aiLabel: string | null
  onAi: () => void
  busy: boolean
  onHome: () => void
  showNew: boolean
  onNew: () => void
  onActivity: () => void
  activityAlert: boolean
  onSettings: () => void
  settingsDisabled: boolean
}

export function TopBar(p: TopBarProps) {
  return (
    <header className="topbar">
      <button className={`wordmark ${p.busy ? 'busy' : ''}`} onClick={p.onHome} aria-label="AutoTyper home">
        AutoTyper
        <span className="caret" aria-hidden />
      </button>
      <div className="modes" role="tablist" aria-label="Mode">
        {(['code', 'text'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={p.mode === m} className={`mode ${p.mode === m ? 'active' : ''}`} onClick={() => p.onMode(m)} disabled={p.modeLocked && p.mode !== m}>
            {MODE_NAME[m]}
          </button>
        ))}
      </div>
      <nav className="topbar-nav">
        {p.showNew && (
          <button className="btn btn-quiet" onClick={p.onNew}>
            <Plus /> {p.mode === 'code' ? 'New build' : 'New draft'}
          </button>
        )}
        <button className="btn btn-quiet" onClick={p.onAi} title="AI connections">
          <span className={`dot ${p.aiLabel ? '' : 'off'}`} />
          {p.aiLabel ?? 'Connect AI'}
        </button>
        <button className="btn btn-quiet" onClick={p.onActivity}>
          <ScrollText /> Activity
          {p.activityAlert && <span className="dot warn" aria-label="has warnings" />}
        </button>
        <button className="btn btn-quiet btn-icon" onClick={p.onSettings} disabled={p.settingsDisabled} aria-label="Settings" title="Settings">
          <SettingsIcon />
        </button>
      </nav>
    </header>
  )
}

export function ActivityDrawer({ entries, onClear, onClose }: { entries: LogEntry[]; onClear: () => void; onClose: () => void }) {
  const [details, setDetails] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const visible = details ? entries : entries.filter((e) => e.level !== 'debug')

  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" aria-label="Activity">
        <div className="drawer-head">
          <h2 className="title" style={{ fontSize: 26, marginRight: 'auto' }}>
            Activity
          </h2>
          <label className="switch" style={{ padding: 0, alignItems: 'center', gap: 10 }}>
            <span className="small">Details</span>
            <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
          </label>
          <button className="btn btn-quiet" onClick={onClear}>
            Clear
          </button>
          <button className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Close activity">
            <X />
          </button>
        </div>
        <div className="drawer-body" ref={body} role="log">
          {visible.length === 0 && <p className="small">Nothing yet. Everything AutoCoder does will be listed here.</p>}
          {visible.map((e) => (
            <div key={e.id} className={`log-row ${e.level}`}>
              <span className="log-time">{formatTime(e.ts).slice(0, 5)}</span>
              <span className="log-msg">
                <span className="src">{SOURCE[e.source] ?? e.source}</span>
                {e.message}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </>
  )
}

const SOURCE: Record<string, string> = {
  typing: 'Typing',
  humanizer: 'Style',
  rewrite: 'Rewrite',
  ai: 'AI',
  codegen: 'Writing',
  automation: 'Keyboard',
  windows: 'Windows',
  project: 'Project',
  hotkeys: 'Shortcuts',
  settings: 'Settings',
  files: 'Files',
  app: 'App'
}
