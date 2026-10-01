import { useMemo, useState } from 'react'
import { Sparkles, Undo2, Wand2 } from 'lucide-react'
import { scoreWriting } from '@core/humanizer'
import { findTells } from '@core/humanizer/tells'
import type { HumanizeResult, HumanizerPurposeId, HumanizerVoiceId } from '@shared/types'
import { PURPOSES, VOICES } from '../lib/copy'

export interface HumanizerOptions {
  voice: HumanizerVoiceId
  purpose: HumanizerPurposeId
  aggressive: boolean
  doubleCheck: boolean
}

interface Props {
  text: string
  options: HumanizerOptions
  onOptions: (o: HumanizerOptions) => void
  running: boolean
  result: HumanizeResult | null
  /** What the last quick fix changed, if it was the most recent edit. */
  quickFixed: number | null
  canUndo: boolean
  disabled: boolean
  aiLabel: string | null
  onQuickFix: () => void
  onRewrite: () => void
  onCancel: () => void
  onUndo: () => void
}

/**
 * Make text read like a person wrote it. The score and the flagged phrases are
 * computed on this computer (humanizer-skill and blader/humanizer catalogues):
 * no network, no cost. Quick fix makes the safe mechanical edits offline; the
 * AI rewrite handles the rest.
 */
export function HumanizerPanel(p: Props) {
  const score = useMemo(() => (p.text.trim() ? scoreWriting(p.text) : null), [p.text])
  const tells = useMemo(() => findTells(p.text), [p.text])
  const fixable = tells.filter((t) => t.fix !== undefined).length
  const [showTells, setShowTells] = useState(false)
  const r = p.result

  return (
    <section className="humanizer" aria-label="Sound like a person">
      <div className="humanizer-head">
        <span className="label">Sounds like a person?</span>
        {score && (
          <span className={`score ${score.score > 60 ? 'high' : score.score > 40 ? 'mid' : 'low'}`} title="0 reads human, 100 reads like AI. Measured on this computer.">
            {score.score}
            <small>/100 · {score.verdict.toLowerCase()}</small>
          </span>
        )}
      </div>

      {p.text.trim() && (
        <div className="tells">
          {tells.length ? (
            <button className="link" style={{ color: 'var(--ink)' }} onClick={() => setShowTells(!showTells)} aria-expanded={showTells}>
              {tells.length} {tells.length === 1 ? 'phrase reads' : 'phrases read'} as AI (highlighted)
            </button>
          ) : (
            <span className="small">No stock AI phrases found.</span>
          )}
          {showTells && (
            <ul className="tell-list">
              {tells.slice(0, 30).map((t, i) => (
                <li key={i}>
                  <span className="tell-text">{t.text.trim() || '—'}</span>
                  <span className="small">
                    {t.why}
                    {t.fix !== undefined && <> · {t.fix.trim() ? <>quick fix: “{t.fix.trim()}”</> : 'quick fix: cut it'}</>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {p.quickFixed !== null && <p className="note" style={{ margin: 0 }}>Quick fix made {p.quickFixed} {p.quickFixed === 1 ? 'change' : 'changes'}.</p>}

      {r?.ok && r.after && (
        <div className="rewrite-result">
          <p className="note" style={{ margin: 0 }}>
            Rewritten{r.passes === 2 ? ' in two passes' : ''}: score <b className="num">{r.before.score}</b> → <b className="num">{r.after.score}</b>
            {r.tellsBefore !== undefined && (
              <>
                , flagged phrases <b className="num">{r.tellsBefore}</b> → <b className="num">{r.tellsAfter}</b>
              </>
            )}
            .{r.summary ? ` ${r.summary}` : ''}
          </p>
          {!!r.lostFacts?.length && (
            <p className="note warn" style={{ margin: 0 }}>
              Check these still appear: {r.lostFacts.slice(0, 6).join(', ')}
              {r.lostFacts.length > 6 ? '…' : ''}.
            </p>
          )}
        </div>
      )}
      {r && !r.ok && r.error && !r.needsConnection && <p className="note error-text">{r.error}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={p.onQuickFix} disabled={!fixable || p.running || p.disabled} title="Safe, mechanical edits. Free and offline.">
          <Wand2 /> Quick fix{fixable ? ` (${fixable})` : ''}
        </button>
        {p.running ? (
          <button className="btn btn-outline" onClick={p.onCancel}>
            Stop rewriting
          </button>
        ) : (
          <button className="btn btn-outline" onClick={p.onRewrite} disabled={!p.text.trim() || p.disabled}>
            <Sparkles /> Rewrite with {p.aiLabel ?? 'AI'}
          </button>
        )}
        {p.canUndo && !p.running && (
          <button className="btn btn-quiet" onClick={p.onUndo} disabled={p.disabled}>
            <Undo2 /> Undo
          </button>
        )}
      </div>

      <details className="humanizer-more">
        <summary>Rewrite options</summary>
        <div className="humanizer-options">
          <label className="field">
            <span className="label">Voice</span>
            <select className="input" value={p.options.voice} onChange={(e) => p.onOptions({ ...p.options, voice: e.target.value as HumanizerVoiceId })} disabled={p.running || p.disabled}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">It’s for</span>
            <select className="input" value={p.options.purpose} onChange={(e) => p.onOptions({ ...p.options, purpose: e.target.value as HumanizerPurposeId })} disabled={p.running || p.disabled}>
              {PURPOSES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="switch">
          <span className="switch-text">
            <span>Double-check</span>
            <span className="small">If the checker still finds AI phrases, run one more targeted pass.</span>
          </span>
          <input type="checkbox" checked={p.options.doubleCheck} onChange={(e) => p.onOptions({ ...p.options, doubleCheck: e.target.checked })} disabled={p.running || p.disabled} />
        </label>
        <label className="switch">
          <span className="switch-text">
            <span>Bolder rewrite</span>
            <span className="small">Shorter sentences, more personality.</span>
          </span>
          <input type="checkbox" checked={p.options.aggressive} onChange={(e) => p.onOptions({ ...p.options, aggressive: e.target.checked })} disabled={p.running || p.disabled} />
        </label>
      </details>
    </section>
  )
}
