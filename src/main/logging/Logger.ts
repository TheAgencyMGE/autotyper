import { EventEmitter } from 'node:events'
import { appendFile, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, LogLevel } from '@shared/types'

const MAX_ENTRIES = 600

/** In-memory ring buffer mirrored to the renderer and appended to a log file. */
export class Logger extends EventEmitter {
  private entries: LogEntry[] = []
  private nextId = 1
  private readonly file: string

  constructor(dir: string) {
    super()
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'autocoder.log')
  }

  history(): LogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  log(level: LogLevel, source: string, message: string): void {
    const entry: LogEntry = { id: this.nextId++, ts: Date.now(), level, source, message }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()
    this.emit('entry', entry)
    const line = `${new Date(entry.ts).toISOString()} [${level.toUpperCase()}] ${source}: ${message}\n`
    appendFile(this.file, line, () => {})
  }

  info(source: string, msg: string): void {
    this.log('info', source, msg)
  }
  success(source: string, msg: string): void {
    this.log('success', source, msg)
  }
  warn(source: string, msg: string): void {
    this.log('warn', source, msg)
  }
  error(source: string, msg: string): void {
    this.log('error', source, msg)
  }
  debug(source: string, msg: string): void {
    this.log('debug', source, msg)
  }
}
