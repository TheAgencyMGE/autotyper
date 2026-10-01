import { useEffect, useRef } from 'react'
import { ArrowRight, ClipboardPaste, PenLine } from 'lucide-react'
import type { TypingMode } from '@shared/types'
import { SUGGESTIONS } from '../lib/copy'
import { Sentence, type SentenceProps } from './Sentence'

interface Props {
  mode: TypingMode
  source: 'idea' | 'paste'
  onSource: (s: 'idea' | 'paste') => void
  prompt: string
  onPrompt: (v: string) => void
  pasted: string
  onPasted: (v: string) => void
  onBuild: () => void
  canBuild: boolean
  onContinue: () => void
  onHumanize: () => void
  hasPrevious: boolean
  onBackToLast: () => void
  sentence: SentenceProps
}

const COPY = {
  code: {
    headline: (
      <>
        What should we <em>build</em>?
      </>
    ),
    eyebrow: 'Describe an idea and AutoCoder writes it, or bring code you already have. Either way, watch it type.',
    idea: 'Describe an idea',
    paste: 'Paste my own code',
    promptPlaceholder: 'A personal portfolio with a warm editorial design, a project gallery, an about page and a contact form…',
    pastePlaceholder: 'Paste your code here. AutoCoder will type it out, line by line, like a person would.',
    go: 'Build'
  },
  text: {
    headline: (
      <>
        What should we <em>write</em>?
      </>
    ),
    eyebrow: 'Describe it and AutoWriter drafts it, or bring your own text. Either way, watch it type.',
    idea: 'Describe it',
    paste: 'Paste my own text',
    promptPlaceholder: 'A short, friendly email asking my team to move Thursday’s meeting to Friday morning…',
    pastePlaceholder: 'Paste your text here. AutoWriter can type it as it is, or rewrite it to sound more like you first.',
    go: 'Write'
  }
} as const

export function Compose(p: Props) {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const pasteRef = useRef<HTMLTextAreaElement>(null)
  const c = COPY[p.mode]
  const isPaste = p.source === 'paste'

  // Grow with the text, like a page.
  useEffect(() => {
    const el = promptRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [p.prompt, p.source])

  useEffect(() => {
    ;(isPaste ? pasteRef : promptRef).current?.focus()
  }, [isPaste, p.mode])

  const pastedWords = p.pasted.trim() ? p.pasted.trim().split(/\s+/).length : 0

  return (
    <div className="view" key={p.mode}>
      <div className="compose">
        <p className="eyebrow">{c.eyebrow}</p>
        <h1 className="display">{c.headline}</h1>

        <div className="paths" role="tablist" aria-label="How to start">
          <button role="tab" aria-selected={!isPaste} className={`path ${!isPaste ? 'active' : ''}`} onClick={() => p.onSource('idea')}>
            <PenLine /> {c.idea}
          </button>
          <button role="tab" aria-selected={isPaste} className={`path ${isPaste ? 'active' : ''}`} onClick={() => p.onSource('paste')}>
            <ClipboardPaste /> {c.paste}
          </button>
        </div>

        {!isPaste ? (
          <>
            <div className="prompt" key="prompt">
              <textarea
                ref={promptRef}
                value={p.prompt}
                onChange={(e) => p.onPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && p.canBuild) p.onBuild()
                }}
                placeholder={c.promptPlaceholder}
                aria-label="Describe what you want"
                spellCheck
              />
            </div>
            <Sentence {...p.sentence} />
            <div className="compose-actions">
              <button className="btn btn-primary btn-lg" onClick={p.onBuild} disabled={!p.canBuild}>
                {c.go} <ArrowRight className="arrow" />
              </button>
              <span className="hint">
                or press <span className="kbd">Ctrl</span> <span className="kbd">Enter</span>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className={`paste-area ${p.mode}`} key="paste">
              <textarea
                ref={pasteRef}
                value={p.pasted}
                onChange={(e) => p.onPasted(e.target.value)}
                placeholder={c.pastePlaceholder}
                aria-label={c.paste}
                spellCheck={p.mode === 'text'}
                wrap={p.mode === 'code' ? 'off' : 'soft'}
              />
              {p.pasted && (
                <span className="paste-count">
                  {p.mode === 'code' ? `${p.pasted.split('\n').length.toLocaleString()} lines` : `${pastedWords.toLocaleString()} words`}
                </span>
              )}
            </div>
            <Sentence {...p.sentence} />
            <div className="compose-actions">
              <button className="btn btn-primary btn-lg" onClick={p.onContinue} disabled={!p.pasted.trim()}>
                Continue <ArrowRight className="arrow" />
              </button>
              {p.mode === 'text' && (
                <button className="btn btn-outline btn-lg" onClick={p.onHumanize} disabled={!p.pasted.trim()}>
                  Rewrite it to sound like me first
                </button>
              )}
            </div>
          </>
        )}

        {p.hasPrevious && (
          <p className="continue">
            <button className="link" onClick={p.onBackToLast}>
              Back to your last {p.mode === 'code' ? 'build' : 'draft'}
            </button>
          </p>
        )}

        {!isPaste && !p.prompt.trim() && (
          <div className="suggestions">
            <span className="label">Not sure where to start?</span>
            {SUGGESTIONS[p.mode].map((s) => (
              <button key={s} className="suggestion" onClick={() => p.onPrompt(s)}>
                <ArrowRight />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
