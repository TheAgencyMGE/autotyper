import type { ComponentProps } from 'react'
import { ArrowRight } from 'lucide-react'
import type { TypingMode, WindowInfo } from '@shared/types'
import { appName, styleName } from '../lib/copy'
import { formatDuration } from '../lib/format'
import { CodeSheet } from './CodeSheet'
import { HumanizerPanel } from './HumanizerPanel'
import { Sentence, type SentenceProps } from './Sentence'

interface Props {
  mode: TypingMode
  source: 'idea' | 'paste'
  prompt: string
  onEditRequest: () => void
  sentence: SentenceProps
  selected?: WindowInfo
  estimateMs: number | null
  canStart: boolean
  onStart: () => void
  sheet: ComponentProps<typeof CodeSheet>
  humanizer?: ComponentProps<typeof HumanizerPanel>
}

export function Workspace(p: Props) {
  const style = styleName(p.mode, p.sentence.profile.preset).toLowerCase()
  const noun = p.mode === 'code' ? 'code' : 'text'
  return (
    <div className="view">
      <div className="workspace">
        <aside className="brief">
          {p.source === 'idea' ? (
            <div>
              <div className="label" style={{ marginBottom: 12 }}>
                You asked for
              </div>
              <p className="brief-prompt">{p.prompt.trim() || `Your own ${noun}`}</p>
              <button className="link" style={{ marginTop: 12 }} onClick={p.onEditRequest}>
                Change the request
              </button>
            </div>
          ) : (
            <div>
              <div className="label" style={{ marginBottom: 12 }}>
                Your {noun}
              </div>
              <p className="brief-plain">
                {p.mode === 'code' ? 'AutoCoder will type the code on the right exactly as it is.' : 'AutoWriter will type the text on the right exactly as it is.'} You can
                edit it first.
              </p>
              <button className="link" style={{ marginTop: 12 }} onClick={p.onEditRequest}>
                Start over
              </button>
            </div>
          )}

          {p.humanizer && <HumanizerPanel {...p.humanizer} />}

          <Sentence {...p.sentence} compact />

          <div className="brief-actions">
            {p.selected ? (
              <span className="ready-note">
                <span className="dot" /> Ready to type into <strong>{appName(p.selected)}</strong>
              </span>
            ) : (
              <span className="ready-note">
                <span className="dot warn" /> Choose an app to type into first
              </span>
            )}
            <button className="btn btn-primary btn-lg" onClick={p.onStart} disabled={!p.canStart}>
              Start typing <ArrowRight className="arrow" />
            </button>
            {p.estimateMs !== null && p.sheet.code && (
              <span className="small">
                About {formatDuration(p.estimateMs)}, {style}.
              </span>
            )}
          </div>
        </aside>
        <CodeSheet {...p.sheet} />
      </div>
    </div>
  )
}
