// Captures every screen of the UI for design review. Never sends keystrokes to other apps.
// Usage: npm run build && node scripts/screenshots.mjs [outDir]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const out = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'autotyper-shots-'))
mkdirSync(out, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'autotyper-shots-data-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({ args: ['.'], env: { ...process.env, AUTOTYPER_USER_DATA: userData, ELECTRON_RENDERER_URL: '', ANTHROPIC_API_KEY: '' } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const size = process.env.SHOT_SIZE?.split('x').map(Number) ?? [1440, 900]
await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), size)
await page.waitForSelector('.display')
await sleep(700)
const shot = async (name) => {
  await sleep(450)
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log('saved', name)
}
const send = (status) =>
  app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'AutoTyper').webContents.send('typing:status', s)
  }, status)

// ---- AutoCoder
await shot('01-coder-idea')
await page.click('.path:has-text("Paste my own code")')
await page.fill('.paste-area textarea', "function greet(name) {\n  return `Hello, ${name}!`\n}\n\nconsole.log(greet('world'))\n")
await shot('02-coder-paste')
await page.click('.path:has-text("Describe an idea")')
await page.click('button:has-text("an AI (connect one first)")')
await shot('03-connections')
await page.fill('input[aria-label="Claude API key"]', 'sk-ant-not-a-real-key')
await page.click('.provider.open .key-row button[type=submit]')
await page.waitForSelector('.error-text', { timeout: 30000 })
await shot('04-connect-error')
await page.click('.provider-head:has-text("OpenRouter")')
await shot('04b-openrouter')
await page.click('.modal-foot button:has-text("Done")')

// Offline samples stand in for Claude so the workspace can be shown without a key.
await page.evaluate(() => window.autotyper.settings.update({ codegen: { provider: 'offline' } }))
await page.click('.suggestion >> nth=0')
await page.click('.compose-actions .btn-primary')
await page.waitForSelector('.sheet-foot .status:has-text("Ready")', { timeout: 20000 })
await shot('05-coder-workspace')
// The reported bug: the typing-style menu opened from the narrow side panel was cut off.
await page.click('.brief .choice[aria-label^="Typing style"]')
await page.click('.popover button:has-text("Fine-tune")')
await shot('05b-style-menu-in-workspace')
await page.keyboard.press('Escape')
await page.click('.brief .choice[aria-label^="Type into"]')
await shot('05c-target-menu-in-workspace')
await page.keyboard.press('Escape')

// ---- AutoWriter
await page.click('.mode:has-text("AutoWriter")')
await shot('06-writer-idea')
await page.click('.path:has-text("Paste my own text")')
const essay =
  "In today's fast-paced digital landscape, it is crucial to delve into the multifaceted tapestry of team dynamics. Moreover, fostering a culture of collaboration is not just important, it's essential.\n\nFurthermore, leveraging synergies can unlock transformative potential. In conclusion, embracing these pivotal strategies will undoubtedly pave the way for a brighter future."
await page.fill('.paste-area textarea', essay)
await shot('07-writer-paste')
await page.click('.compose-actions .btn-primary')
await shot('08-writer-workspace')
await page.click('.tells .link')
await shot('08b-writer-tells')
await page.click('button:has-text("Quick fix")')
await shot('08c-writer-quick-fixed')

const at = Math.floor(essay.length * 0.55)
const base = {
  target: { id: '1', pid: 1, title: 'Team notes.docx - Word', processName: 'WINWORD', editor: 'word', appName: 'Microsoft Word', isEditor: true, category: 'document' },
  totalChars: essay.length, totalLines: 3, wpm: 0, etaMs: 0, elapsedMs: 0, mistakesMade: 0, revisions: 0, speedMultiplier: 1, preset: 'veryHuman', mode: 'text'
}
await send({ ...base, state: 'typing', typedChars: at, currentLine: 3, wpm: 58, etaMs: 41000, elapsedMs: 52000, mistakesMade: 4, revisions: 2, activity: 'thinking' })
await shot('09-writer-typing')
await send({ ...base, state: 'completed', typedChars: essay.length, currentLine: 3, elapsedMs: 98000, mistakesMade: 7, revisions: 3, detail: 'Typed 402 characters into Microsoft Word.' })
await shot('10-writer-written')
await page.click('button:has-text("Back to the text")')
await send({ ...base, state: 'idle', typedChars: 0, currentLine: 0 })
await page.click('button[aria-label="Settings"]')
await shot('11-settings')

console.log(errors.length ? `renderer errors:\n${errors.join('\n')}` : 'no renderer errors')
console.log('out:', out)
await app.close()
