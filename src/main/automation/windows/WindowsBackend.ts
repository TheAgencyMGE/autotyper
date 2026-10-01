import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { KeyOp } from '@core/typing/keyOps'
import type { AutomationBackend, RawWindow, SendResult, WindowRef } from '../types'
import helperSource from './AcHelper.cs?raw'
import hostScript from './host.ps1?raw'

interface Pending {
  resolve: (r: { status: string; payload: string }) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

const REQUEST_TIMEOUT_MS = 10_000
const READY_TIMEOUT_MS = 30_000

/**
 * Windows backend: a long-lived PowerShell process hosting a small C# helper
 * (Win32 EnumWindows / SetForegroundWindow / SendInput). No native Node modules,
 * so nothing needs compiling at install time and no install paths are assumed.
 */
export class WindowsBackend implements AutomationBackend {
  readonly name = 'Windows (SendInput)'
  readonly supported = true
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private lastError = ''

  constructor(
    private readonly workDir: string,
    private readonly onLog: (level: 'info' | 'warn' | 'error', msg: string) => void
  ) {}

  init(): Promise<void> {
    if (!this.ready) this.ready = this.start()
    return this.ready
  }

  private start(): Promise<void> {
    mkdirSync(this.workDir, { recursive: true })
    const hash = createHash('sha1').update(helperSource).digest('hex').slice(0, 10)
    writeFileSync(join(this.workDir, 'AcHelper.cs'), helperSource)
    writeFileSync(join(this.workDir, 'host.ps1'), hostScript)
    const assembly = join(this.workDir, `AcHelper-${hash}.dll`)
    const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

    const proc = spawn(
      ps,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(this.workDir, 'host.ps1'), '-OwnerPid', String(process.pid), '-AssemblyPath', assembly],
      { windowsHide: true }
    )
    this.proc = proc
    let stderr = ''
    proc.stderr.on('data', (d) => (stderr += d.toString()))

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Automation helper did not start in time' + summarize(stderr))), READY_TIMEOUT_MS)
      const rl = createInterface({ input: proc.stdout })
      rl.on('line', (line) => {
        if (line === 'READY') {
          clearTimeout(timer)
          this.lastError = ''
          resolve()
          return
        }
        const [idStr, status, b64] = line.split('\t')
        const p = this.pending.get(Number(idStr))
        if (!p) return
        this.pending.delete(Number(idStr))
        clearTimeout(p.timer)
        p.resolve({ status, payload: Buffer.from(b64 ?? '', 'base64').toString('utf8') })
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        const err = new Error(`Automation helper exited (code ${code})${summarize(stderr)}`)
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(err)
        }
        this.pending.clear()
        this.proc = null
        this.ready = null
        // Log each distinct failure once; callers retry on demand without flooding the log.
        if (code !== 0 && code !== null && err.message !== this.lastError) this.onLog('error', err.message)
        this.lastError = err.message
        reject(err)
      })
      proc.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
    })
  }

  private async request(...args: string[]): Promise<{ status: string; payload: string }> {
    await this.init()
    const proc = this.proc
    if (!proc) throw new Error('Automation helper is not running')
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Automation helper timed out on "${args[0]}"`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      proc.stdin.write([String(id), ...args].join('\t') + '\n')
    })
  }

  async listWindows(): Promise<RawWindow[]> {
    const r = await this.request('list')
    if (r.status !== 'OK') throw new Error(r.payload)
    return JSON.parse(r.payload) as RawWindow[]
  }

  async foreground(): Promise<RawWindow | null> {
    const r = await this.request('fg')
    return r.status === 'OK' ? (JSON.parse(r.payload) as RawWindow | null) : null
  }

  async selfElevated(): Promise<boolean> {
    const r = await this.request('self')
    return r.status === 'OK' && r.payload === 'elevated'
  }

  async focus(win: WindowRef): Promise<boolean> {
    const r = await this.request('focus', win.id)
    return r.status === 'OK' && r.payload === '1'
  }

  async send(win: WindowRef, ops: KeyOp[]): Promise<SendResult> {
    const encoded = ops
      .map((op) => {
        if (op.type === 'text') return 'T' + Buffer.from(op.text, 'utf8').toString('base64')
        if (op.type === 'key') return 'K' + op.key
        throw new Error('Paste ops must be handled by the typing controller')
      })
      .join(' ')
    const r = await this.request('run', win.id, String(win.pid), encoded)
    switch (r.status) {
      case 'OK':
        return { status: 'ok' }
      case 'MODIFIERS':
        return { status: 'modifiers' }
      case 'USER_INPUT':
      {
        const [index, what = ''] = r.payload.split('\n')
        return { status: 'user_input', executed: Number(index) || 0, what }
      }
      case 'GONE':
        return { status: 'gone', detail: r.payload }
      case 'FOCUS_LOST': {
        const nl = r.payload.indexOf('\n')
        const executed = Number(r.payload.slice(0, nl))
        let foreground: RawWindow | null = null
        try {
          foreground = JSON.parse(r.payload.slice(nl + 1))
        } catch {
          /* foreground window vanished mid-check */
        }
        return { status: 'focus_lost', executed, foreground }
      }
      default:
        throw new Error(r.payload || `Automation error (${r.status})`)
    }
  }

  dispose(): void {
    this.proc?.stdin.end()
    this.proc?.kill()
    this.proc = null
  }
}

/** First meaningful line of PowerShell's verbose error output. */
function summarize(stderr: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('+') && !l.startsWith('At '))
  return line ? `: ${line}` : ''
}
