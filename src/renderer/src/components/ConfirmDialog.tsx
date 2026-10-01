import { useEffect, useState } from 'react'
import type { HumanizationProfile, TypingMode, WindowInfo } from '@shared/types'
import { appName, styleName } from '../lib/copy'
import { formatDuration, prettyAccelerator } from '../lib/format'

interface Props {
  mode: TypingMode
  target: WindowInfo
  code: string
  profile: HumanizationProfile
  estimateMs: number | null
  countdownSeconds: number
  editorSafe: boolean
  stopHotkey: string
  targetFile?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Explicit, informed confirmation of exactly where keystrokes will go. */
export function ConfirmDialog(p: Props) {
  const [cursorReady, setCursorReady] = useState(false)
  const name = appName(p.target)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  const lines = p.code.split('\n').length
  const style = styleName(p.mode, p.profile.preset)
  const isText = p.mode === 'text'
  const words = p.code.trim() ? p.code.trim().split(/\s+/).length : 0

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && p.onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="label" id="confirm-title">
          Ready to type into
        </div>
        <div className="modal-body">
          <div className="target-hero">
            <span className="app">{name}</span>
            <span className="win">{p.target.title}</span>
          </div>

          <dl className="summary">
            <dt>What</dt>
            <dd className="num">{isText ? `${words.toLocaleString()} words` : `${lines.toLocaleString()} lines of code`}</dd>
            <dt>How</dt>
            <dd>
              {style}
              {p.estimateMs !== null && p.profile.preset !== 'instant' && `, about ${formatDuration(p.estimateMs)}`}
            </dd>
            {p.targetFile && (
              <>
                <dt>For</dt>
                <dd>{p.targetFile}</dd>
              </>
            )}
            <dt>To stop</dt>
            <dd>
              <span className="kbd">{prettyAccelerator(p.stopHotkey)}</span> from anywhere, or the Stop button
            </dd>
          </dl>

          {!p.target.isEditor && <p className="note warn">{name} isn’t an app AutoTyper knows. Make sure a text box there has the cursor, or keystrokes may trigger shortcuts.</p>}
          <p className="note">
            After a {p.countdownSeconds}-second countdown, AutoTyper brings {name} to the front and types where your cursor is.
            {!isText && p.editorSafe && ' It tidies up the brackets and indentation the editor adds on its own, so start in an empty file or on an empty line.'}
            {isText && ' Autocorrect and smart quotes in your document stay on, just like when you type yourself.'} If another window
            comes to the front, typing pauses straight away.
          </p>

          <label className="check">
            <input type="checkbox" checked={cursorReady} onChange={(e) => setCursorReady(e.target.checked)} autoFocus />
            <span>
              My cursor is in {name}, exactly where the {isText ? 'text' : 'code'} should go.
            </span>
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn btn-quiet" onClick={p.onCancel}>
            Not yet
          </button>
          <button className="btn btn-primary" onClick={p.onConfirm} disabled={!cursorReady}>
            Start typing
          </button>
        </div>
      </div>
    </div>
  )
}
