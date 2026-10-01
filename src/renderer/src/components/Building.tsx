import { useMemo } from 'react'
import { ArrowRight, Pause, Play, Square } from 'lucide-react'
import type { TypingStatus } from '@shared/types'
import { activityPhrase, appName } from '../lib/copy'
import { formatDuration, prettyAccelerator } from '../lib/format'

interface Props {
  status: TypingStatus
  code: string
  recentNote?: string
  stopHotkey: string
  pauseHotkey: string
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onSpeed: (m: number) => void
  onBackToCode: () => void
  onNewBuild: () => void
}

const TELEPROMPTER_LINES = 7

export function Building(p: Props) {
  const s = p.status
  const isText = s.mode === 'text'
  const target = s.target ? appName(s.target) : isText ? 'your document' : 'your editor'
  const pct = s.totalChars ? Math.min(100, Math.round((s.typedChars / s.totalChars) * 100)) : 0
  const normalized = useMemo(() => p.code.replace(/\r\n?/g, '\n'), [p.code])
  const lines = useMemo(() => {
    const typed = normalized.slice(0, s.typedChars)
    // Prose: the last few hundred characters, wrapped like a page. Code: the last few lines.
    if (isText) return typed.slice(-420).replace(/^\S*\s/, '').split('\n').slice(-4)
    return typed.split('\n').slice(-TELEPROMPTER_LINES)
  }, [normalized, s.typedChars, isText])
  const wordsTyped = useMemo(() => (isText ? normalized.slice(0, s.typedChars).trim().split(/\s+/).filter(Boolean).length : 0), [isText, normalized, s.typedChars])
  const wordsTotal = useMemo(() => (isText ? normalized.trim().split(/\s+/).filter(Boolean).length : 0), [isText, normalized])

  if (s.state === 'countdown') {
    return (
      <div className="view">
        <div className="building">
          <div className="target-line">
            Typing into <strong>{target}</strong>
          </div>
          <div className="countdown">
            <div className="countdown-num num" key={s.countdown}>
              {s.countdown}
            </div>
            <p className="lede">Hands off the keyboard. {isText ? 'AutoWriter' : 'AutoCoder'} is about to start typing into {target}.</p>
          </div>
          <div className="run-controls">
            <button className="btn btn-danger" onClick={p.onStop}>
              <Square /> Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  const running = s.state === 'typing' || s.state === 'paused'
  const finished = s.state === 'completed'
  const heading = finished
    ? isText
      ? 'Written.'
      : 'Built.'
    : s.state === 'stopped'
      ? 'Stopped.'
      : s.state === 'error'
        ? 'That didn’t work.'
        : s.state === 'paused'
          ? 'Paused.'
          : isText
            ? 'AutoWriter is writing…'
            : 'AutoCoder is building…'

  return (
    <div className="view">
      <div className={`building ${s.state === 'paused' ? 'paused' : ''}`}>
        <div className="building-top">
          <div>
            <div className="target-line">
              {finished ? 'Typed into' : 'Typing into'} <strong>{target}</strong>
            </div>
            <h1 className="title" style={{ fontSize: 44 }}>
              {heading}
            </h1>
          </div>
          <div className="percent" aria-label={`${pct} percent`}>
            {pct}
            <small>%</small>
          </div>
        </div>

        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>

        <div className="doing" aria-live="polite">
          {running && <span key={activityPhrase(s, p.recentNote)}>{activityPhrase(s, p.recentNote)}</span>}
          {!running && s.detail && <span>{s.detail}</span>}
        </div>

        <div className={`teleprompter ${isText ? 'prose' : ''}`} aria-hidden>
          {lines.map((line, i) => {
            const current = i === lines.length - 1
            return (
              <div key={i} className={`line ${current ? 'current' : 'past'}`}>
                {line}
                {current && running && <span className="caret" />}
              </div>
            )
          })}
        </div>

        <div className="facts">
          {isText ? (
            <span>
              <b>{wordsTyped.toLocaleString()}</b> of <b>{wordsTotal.toLocaleString()}</b> words
            </span>
          ) : (
            <span>
              Line <b>{s.currentLine.toLocaleString()}</b> of <b>{s.totalLines.toLocaleString()}</b>
            </span>
          )}
          {s.wpm > 0 && running && (
            <span>
              <b>{s.wpm}</b> words a minute
            </span>
          )}
          {running && s.etaMs > 0 && (
            <span>
              About <b>{formatDuration(s.etaMs)}</b> left
            </span>
          )}
          {!running && s.elapsedMs > 0 && (
            <span>
              Took <b>{formatDuration(s.elapsedMs)}</b>
            </span>
          )}
          <span>
            <b>{s.mistakesMade}</b> {s.mistakesMade === 1 ? 'typo' : 'typos'} fixed
          </span>
          {s.revisions > 0 && (
            <span>
              <b>{s.revisions}</b> second {s.revisions === 1 ? 'thought' : 'thoughts'}
            </span>
          )}
        </div>

        <div className="run-controls">
          {running ? (
            <>
              {s.state === 'paused' ? (
                <button className="btn btn-primary" onClick={p.onResume}>
                  <Play /> Resume
                </button>
              ) : (
                <button className="btn btn-outline" onClick={p.onPause}>
                  <Pause /> Pause
                </button>
              )}
              <button className="btn btn-danger" onClick={p.onStop}>
                <Square /> Stop
              </button>
              <label className="pace">
                <span>Slower</span>
                <input type="range" min={0.25} max={3} step={0.05} value={s.speedMultiplier} onChange={(e) => p.onSpeed(Number(e.target.value))} aria-label="Typing pace" />
                <span>Faster</span>
              </label>
            </>
          ) : (
            <>
              <button className="btn btn-outline" onClick={p.onBackToCode}>
                Back to the {isText ? 'text' : 'code'}
              </button>
              <button className="btn btn-primary" onClick={p.onNewBuild}>
                {isText ? 'Write' : 'Build'} something else <ArrowRight className="arrow" />
              </button>
            </>
          )}
        </div>
        {running && (
          <p className="stop-note">
            Stop from anywhere with <span className="kbd">{prettyAccelerator(p.stopHotkey)}</span>, pause with{' '}
            <span className="kbd">{prettyAccelerator(p.pauseHotkey)}</span>. Clicking another window pauses typing.
          </p>
        )}
      </div>
    </div>
  )
}
