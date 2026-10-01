import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const SIGN_IN_TIMEOUT_MS = 5 * 60_000

const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px/1.5 system-ui;background:#f6f3ec;color:#23211d;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:420px;text-align:center"><h1 style="font:400 32px Georgia,serif">${title}</h1><p>${body}</p></div></body>`

/**
 * "Sign in with OpenRouter": OAuth PKCE with a loopback callback, as documented
 * at https://openrouter.ai/docs/use-cases/oauth-pkce. The browser does the
 * sign-in; AutoTyper only ever receives a key the user can revoke on OpenRouter.
 */
export async function signInWithOpenRouter(openBrowser: (url: string) => Promise<void>, signal?: AbortSignal): Promise<string> {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())

  const code = await new Promise<string>((resolve, reject) => {
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const c = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(c ? PAGE('You’re signed in', 'Go back to AutoTyper. You can close this tab.') : PAGE('Sign-in didn’t finish', 'Go back to AutoTyper and try again.'))
      finish(c ? null : new Error('Sign-in was cancelled.'), c ?? undefined)
    }
    // "localhost" may resolve to IPv4 or IPv6 depending on the browser, so listen on
    // both loopback addresses (same port). Nothing outside this computer can connect.
    const server = createServer(handler)
    const server6 = createServer(handler)
    const timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), SIGN_IN_TIMEOUT_MS)
    const onAbort = () => finish(new Error('Sign-in was cancelled.'))
    signal?.addEventListener('abort', onAbort)
    function finish(err: Error | null, value?: string) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      server.close()
      server6.close()
      if (err) reject(err)
      else resolve(value!)
    }
    server.on('error', (e) => finish(e))
    server6.on('error', () => {
      /* no IPv6 loopback on this machine; IPv4 is enough */
    })
    // Random free port (OpenRouter accepts localhost callbacks on any port).
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server6.listen(port, '::1')
      const params = new URLSearchParams({
        callback_url: `http://localhost:${port}/callback`,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        key_label: 'AutoTyper'
      })
      openBrowser(`https://openrouter.ai/auth?${params}`).catch((e) => finish(e))
    })
  })

  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
  })
  if (!res.ok) throw new Error(`OpenRouter couldn’t finish signing in (${res.status}). Try again.`)
  const { key } = (await res.json()) as { key?: string }
  if (!key) throw new Error('OpenRouter didn’t return a key. Try again.')
  return key
}
