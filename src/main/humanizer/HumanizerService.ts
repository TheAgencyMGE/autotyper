import { checkFacts, scoreWriting, splitRewrite } from '@core/humanizer'
import { findTells, type Tell } from '@core/humanizer/tells'
import type { HumanizeRequest, HumanizeResult } from '@shared/types'
import { NotConnectedError, type AiConnections } from '../ai/AiConnections'
import type { Logger } from '../logging/Logger'
import aboudjemPatterns from './skill/aboudjem/patterns.md?raw'
import aboudjemSkill from './skill/aboudjem/SKILL.md?raw'
import bladerSkill from './skill/blader/SKILL.md?raw'

const MAX_INPUT_CHARS = 60_000
/** Run the second, corrective pass when the local checker still finds this much. */
const SECOND_PASS_SCORE = 35

/**
 * Rewrites text so it reads like a person wrote it. The AI follows two open
 * skills as its instructions: humanizer-skill (Adam Boudjemaa, MIT) and
 * blader/humanizer (Siqi Chen, MIT). The local checker (no AI) finds tells
 * before and after; if some survive, a second corrective pass targets exactly
 * those, the way blader's skill audits its own draft. A fact check catches any
 * number, date or name the rewrite dropped.
 */
export class HumanizerService {
  private controller: AbortController | null = null

  constructor(
    private readonly ai: AiConnections,
    private readonly log: Logger
  ) {}

  cancel(): void {
    this.controller?.abort()
    this.controller = null
  }

  async rewrite(req: HumanizeRequest, onText: (delta: string) => void): Promise<HumanizeResult> {
    this.cancel()
    const controller = new AbortController()
    this.controller = controller
    const source = req.text?.trim() ?? ''
    const before = scoreWriting(source)
    const tellsBefore = findTells(source)
    try {
      if (!source) throw new Error('Paste some text to rewrite first.')
      if (source.length > MAX_INPUT_CHARS) throw new Error('That’s a lot of text. Rewrite it in parts of up to about 9,000 words.')
      this.log.info('rewrite', `Rewriting ${before.words} words (${req.voice} voice, ${req.purpose}); ${tellsBefore.length} tells flagged locally…`)

      // Pass 1: full rewrite.
      const first = await this.ai.write({
        system: buildSystemPrompt(req),
        prompt: `${flaggedNote(tellsBefore)}<text>\n${source}\n</text>`,
        maxTokens: 32000,
        signal: controller.signal,
        onText
      })
      let { text, summary } = splitRewrite(first.text)
      let passes = 1

      // Pass 2: "what still makes this read as AI?", targeted at what the local checker still finds.
      const remaining = findTells(text)
      const afterFirst = scoreWriting(text)
      if (req.doubleCheck && (remaining.length > 0 || afterFirst.score > SECOND_PASS_SCORE)) {
        this.log.info('rewrite', `Second pass: ${remaining.length} tells left, score ${afterFirst.score}`)
        onText('\u0000') // tells the UI a fresh stream is starting
        const second = await this.ai.write({
          system: buildSystemPrompt(req),
          prompt: secondPassPrompt(text, remaining, afterFirst.score),
          maxTokens: 32000,
          signal: controller.signal,
          onText
        })
        const next = splitRewrite(second.text)
        // Keep the second pass only if it actually helped.
        if (next.text.trim() && (findTells(next.text).length < remaining.length || scoreWriting(next.text).score <= afterFirst.score)) {
          text = next.text
          summary = [summary, next.summary].filter(Boolean).join(' Then: ')
          passes = 2
        }
      }

      const after = scoreWriting(text)
      const facts = checkFacts(source, text)
      const tellsAfter = findTells(text).length
      this.log.success('rewrite', `Rewrote the text: score ${before.score} → ${after.score}, tells ${tellsBefore.length} → ${tellsAfter}${facts.ok ? '' : `, ${facts.lost.length} fact(s) to check`}`)
      return { ok: true, text, summary, before, after, lostFacts: facts.lost.map((f) => f.value), passes, tellsBefore: tellsBefore.length, tellsAfter }
    } catch (e) {
      const err = e as Error
      if (controller.signal.aborted || err.name === 'AbortError' || /UserAbort/.test(err.name)) return { ok: false, before, cancelled: true }
      if (err instanceof NotConnectedError) return { ok: false, before, needsConnection: true, error: err.message }
      this.log.error('rewrite', err.message)
      return { ok: false, before, error: err.message }
    } finally {
      if (this.controller === controller) this.controller = null
    }
  }
}

function flaggedNote(tells: Tell[]): string {
  if (!tells.length) return ''
  const list = [...new Set(tells.map((t) => `"${t.text.trim()}" (${t.why.toLowerCase()})`))].slice(0, 40).join('; ')
  return `A local checker flagged these phrases in the text: ${list}. Fix them along with anything else the skills describe.\n\n`
}

function secondPassPrompt(draft: string, tells: Tell[], score: number): string {
  const still = tells.length ? ` The local checker still flags: ${[...new Set(tells.map((t) => `"${t.text.trim()}"`))].slice(0, 40).join(', ')}.` : ''
  return `This is your rewrite. It still scores ${score}/100 for AI tells (0 = reads human).${still}

Ask yourself: "What still makes this obviously AI-generated?" Answer that silently, then do one corrective pass that fixes exactly those things and leaves everything else alone. Same output format as before.

<text>
${draft}
</text>`
}

function buildSystemPrompt(req: HumanizeRequest): string {
  const args = ['--mode rewrite', req.voice !== 'auto' ? `--voice ${req.voice}` : '', `--purpose ${req.purpose}`, req.aggressive ? '--aggressive' : '']
    .filter(Boolean)
    .join(' ')
  const primary = aboudjemSkill.replace(/^---[\s\S]*?---\s*/, '').replace('$ARGUMENTS', `${args} (the text is in the user message)`)
  const secondary = bladerSkill.replace(/^---[\s\S]*?---\s*/, '')
  return `${primary}

<reference file="references/patterns.md">
${aboudjemPatterns}
</reference>

<second_skill source="blader/humanizer (Wikipedia: Signs of AI writing)">
Apply this catalogue too. Where the two skills disagree, prefer keeping the writer's meaning and voice.

${secondary}
</second_skill>

## Running inside AutoWriter

You are running inside AutoWriter, a desktop app. You have no tools and no files: ignore any step that reads or edits files, loads humanizer-context.md, or asks the user a question. The user message contains the text to rewrite inside <text> tags.

Output exactly this and nothing else:
1. The rewritten text, as plain text ready to be typed into a document. Keep the original's paragraph breaks where they still make sense. Don't add Markdown the original didn't have.
2. A line containing only ---
3. A line starting with "Changes:" summarising what you changed, in one or two sentences.

Do not add a score header, a preamble, or commentary before the text.`
}
