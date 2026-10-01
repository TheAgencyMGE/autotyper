import type { GenerateRequest, TypingMode } from '@shared/types'

const CODE_SYSTEM = `You write code for AutoCoder, which types it into the user's editor at a human pace.

Output rules:
- Output ONLY the contents of a single source file. No explanations, no Markdown, no code fences.
- The text you produce is typed verbatim into the editor, so it must be complete and ready to run.
- Use 2-space indentation unless the language or the project's existing code clearly uses something else (Python: 4 spaces).
- Keep lines reasonably short (under ~100 characters) and avoid trailing whitespace.
- Prefer clean, idiomatic, production-quality code with brief comments only where they add value.
- If project context is provided, match its framework, language, conventions and existing imports.
- If a target file with existing contents is provided, output the full new version of that file.`

const TEXT_SYSTEM = `You write documents for AutoWriter, which types them into Word, Google Docs or a text editor at a human pace.

Output rules:
- Output ONLY the text of the document itself: no preamble ("Here is…"), no notes to the user, no code fences.
- Plain text only. No Markdown: no #, no **bold**, no bullet asterisks. If a list is essential, write it as short sentences or "1)" items on their own lines.
- Separate paragraphs with one blank line. Don't indent paragraphs.
- Use — and … characters directly rather than -- or ..., since word processors rewrite those while typing.
- Match the requested tone, length and format (an email gets a greeting and sign-off; an essay gets a title line if appropriate).
- Write naturally and specifically, the way a thoughtful person would.`

export function systemPromptFor(mode: TypingMode): string {
  return mode === 'text' ? TEXT_SYSTEM : CODE_SYSTEM
}

export function buildUserPrompt(req: GenerateRequest, projectContext?: string): string {
  const parts: string[] = []
  const noun = req.mode === 'text' ? 'text' : 'code'
  if (projectContext) parts.push(`<project_context>\n${projectContext}\n</project_context>`)
  if (req.targetFile) parts.push(`The ${noun} will be typed into: ${req.targetFile}`)
  if (req.existingCode?.trim()) {
    parts.push(`<current_${noun}>\n${req.existingCode}\n</current_${noun}>\nThe request may refine or complete the current ${noun} above; return the complete updated version.`)
  }
  parts.push(`<request>\n${req.prompt.trim()}\n</request>`)
  return parts.join('\n\n')
}

/** Remove a wrapping Markdown fence if the model added one anyway. Safe on partial (streaming) text. */
export function stripCodeFences(text: string): string {
  let s = text.replace(/^﻿/, '')
  const open = /^\s*```[\w.+-]*[^\n]*\n/.exec(s)
  if (open) {
    s = s.slice(open[0].length)
    const close = s.lastIndexOf('\n```')
    if (close !== -1 && s.slice(close + 4).trim() === '') s = s.slice(0, close)
    else if (/^```\s*$/.test(s.trim())) s = ''
  }
  return s.replace(/\s+$/, '') + (s.trim() ? '\n' : '')
}

/** Final clean-up of generated output for the given mode. */
export function cleanOutput(text: string, mode: TypingMode): string {
  const s = stripCodeFences(text)
  // Documents shouldn't end with an empty paragraph.
  return mode === 'text' ? s.replace(/\s+$/, '') : s
}
