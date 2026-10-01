export type CodeLanguage = 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'python' | 'html' | 'css' | 'json' | 'markdown' | 'text'

const BY_EXTENSION: Record<string, CodeLanguage> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', mts: 'typescript', tsx: 'tsx',
  py: 'python', html: 'html', htm: 'html', css: 'css', scss: 'css', json: 'json', md: 'markdown', txt: 'text'
}

export const EXTENSION_FOR: Record<CodeLanguage, string> = {
  javascript: 'js', jsx: 'jsx', typescript: 'ts', tsx: 'tsx', python: 'py', html: 'html', css: 'css', json: 'json', markdown: 'md', text: 'txt'
}

export function languageFromPath(path?: string): CodeLanguage | undefined {
  const ext = path?.split('.').pop()?.toLowerCase()
  return ext ? BY_EXTENSION[ext] : undefined
}

/** Best-effort detection from content; a file name wins when provided. */
export function detectLanguage(code: string, fileName?: string): CodeLanguage {
  const fromPath = languageFromPath(fileName)
  if (fromPath) return fromPath
  const s = code.trim()
  if (!s) return 'text'
  if (/^<!doctype html|^<html[\s>]/i.test(s)) return 'html'
  if (/^[{[]/.test(s)) {
    try {
      JSON.parse(s)
      return 'json'
    } catch {
      /* not JSON */
    }
  }
  if (/^\s*(def |class \w+(\(.*\))?:|import \w+$|from \w+(\.\w+)* import )/m.test(s) && !/[{};]\s*$/m.test(s)) return 'python'
  const ts = /(:\s*(string|number|boolean|void|any|unknown)\b|interface \w+|type \w+\s*=|<\w+>\(|as const)/.test(s)
  const jsx = /return\s*\(?\s*<[A-Za-z]|<\/[A-Za-z][\w.]*>|<[A-Z]\w*[\s/>]/.test(s)
  if (ts) return jsx ? 'tsx' : 'typescript'
  if (jsx) return 'jsx'
  if (/^[.#@]?[\w-]+\s*\{[^}]*:[^}]*\}/m.test(s) && !/function|=>|const /.test(s)) return 'css'
  if (/\b(function|const|let|var|import|export|=>|require\()\b/.test(s)) return 'javascript'
  return 'text'
}
