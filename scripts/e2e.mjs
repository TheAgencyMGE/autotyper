// End-to-end test of AutoTyper against real apps (Windows):
//   AutoCoder: idea → build → preview → select VS Code → confirm → human-like typing
//              → pause → resume → focus-loss auto-pause → stop, plus full runs verified byte-for-byte.
//   AutoWriter: paste → continue → type prose into Notepad and into VS Code, verified byte-for-byte.
//   AI connections: real calls to Anthropic, OpenAI and OpenRouter with invalid keys must be rejected and not saved.
// VS Code runs as an isolated instance (temporary profile, default settings). Notepad is only used
// if it isn't already open, and is closed afterwards.
//
// Usage: npm run e2e        (needs the `code` CLI on PATH; keep hands off the keyboard while it runs)
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { _electron as electron } from 'playwright-core'

const root = mkdtempSync(join(tmpdir(), 'autotyper-e2e-'))
const userData = join(root, 'userData')
const vscodeData = join(root, 'vscode-data')
const project = join(root, 'demo-project')
mkdirSync(join(project, 'src'), { recursive: true })
mkdirSync(join(vscodeData, 'User'), { recursive: true })
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'demo-project', dependencies: { react: '^19.0.0' } }, null, 2))
const files = {
  stop: 'ac-stop.jsx',
  full: 'ac-full.jsx',
  instant: 'ac-instant.jsx',
  rev: 'ac-revisions.js',
  revpy: 'ac-revisions.py',
  proseCode: 'aw-in-vscode.txt',
  proseNotepad: 'aw-in-notepad.txt'
}
for (const f of Object.values(files)) writeFileSync(join(project, 'src', f), '')
// A clean VS Code profile: default editor behaviour (auto-closing, auto-indent, suggestions) stays ON.
writeFileSync(
  join(vscodeData, 'User', 'settings.json'),
  JSON.stringify({
    'security.workspace.trust.enabled': false,
    'workbench.startupEditor': 'none',
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'workbench.tips.enabled': false,
    'chat.disableAIFeatures': true,
    'extensions.ignoreRecommendations': true,
    'window.restoreWindows': 'none'
  })
)

const results = []
const pass = (name, detail = '') => {
  results.push({ name, ok: true })
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
const fail = (name, detail) => {
  results.push({ name, ok: false })
  console.log(`  ✗ ${name} — ${detail}`)
}
const check = (name, cond, detail = '') => (cond ? pass(name, detail) : fail(name, detail || 'assertion failed'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Editors may save with CRLF on Windows; line endings are the editor's choice, not ours.
const readText = (f) => readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

async function waitFor(fn, { timeout = 60_000, interval = 150, what = 'condition' } = {}) {
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await sleep(interval)
  }
}

function openInVsCode(file) {
  execSync(`code --user-data-dir "${vscodeData}" --extensions-dir "${join(root, 'vscode-ext')}" -r "${file}"`, { stdio: 'ignore', shell: true })
}

// A second helper instance (same compiled assembly the app built) to send Ctrl+S and steal focus.
function startHelper() {
  const dir = join(userData, 'automation')
  const dll = readdirSync(dir).find((f) => /^AcHelper-.*\.dll$/.test(f))
  const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const proc = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(dir, 'host.ps1'), '-OwnerPid', '0', '-AssemblyPath', join(dir, dll)], { windowsHide: true })
  const rl = createInterface({ input: proc.stdout })
  const waiters = new Map()
  let ready
  const readyP = new Promise((r) => (ready = r))
  let id = 0
  rl.on('line', (line) => {
    if (line === 'READY') return ready()
    const [i, status, b64] = line.split('\t')
    waiters.get(Number(i))?.({ status, payload: Buffer.from(b64 ?? '', 'base64').toString('utf8') })
  })
  return {
    ready: readyP,
    req: (...args) =>
      new Promise((resolve) => {
        const n = ++id
        waiters.set(n, resolve)
        proc.stdin.write([n, ...args].join('\t') + '\n')
      }),
    kill: () => proc.kill()
  }
}

// VS Code instances left behind by an earlier, interrupted run have windows with the same
// titles as this run's, so close them first.
function closeStaleVsCode() {
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Code.exe' -and $_.CommandLine -like '*autotyper-e2e-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    )
  } catch {
    /* none running */
  }
}

// Seconds since the last keyboard/mouse input on this PC.
function idleSeconds() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class Idle{[StructLayout(LayoutKind.Sequential)]struct LII{public uint cbSize;public uint dwTime;}[DllImport(\\"user32.dll\\")]static extern bool GetLastInputInfo(ref LII p);public static uint Ms(){LII l=new LII();l.cbSize=8;GetLastInputInfo(ref l);return (uint)Environment.TickCount-l.dwTime;}}'; [Idle]::Ms()"`
    ).toString()
    return Number(out.trim()) / 1000
  } catch {
    return Infinity
  }
}

// These runs drive the real keyboard, so wait until nobody is using the PC.
async function waitForIdle(seconds = 60) {
  let told = false
  while (idleSeconds() < seconds) {
    if (!told) console.log(`    (waiting for ${seconds}s without keyboard/mouse use before typing)`)
    told = true
    await sleep(2000)
  }
}

// Every window the test drives (AutoTyper, its Stop pill, VS Code, Notepad) is moved off the
// edge of the screen. Windows still sends keystrokes to the focused window even when it can't
// be seen, so the run is invisible. Don't type while it runs: keys would go to that window.
const OFFSCREEN = { x: -6000, y: 0, width: 1480, height: 920 }

function hideWindow(hwnd) {
  const { x, y, width, height } = OFFSCREEN
  try {
    execSync(
      `powershell -NoProfile -Command "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class Place{[DllImport(\\"user32.dll\\")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport(\\"user32.dll\\")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int ht,uint f);}'; $h=[IntPtr]${hwnd}; [Place]::ShowWindow($h,4) | Out-Null; [Place]::SetWindowPos($h,[IntPtr]::Zero,${x},${y},${width},${height},0x14) | Out-Null"`,
      { stdio: 'ignore' }
    )
  } catch {
    /* best effort */
  }
}

async function main() {
  closeStaleVsCode()
  console.log(`E2E workspace: ${root}\n`)
  const app = await electron.launch({ args: ['.'], env: { ...process.env, AUTOTYPER_USER_DATA: userData, ELECTRON_RENDERER_URL: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '', OPENROUTER_API_KEY: '' } })
  const page = await app.firstWindow()
  await app.evaluate(({ app, BrowserWindow }, b) => {
    const hide = (w) => w.setPosition(b.x, b.y)
    for (const w of BrowserWindow.getAllWindows()) hide(w)
    app.on('browser-window-created', (_e, w) => {
      hide(w)
      w.on('show', () => hide(w))
    })
  }, OFFSCREEN)
  page.on('pageerror', (e) => fail('renderer error', e.message))
  await page.waitForSelector('.display')
  const api = (fn, ...args) => page.evaluate(fn, ...args)
  const status = () => api(() => window.autotyper.typing.status())
  // Waits for typing progress. If someone uses the PC meanwhile, AutoTyper pauses (another
  // window came to the front, or a key/click); wait until they've gone idle, then resume.
  const progress = (cond, what, timeout) => {
    let interruptions = 0
    return waitFor(
      async () => {
        const s = await status()
        if (s.state === 'paused' && /came to the front|pressed a key/.test(s.detail ?? '') && interruptions < 20) {
          interruptions++
          console.log(`    (interrupted during ${what}; resuming once the PC is idle)`)
          await waitForIdle()
          await api(() => window.autotyper.typing.resume())
          return null
        }
        return cond(s)
      },
      { what, timeout: timeout + 30 * 60_000 }
    )
  }
  const draftKey = (mode) => `autotyper.${mode}.draft`

  console.log('Startup')
  await waitFor(() => api(async () => (await window.autotyper.log.history()).some((e) => e.source === 'automation' && e.level === 'success')), {
    what: 'automation helper',
    timeout: 45_000
  })
  pass('keyboard automation helper started')

  console.log('\nAI connections (real calls to each provider)')
  const initial = await api(() => window.autotyper.ai.refresh())
  check('providers start disconnected without credentials', initial.every((p) => p.state === 'disconnected'), initial.map((p) => `${p.id}:${p.state}`).join(' '))
  await page.click('button:has-text("Connect AI")')
  for (const [id, name] of [['anthropic', 'Claude'], ['openai', 'ChatGPT (OpenAI)'], ['openrouter', 'OpenRouter']]) {
    if (!(await page.locator(`.provider.open:has-text("${name}")`).count())) await page.click(`.provider-head:has-text("${name}")`)
    await page.fill(`input[aria-label="${name} API key"]`, 'autotyper-e2e-invalid-key')
    await page.click('.provider.open .key-row button[type=submit]')
    const errText = await page.waitForSelector('.provider.open .error-text', { timeout: 30_000 }).then((el) => el.innerText())
    check(`${name}: invalid key rejected by the real API`, /didn’t accept that key|Couldn’t reach/.test(errText), errText)
  }
  const after = await api(() => window.autotyper.ai.status())
  check('rejected keys are never saved', after.every((p) => p.state !== 'connected'))
  await page.click('.modal-foot button:has-text("Done")')

  // From here on, offline samples stand in for Claude so typing can be tested without an API key.
  await api(() => window.autotyper.settings.update({ countdownSeconds: 1, codegen: { provider: 'offline' }, mode: 'code' }))
  await page.reload()
  await page.waitForSelector('.display')

  console.log('\nAutoCoder: describe → build → preview')
  await page.click('.path:has-text("Describe an idea")')
  await page.fill('textarea[aria-label="Describe what you want"]', 'Make me a React landing page with a dark theme, animated background, navbar, hero section, and pricing cards.')
  await page.click('.compose-actions .btn-primary')
  await waitFor(() => api((k) => JSON.parse(localStorage.getItem(k) ?? '{}').content?.includes('export default function LandingPage'), draftKey('code')), { what: 'generation' })
  const landing = await api((k) => JSON.parse(localStorage.getItem(k)).content, draftKey('code'))
  check('code generated and shown in preview', (await page.locator('.cm-content').innerText()).includes('LandingPage'), `${landing.length} chars`)

  console.log('\nAutoCoder: paste my own code')
  await page.click('button:has-text("New build")')
  await page.click('.path:has-text("Paste my own code")')
  await page.fill('.paste-area textarea', 'const answer = 42\nconsole.log(answer)\n')
  await page.click('.compose-actions .btn-primary')
  const pastedShown = await page.locator('.cm-content').innerText()
  check('pasted code goes straight to the preview', pastedShown.includes('const answer = 42'))
  await page.click('button:has-text("New build")')
  await page.click('.path:has-text("Describe an idea")')
  await api(({ k, c }) => localStorage.setItem(k, JSON.stringify({ source: 'idea', prompt: 'landing page', pasted: '', content: c })), { k: draftKey('code'), c: landing })

  console.log('\nProject awareness')
  const proj = await api((p) => window.autotyper.project.open(p), project)
  check('project folder scanned read-only', proj?.tree.children.some((c) => c.name === 'src'), `${proj?.fileCount} entries`)

  const findVs = (file) =>
    waitFor(() => api(async (f) => (await window.autotyper.windows.list()).find((w) => w.editor === 'vscode' && w.title.includes(f)), file), {
      what: `VS Code window for ${file}`,
      timeout: 60_000
    }).then((w) => (hideWindow(w.id), w))
  const selectTarget = async (fileOrTitle) => {
    await page.click('.choice[aria-label^="Type into"]')
    await page.click('.popover button:has-text("Refresh")').catch(() => {})
    await page.waitForSelector(`.popover .option:has-text("${fileOrTitle}")`, { timeout: 20_000 })
    await page.click(`.popover .option:has-text("${fileOrTitle}")`)
  }
  const startTyping = async () => {
    await page.click('.brief-actions .btn-primary')
    await page.waitForSelector('.modal:has-text("Ready to type into")')
    await page.check('.modal input[type=checkbox]')
    await page.click('.modal-foot .btn-primary')
  }

  console.log('\nAutoCoder: select VS Code → start → pause → resume → focus loss → stop')
  openInVsCode(join(project, 'src', files.stop))
  const vs = await findVs(files.stop)
  pass('detected VS Code window', `"${vs.title}"`)
  await sleep(2500) // let the fresh VS Code instance finish loading
  await api(
    (p) => window.autotyper.settings.update({ humanization: p }),
    { preset: 'custom', minWpm: 140, maxWpm: 170, mistakeRate: 0.02, pauseVariation: true, thinkingPauses: false, burstiness: 0.5, pauseFrequency: 0.2, revisionRate: 0.6,
      behaviors: { copyPaste: true, todoComments: true, rewrites: true, lateFixes: true, rereading: true, distractions: false, fatigue: true } }
  )
  await page.reload()
  await page.waitForSelector('.display')
  await page.click('button:has-text("Back to your last build")')
  await selectTarget(files.stop)
  check('"Ready to type into" shown', (await page.locator('.ready-note').innerText()).includes('Visual Studio Code'))
  await page.click('.brief-actions .btn-primary')
  await page.waitForSelector('.modal:has-text("Ready to type into")')
  check('start requires explicit confirmation', await page.locator('.modal-foot .btn-primary').isDisabled())
  await page.check('.modal input[type=checkbox]')
  await waitForIdle()
  await page.click('.modal-foot .btn-primary')

  await waitFor(async () => (await status()).state === 'typing', { what: 'typing to start' })
  pass('typing started in VS Code')
  await progress((s) => s.typedChars > 250, 'progress', 120_000)
  await page.screenshot({ path: join(root, '01-typing.png') })

  await page.click('.run-controls button:has-text("Pause")')
  await waitFor(async () => (await status()).state === 'paused', { what: 'pause' })
  const pausedAt = (await status()).typedChars
  await sleep(1500)
  check('pause halts typing immediately', (await status()).typedChars === pausedAt, `held at ${pausedAt} chars`)

  await page.click('.run-controls button:has-text("Resume")')
  await waitFor(async () => (await status()).state === 'typing', { what: 'resume' })
  await progress((s) => s.typedChars > pausedAt + 60, 'progress after resume', 90_000)
  pass('resume re-focuses VS Code and continues')

  const helper = startHelper()
  await helper.ready
  const appHwnd = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'AutoTyper').getNativeWindowHandle().readBigUInt64LE(0).toString())
  await waitForIdle(15)
  await helper.req('focus', appHwnd)
  await waitFor(async () => (await status()).state === 'paused', { what: 'auto-pause on focus loss', timeout: 10_000 })
  const s1 = await status()
  check('focus loss auto-pauses typing', /came to the front/i.test(s1.detail ?? ''), s1.detail)
  await sleep(1200)
  check('no keystrokes while target is not focused', (await status()).typedChars === s1.typedChars)

  await page.click('.run-controls button:has-text("Resume")')
  await progress((s) => s.typedChars > s1.typedChars + 40, 'progress after focus-loss resume', 90_000)
  pass('resumes after focus loss')

  await waitForIdle(15)
  // A key press that isn't AutoTyper's own (F24: harmless, bound to nothing) pauses typing.
  execSync(
    `powershell -NoProfile -Command "Add-Type -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern void keybd_event(byte v, byte s, uint f, UIntPtr e);' -Name K -Namespace W; [W.K]::keybd_event(0x87,0,0,[UIntPtr]::Zero); [W.K]::keybd_event(0x87,0,2,[UIntPtr]::Zero)"`
  )
  await waitFor(async () => (await status()).state === 'paused', { what: 'auto-pause on a key press', timeout: 10_000 })
  const s2 = await status()
  check('pressing a key pauses typing', /pressed a key/i.test(s2.detail ?? ''), s2.detail)
  await page.click('.run-controls button:has-text("Resume")')
  await progress((s) => s.typedChars > s2.typedChars + 40, 'progress after key-press resume', 90_000)
  pass('resumes after a key press')

  await page.click('.run-controls button:has-text("Stop")')
  await waitFor(async () => (await status()).state === 'stopped', { what: 'stop' })
  const stoppedAt = (await status()).typedChars
  await sleep(1000)
  check('stop ends typing immediately', (await status()).typedChars === stoppedAt, `stopped at ${stoppedAt}/${landing.length}`)

  const save = async (win) => {
    // Ctrl+S is focus-guarded; if another window grabbed the front, refocus and try again.
    for (let attempt = 0; attempt < 5; attempt++) {
      await helper.req('focus', win.id)
      await sleep(300)
      const r = await helper.req('run', win.id, String(win.pid), 'Kctrl+s')
      if (r.status === 'OK') break
      await sleep(700)
    }
    await sleep(1200)
  }
  await save(vs)
  const partial = readText(join(project, 'src', files.stop))
  check('stopped output is a clean prefix of the code', partial.length > 200 && landing.startsWith(partial.slice(0, Math.max(0, partial.length - 60))), `${partial.length} chars on disk`)
  await page.click('button:has-text("Back to the code")')

  // ---- full runs, verified byte-for-byte
  async function fullRun(label, { mode, file, text, profile, target }, attempt = 1) {
    const win = await target(file)
    await sleep(1500)
    await api(({ k, t }) => localStorage.setItem(k, JSON.stringify({ source: 'paste', prompt: '', pasted: t, content: t })), { k: draftKey(mode), t: text })
    await api(({ p, m }) => window.autotyper.settings.update({ humanization: p, mode: m }), { p: profile, m: mode })
    await page.reload()
    await page.waitForSelector('.display')
    await page.click('.compose-actions .btn-primary') // Continue with the pasted text
    await selectTarget(win.title.split(' - ')[0])
    await waitForIdle()
    await startTyping()
    const started = Date.now()
    const final = await waitFor(
      async () => {
        const s = await status()
        return ['completed', 'error', 'stopped', 'paused'].includes(s.state) ? s : null
      },
      { what: `${label} to finish`, timeout: 420_000, interval: 300 }
    ).catch(async (e) => ({ state: 'timeout', detail: `${e.message}; last status ${JSON.stringify(await status())}` }))
    if (final.state === 'paused') {
      await page.screenshot({ path: join(root, `stuck-${file}.png`) })
      await api(() => window.autotyper.typing.stop())
      // Focus-loss pausing is checked above. Here another window (a notification, someone using
      // the PC) took the front. Resuming would pull focus back mid-use, so start over cleanly
      // in a fresh file instead.
      if (/came to the front|pressed a key/.test(final.detail ?? '') && attempt < 10) {
        console.log(`    (interrupted: ${final.detail.split(/ came| so typing/)[0]}; starting this run again)`)
        await page.click('button:has-text("Back to the")').catch(() => {})
        await sleep(5000)
        const retry = file.replace(/(\.\w+)$/, `-retry${attempt}$1`)
        writeFileSync(join(project, 'src', retry), '')
        return fullRun(label, { mode, file: retry, text, profile, target }, attempt + 1)
      }
    }
    if (final.state !== 'completed') {
      fail(label, `${final.state}: ${final.detail}`)
    } else {
      await save(win)
      // After an instant run the editor may still be working through its input queue, so the
      // save lands a few seconds later. Give it time before comparing.
      const path = join(project, 'src', file)
      const onDisk = await waitFor(() => (readText(path) === text ? text : null), { timeout: 60_000, interval: 500, what: 'save' }).catch(() => readText(path))
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      if (onDisk === text) pass(label, `${text.length} chars in ${secs}s, ${final.mistakesMade} typos, ${final.revisions} revisions, exact match`)
      else {
        let i = 0
        while (i < text.length && text[i] === onDisk[i]) i++
        writeFileSync(join(root, `${file}.expected`), text)
        writeFileSync(join(root, `${file}.actual`), onDisk)
        fail(label, `mismatch at char ${i}: expected ${JSON.stringify(text.slice(i, i + 30))} got ${JSON.stringify(onDisk.slice(i, i + 30))}`)
      }
    }
    await page.click('button:has-text("Back to the")').catch(() => {})
  }

  const templates = readFileSync(new URL('../src/main/codegen/templates.ts', import.meta.url), 'utf8')
  const extract = (name) => {
    const m = new RegExp('const ' + name + ' = `([\\s\\S]*?)`\\n').exec(templates)
    return m[1].replace(/\\`/g, '`').replace(/\\\$/g, '$')
  }
  const human = (min, max, extra = {}) => ({
    preset: 'custom', minWpm: min, maxWpm: max, mistakeRate: 0.03, pauseVariation: true, thinkingPauses: false, burstiness: 0.5, pauseFrequency: 0.1, revisionRate: 1,
    behaviors: { copyPaste: true, todoComments: true, rewrites: true, lateFixes: true, rereading: true, distractions: false, fatigue: true },
    ...extra
  })
  const vsTarget = async (file) => {
    openInVsCode(join(project, 'src', file))
    return findVs(file)
  }

  await app.evaluate(({ clipboard }) => clipboard.writeText('AUTOTYPER-CLIPBOARD-SENTINEL'))

  console.log('\nAutoCoder full runs (VS Code with default auto-close/auto-indent, saved, compared byte-for-byte)')
  await fullRun('human-like run with typos and revisions (React component)', { mode: 'code', file: files.full, text: extract('reactTodo'), profile: human(180, 220), target: vsTarget })
  await fullRun('revision-heavy run (Express API)', { mode: 'code', file: files.rev, text: extract('expressApi'), profile: human(190, 220), target: vsTarget })
  await fullRun('revision-heavy run (Python)', { mode: 'code', file: files.revpy, text: extract('pythonCli'), profile: human(190, 220), target: vsTarget })
  await fullRun('instant run (full landing page)', {
    mode: 'code', file: files.instant, text: landing,
    profile: { preset: 'instant', minWpm: 0, maxWpm: 0, mistakeRate: 0, pauseVariation: false, thinkingPauses: false, burstiness: 0, pauseFrequency: 0, revisionRate: 0, behaviors: {} },
    target: vsTarget
  })

  console.log('\nAutoWriter full runs (prose with typos, word swaps, restarts and go-back fixes)')
  const prose = extract('TEXT_SAMPLE')
  await fullRun('AutoWriter into VS Code (.txt)', { mode: 'text', file: files.proseCode, text: prose, profile: human(200, 230), target: vsTarget })

  const notepadRunning = execSync('tasklist /FI "IMAGENAME eq notepad.exe"').toString().toLowerCase().includes('notepad.exe')
  if (notepadRunning) {
    console.log('  – skipped Notepad run: Notepad is already open and we won’t touch your windows')
  } else {
    await fullRun('AutoWriter into Notepad', {
      mode: 'text', file: files.proseNotepad, text: prose, profile: human(200, 230),
      target: async (file) => {
        spawn('notepad.exe', [join(project, 'src', file)], { detached: true, stdio: 'ignore' }).unref()
        return waitFor(() => api(async (f) => (await window.autotyper.windows.list()).find((w) => w.editor === 'notepad' && w.title.includes(f)), file), {
          what: 'Notepad window',
          timeout: 30_000
        }).then((w) => (hideWindow(w.id), w))
      }
    })
  }

  const logs = await api(() => window.autotyper.log.history())
  const behaviours = logs.filter((l) => l.source === 'humanizer').map((l) => l.message.replace(/\d+/g, 'N').replace(/".*?"/g, '"…"'))
  const counts = {}
  for (const b of behaviours) counts[b] = (counts[b] ?? 0) + 1
  console.log('\n    behaviours seen: ' + Object.entries(counts).map(([k, v]) => `${v}× ${k}`).join(' | '))
  check('revision behaviours ran in real editors', behaviours.some((b) => /Copying|TODO|going back|rewrit|False start|Re-reading|Swapped|Restarting/.test(b)))
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
  check("user's clipboard restored after copy/paste", clip === 'AUTOTYPER-CLIPBOARD-SENTINEL', JSON.stringify(clip).slice(0, 60))
  check('no errors in activity log', !logs.some((l) => l.level === 'error'), logs.filter((l) => l.level === 'error').map((l) => l.message).join(' | '))
  await page.screenshot({ path: join(root, '99-done.png') })

  helper.kill()
  await app.close()
  // Close the isolated VS Code instance, and Notepad if we opened it.
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'Code.exe' -and $_.CommandLine -like '*${basename(root)}*') -or ($_.Name -eq 'Notepad.exe' -and ${notepadRunning ? '$false' : '$true'}) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    )
  } catch {
    /* already closed */
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${root}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('\nE2E aborted:', e)
  process.exit(1)
})
