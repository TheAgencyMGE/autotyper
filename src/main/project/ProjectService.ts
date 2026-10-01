import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ProjectInfo, ProjectNode } from '@shared/types'

const IGNORED = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.cache', 'coverage',
  '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', '.idea', '.vs', 'target', 'bin', 'obj',
  '.gradle', '.DS_Store', 'vendor'
])
const MAX_DEPTH = 6
const MAX_ENTRIES = 800
const MAX_READ_BYTES = 512 * 1024
const CONTEXT_FILE_BYTES = 24 * 1024

/**
 * Read-only project awareness. AutoCoder never writes into the project:
 * code reaches files only through the visible typing session (or an explicit Save As).
 */
export class ProjectService {
  async scan(root: string): Promise<ProjectInfo> {
    const abs = resolve(root)
    let count = 0
    let truncated = false

    const walk = async (dir: string, rel: string, depth: number): Promise<ProjectNode[]> => {
      if (depth > MAX_DEPTH) {
        truncated = true
        return []
      }
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return []
      }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      const nodes: ProjectNode[] = []
      for (const e of entries) {
        if (IGNORED.has(e.name) || (e.name.startsWith('.') && e.isDirectory())) continue
        if (count >= MAX_ENTRIES) {
          truncated = true
          break
        }
        count++
        const childRel = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) {
          nodes.push({ name: e.name, path: childRel, type: 'dir', children: await walk(join(dir, e.name), childRel, depth + 1) })
        } else if (e.isFile()) {
          nodes.push({ name: e.name, path: childRel, type: 'file' })
        }
      }
      return nodes
    }

    const children = await walk(abs, '', 0)
    return { root: abs, name: basename(abs), tree: { name: basename(abs), path: '', type: 'dir', children }, fileCount: count, truncated }
  }

  /** Resolve a project-relative path, refusing anything that escapes the root. */
  resolveInside(root: string, relPath: string): string {
    const absRoot = resolve(root)
    const target = resolve(absRoot, relPath)
    const rel = relative(absRoot, target)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside the project folder.')
    return target
  }

  async readFile(root: string, relPath: string): Promise<string> {
    const file = this.resolveInside(root, relPath)
    const s = await stat(file)
    if (s.size > MAX_READ_BYTES) throw new Error(`${relPath} is too large to preview (${Math.round(s.size / 1024)} KB).`)
    return readFile(file, 'utf8')
  }

  /** Compact textual context for code generation: tree + key files + the target file. */
  async buildContext(root: string, targetFile?: string): Promise<string> {
    const info = await this.scan(root)
    const parts: string[] = [`Project "${info.name}" structure:\n${renderTree(info.tree)}${info.truncated ? '\n… (truncated)' : ''}`]

    const keyFiles = ['package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt', 'README.md']
    for (const f of keyFiles) {
      const content = await this.readSnippet(root, f, 4 * 1024)
      if (content) parts.push(`--- ${f} ---\n${content}`)
    }
    if (targetFile) {
      const content = await this.readSnippet(root, targetFile, CONTEXT_FILE_BYTES)
      parts.push(content !== null ? `--- Target file: ${targetFile} (current contents) ---\n${content || '(empty file)'}` : `Target file: ${targetFile} (new file)`)
    }
    return parts.join('\n\n')
  }

  private async readSnippet(root: string, rel: string, max: number): Promise<string | null> {
    try {
      const text = await readFile(this.resolveInside(root, rel), 'utf8')
      return text.length > max ? text.slice(0, max) + '\n… (truncated)' : text
    } catch {
      return null
    }
  }
}

export function renderTree(node: ProjectNode, prefix = ''): string {
  const lines: string[] = prefix ? [] : [`${node.name}/`]
  const kids = node.children ?? []
  kids.forEach((child, i) => {
    const last = i === kids.length - 1
    lines.push(`${prefix}${last ? '└── ' : '├── '}${child.name}${child.type === 'dir' ? '/' : ''}`)
    if (child.type === 'dir' && child.children?.length) lines.push(renderTree(child, prefix + (last ? '    ' : '│   ')))
  })
  return lines.join('\n')
}

export const toPosix = (p: string): string => p.split(sep).join('/')
