import { useState } from 'react'
import type { ProviderStatus, Settings, SettingsPatch } from '@shared/types'

interface Props {
  settings: Settings
  providers: ProviderStatus[]
  onManageAi: () => void
  onSave: (patch: SettingsPatch) => Promise<void>
  onClose: () => void
}

export function SettingsDialog({ settings, providers, onManageAi, onSave, onClose }: Props) {
  const connected = providers.filter((x) => x.state === 'connected')
  const [stop, setStop] = useState(settings.hotkeys.stop)
  const [pause, setPause] = useState(settings.hotkeys.pauseResume)
  const [editorSafe, setEditorSafe] = useState(settings.editorSafeMode)
  const [countdown, setCountdown] = useState(settings.countdownSeconds)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave({ hotkeys: { stop: stop.trim(), pauseResume: pause.trim() }, editorSafeMode: editorSafe, countdownSeconds: countdown })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 className="title" id="settings-title">
          Settings
        </h2>
        <div className="modal-body">
          <section className="modal-section">
            <h3 className="section-title">AI</h3>
            <p className="note" style={{ margin: 0 }}>
              {connected.length ? `Connected: ${connected.map((x) => x.name).join(', ')}.` : 'Nothing connected yet. Connect an AI to have AutoTyper write and rewrite for you.'}
            </p>
            <button className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={onManageAi}>
              {connected.length ? 'Manage connections' : 'Connect an AI'}
            </button>
          </section>

          <section className="modal-section">
            <h3 className="section-title">Staying in control</h3>
            <div className="range-row">
              <label className="field">
                <span className="label">Stop shortcut</span>
                <input className="input" value={stop} onChange={(e) => setStop(e.target.value)} spellCheck={false} />
              </label>
              <label className="field">
                <span className="label">Pause shortcut</span>
                <input className="input" value={pause} onChange={(e) => setPause(e.target.value)} spellCheck={false} />
              </label>
            </div>
            <p className="note" style={{ margin: 0 }}>
              These work from any app. Write them like <span className="kbd">Control+Alt+Escape</span>. Windows keeps Ctrl+Shift+Esc for Task Manager.
            </p>
            <label className="field" style={{ maxWidth: 220 }}>
              <span className="label">Countdown before typing</span>
              <select className="input" value={countdown} onChange={(e) => setCountdown(Number(e.target.value))}>
                {[0, 1, 2, 3, 5, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'None' : `${n} second${n > 1 ? 's' : ''}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="switch">
              <span className="switch-text">
                <span>Tidy up after the editor</span>
                <span className="small">Code editors add closing brackets, indentation and suggestions as you type. This undoes them so the result matches exactly. Leave it on.</span>
              </span>
              <input type="checkbox" checked={editorSafe} onChange={(e) => setEditorSafe(e.target.checked)} />
            </label>
          </section>
          {error && <p className="note" style={{ color: 'var(--brick)' }}>{error}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
