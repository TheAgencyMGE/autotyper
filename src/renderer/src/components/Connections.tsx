import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, ChevronRight, LogIn, RefreshCw } from 'lucide-react'
import type { ProviderId, ProviderStatus } from '@shared/types'

interface Props {
  providers: ProviderStatus[]
  focus?: ProviderId
  onConnect: (id: ProviderId, key: string) => Promise<ProviderStatus[]>
  onSignIn: (id: ProviderId) => Promise<ProviderStatus[]>
  onDisconnect: (id: ProviderId) => Promise<ProviderStatus[]>
  onRefresh: (id?: ProviderId) => Promise<ProviderStatus[]>
  onOpenKeyPage: (id: ProviderId) => void
  onClose: () => void
}

const ABOUT: Record<ProviderId, { blurb: string; keyHint?: string; env?: string; free?: string }> = {
  anthropic: {
    blurb: 'Claude writes careful, well-structured code and prose.',
    keyHint: 'Create a key in the Anthropic Console',
    env: 'ANTHROPIC_API_KEY, or an Anthropic CLI login (ant auth login)'
  },
  openai: {
    blurb: 'The GPT models behind ChatGPT. (Signing in with a ChatGPT plan is limited to OpenAI’s approved partners for now, so this uses an API key.)',
    keyHint: 'Create a key on the OpenAI platform',
    env: 'OPENAI_API_KEY'
  },
  gemini: {
    blurb: 'Google’s Gemini models.',
    keyHint: 'Get a key in Google AI Studio',
    env: 'GEMINI_API_KEY',
    free: 'Free tier available'
  },
  openrouter: {
    blurb: 'One account for GPT, Claude, Gemini, Llama, DeepSeek and more, including free models. Sign in with your account, no key to copy.',
    keyHint: 'Or create a key on OpenRouter',
    env: 'OPENROUTER_API_KEY',
    free: 'Free models available'
  },
  ollama: {
    blurb: 'Runs open models on your own computer. Free and private; install Ollama and pull a model, then check again.',
    free: 'Free, runs locally'
  }
}

const SOURCE: Record<NonNullable<ProviderStatus['source']>, string> = {
  'saved-key': 'your saved API key',
  'signed-in': 'your account',
  environment: 'an environment variable',
  'cli-profile': 'your CLI login',
  local: 'this computer'
}

/** Connect AI providers: sign in, paste a key (verified before saving), or reuse what's already set up. */
export function Connections(p: Props) {
  const [open, setOpen] = useState<ProviderId | null>(p.focus ?? p.providers.find((x) => x.state !== 'connected')?.id ?? null)
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Partial<Record<ProviderId, string>>>({})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  const run = async (id: ProviderId, what: string, fn: () => Promise<ProviderStatus[]>) => {
    setBusy(`${id}:${what}`)
    setErrors((e) => ({ ...e, [id]: undefined }))
    try {
      const list = await fn()
      const s = list.find((x) => x.id === id)
      if (s?.error && (s.state !== 'connected' || what === 'key')) setErrors((e) => ({ ...e, [id]: s.error }))
      if (what === 'key' && s?.state === 'connected' && !s.error) setKeys((k) => ({ ...k, [id]: '' }))
    } finally {
      setBusy(null)
    }
  }

  const connectedCount = p.providers.filter((x) => x.state === 'connected').length

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="connections-title">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
          <h2 className="title" id="connections-title">
            AI connections
          </h2>
          <button className="btn btn-quiet" onClick={() => void run('ollama', 'refresh', () => p.onRefresh())} disabled={!!busy}>
            <RefreshCw /> Check all
          </button>
        </div>
        <p className="note" style={{ margin: '12px 0 0', fontSize: 15 }}>
          AutoTyper is free. To write or rewrite for you, it uses an AI service you connect: your own account, a key, or a free model on your computer.
          {connectedCount ? ` ${connectedCount} connected.` : ''}
        </p>

        <div className="providers">
          {p.providers.map((s) => {
            const about = ABOUT[s.id]
            const isOpen = open === s.id
            const connected = s.state === 'connected'
            return (
              <section key={s.id} className={`provider ${isOpen ? 'open' : ''}`}>
                <button className="provider-head" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                  {isOpen ? <ChevronDown /> : <ChevronRight />}
                  <span className="provider-name">{s.name}</span>
                  {about.free && <span className="provider-tag">{about.free}</span>}
                  <span className={`provider-state ${s.state}`}>
                    {connected ? (
                      <>
                        <Check /> Connected
                      </>
                    ) : s.state === 'error' ? (
                      'Needs attention'
                    ) : (
                      'Not connected'
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="provider-body">
                    <p className="note" style={{ margin: 0 }}>
                      {about.blurb}
                    </p>
                    {connected && (
                      <p className="note" style={{ margin: 0, color: 'var(--moss)' }}>
                        Connected with {SOURCE[s.source ?? 'saved-key']} · {s.models.length} {s.models.length === 1 ? 'model' : 'models'}
                        {s.models.length ? `: ${s.models.slice(0, 3).map((m) => m.name).join(', ')}${s.models.length > 3 ? '…' : ''}` : ''}
                      </p>
                    )}

                    {s.id === 'openrouter' && (
                      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void run(s.id, 'signin', () => p.onSignIn(s.id))} disabled={!!busy}>
                        <LogIn /> {busy === 'openrouter:signin' ? 'Waiting for your browser…' : connected && s.source === 'signed-in' ? 'Sign in again' : 'Sign in with OpenRouter'}
                      </button>
                    )}

                    {s.id !== 'ollama' && (
                      <>
                        <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => p.onOpenKeyPage(s.id)}>
                          {about.keyHint} <ArrowUpRight size={14} style={{ verticalAlign: '-2px' }} />
                        </button>
                        <form
                          className="key-row"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void run(s.id, 'key', () => p.onConnect(s.id, keys[s.id] ?? ''))
                          }}
                        >
                          <input
                            className="input"
                            type="password"
                            placeholder={connected ? 'Paste a different key' : 'Paste your API key'}
                            value={keys[s.id] ?? ''}
                            onChange={(e) => setKeys((k) => ({ ...k, [s.id]: e.target.value }))}
                            autoComplete="off"
                            aria-label={`${s.name} API key`}
                          />
                          <button className="btn btn-outline" type="submit" disabled={!keys[s.id]?.trim() || !!busy}>
                            {busy === `${s.id}:key` ? 'Checking…' : 'Connect'}
                          </button>
                        </form>
                        <p className="small" style={{ margin: 0 }}>
                          Keys are checked with {s.name.split(' (')[0]} before saving, then encrypted with your system’s keychain.
                          {about.env ? ` AutoTyper also picks up ${about.env} automatically.` : ''}
                        </p>
                      </>
                    )}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-quiet" onClick={() => void run(s.id, 'refresh', () => p.onRefresh(s.id))} disabled={!!busy}>
                        <RefreshCw /> {busy === `${s.id}:refresh` ? 'Checking…' : 'Check again'}
                      </button>
                      {connected && (s.source === 'saved-key' || s.source === 'signed-in') && (
                        <button className="btn btn-quiet" style={{ color: 'var(--brick)' }} onClick={() => void run(s.id, 'disconnect', () => p.onDisconnect(s.id))} disabled={!!busy}>
                          Disconnect
                        </button>
                      )}
                    </div>
                    {(errors[s.id] ?? (s.state === 'error' ? s.error : undefined)) && <p className="note error-text">{errors[s.id] ?? s.error}</p>}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={p.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
