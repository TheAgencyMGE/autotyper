import type { EditorKind, WindowInfo } from '@shared/types'
import type { RawWindow } from './types'

type Category = WindowInfo['category']

interface EditorMatch {
  editor: EditorKind
  appName: string
  isEditor: boolean
  category: Category
  /** Sort priority: lower shows first. */
  rank: number
}

const CODE: Record<string, Omit<EditorMatch, 'isEditor' | 'category'>> = {
  code: { editor: 'vscode', appName: 'VS Code', rank: 0 },
  'code - insiders': { editor: 'vscode', appName: 'VS Code Insiders', rank: 0 },
  vscodium: { editor: 'vscode', appName: 'VSCodium', rank: 0 },
  cursor: { editor: 'cursor', appName: 'Cursor', rank: 1 },
  windsurf: { editor: 'windsurf', appName: 'Windsurf', rank: 2 },
  'notepad++': { editor: 'notepadpp', appName: 'Notepad++', rank: 4 },
  sublime_text: { editor: 'sublime', appName: 'Sublime Text', rank: 5 },
  zed: { editor: 'zed', appName: 'Zed', rank: 5 },
  devenv: { editor: 'visualstudio', appName: 'Visual Studio', rank: 6 },
  idea64: { editor: 'jetbrains', appName: 'IntelliJ IDEA', rank: 6 },
  webstorm64: { editor: 'jetbrains', appName: 'WebStorm', rank: 6 },
  pycharm64: { editor: 'jetbrains', appName: 'PyCharm', rank: 6 },
  phpstorm64: { editor: 'jetbrains', appName: 'PhpStorm', rank: 6 },
  goland64: { editor: 'jetbrains', appName: 'GoLand', rank: 6 },
  rider64: { editor: 'jetbrains', appName: 'Rider', rank: 6 },
  clion64: { editor: 'jetbrains', appName: 'CLion', rank: 6 },
  rubymine64: { editor: 'jetbrains', appName: 'RubyMine', rank: 6 },
  studio64: { editor: 'jetbrains', appName: 'Android Studio', rank: 6 },
  fleet: { editor: 'jetbrains', appName: 'Fleet', rank: 6 }
}

const DOCUMENT: Record<string, Omit<EditorMatch, 'isEditor' | 'category'>> = {
  winword: { editor: 'word', appName: 'Microsoft Word', rank: 0 },
  notepad: { editor: 'notepad', appName: 'Notepad', rank: 2 },
  wordpad: { editor: 'wordpad', appName: 'WordPad', rank: 3 },
  onenote: { editor: 'onenote', appName: 'OneNote', rank: 3 },
  'soffice.bin': { editor: 'libreoffice', appName: 'LibreOffice Writer', rank: 3 },
  obsidian: { editor: 'other', appName: 'Obsidian', rank: 4 },
  typora: { editor: 'other', appName: 'Typora', rank: 4 },
  notion: { editor: 'webdoc', appName: 'Notion', rank: 4 }
}

/** Other plain-text editors without special handling. */
const OTHER_EDITORS: Record<string, string> = {
  gvim: 'gVim',
  'nvim-qt': 'Neovim',
  neovide: 'Neovide',
  emacs: 'Emacs',
  kate: 'Kate',
  atom: 'Atom',
  brackets: 'Brackets',
  lapce: 'Lapce',
  textpad: 'TextPad',
  editplus: 'EditPlus',
  uedit64: 'UltraEdit'
}

const BROWSERS = new Set(['chrome', 'msedge', 'firefox', 'opera', 'brave', 'vivaldi', 'arc', 'chromium'])

/** Documents open in a browser tab, recognised by the window title. */
const WEB_DOCS: Array<{ re: RegExp; appName: string; editor: EditorKind }> = [
  { re: /Google Docs/i, appName: 'Google Docs', editor: 'googledocs' },
  { re: /Microsoft Word|Word Online|\.docx\b/i, appName: 'Word for the web', editor: 'webdoc' },
  { re: /Notion/i, appName: 'Notion', editor: 'webdoc' },
  { re: /Overleaf/i, appName: 'Overleaf', editor: 'webdoc' },
  { re: /Dropbox Paper|Quip|Coda|Craft/i, appName: 'Online document', editor: 'webdoc' }
]

export function classifyWindow(w: RawWindow): WindowInfo & { rank: number } {
  const proc = w.processName.toLowerCase()
  let match: EditorMatch
  if (CODE[proc]) match = { ...CODE[proc], isEditor: true, category: 'code' }
  else if (DOCUMENT[proc]) match = { ...DOCUMENT[proc], isEditor: true, category: 'document' }
  else if (OTHER_EDITORS[proc]) match = { editor: 'other', appName: OTHER_EDITORS[proc], isEditor: true, category: 'code', rank: 7 }
  else if (BROWSERS.has(proc) && WEB_DOCS.some((d) => d.re.test(w.title))) {
    const d = WEB_DOCS.find((x) => x.re.test(w.title))!
    match = { editor: d.editor, appName: d.appName, isEditor: true, category: 'document', rank: 1 }
  } else match = { editor: 'other', appName: prettyName(w.processName), isEditor: false, category: 'other', rank: 10 }

  return {
    id: w.id,
    pid: w.pid,
    title: w.title,
    processName: w.processName,
    exePath: w.exePath || undefined,
    editor: match.editor,
    appName: match.appName,
    isEditor: match.isEditor,
    category: match.category,
    elevated: !!w.elevated,
    rank: match.rank
  }
}

function prettyName(proc: string): string {
  if (!proc) return 'Unknown app'
  return proc.charAt(0).toUpperCase() + proc.slice(1)
}

/** Editors whose executable opens a file in an existing window when passed a path. */
export const OPENS_FILES_IN_PLACE = new Set<EditorKind>(['vscode', 'cursor', 'windsurf', 'notepadpp', 'sublime', 'zed'])

/** Code editors where arrow-key navigation is predictable (no soft wrap by default). */
export const NAVIGABLE_CODE_EDITORS = new Set<EditorKind>(['vscode', 'cursor', 'windsurf', 'sublime', 'notepadpp', 'zed', 'jetbrains', 'visualstudio'])
