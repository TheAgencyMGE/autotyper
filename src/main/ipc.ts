import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { estimateDurationMs } from '@core/typing/engine'
import { IPC } from '@shared/ipc'
import type { GenerateRequest, HumanizationProfile, HumanizeRequest, ProviderId, SettingsPatch, StartTypingRequest, TypingMode } from '@shared/types'
import type { AiConnections } from './ai/AiConnections'
import type { CodegenService } from './codegen/CodegenService'
import type { HumanizerService } from './humanizer/HumanizerService'
import type { Logger } from './logging/Logger'
import type { ProjectService } from './project/ProjectService'
import type { SettingsStore } from './settings/SettingsStore'
import type { TypingController } from './typing/TypingController'
import type { WindowService } from './automation/WindowService'

export interface Services {
  settings: SettingsStore
  codegen: CodegenService
  ai: AiConnections
  humanizer: HumanizerService
  project: ProjectService
  windows: WindowService
  typing: TypingController
  log: Logger
  getMainWindow: () => BrowserWindow | null
  onSettingsChanged: () => void
}

const MAX_CODE_CHARS = 500_000
const isMode = (m: unknown): m is TypingMode => m === 'code' || m === 'text'

export function registerIpc(s: Services): void {
  const { settings, codegen, ai, humanizer, project, windows, typing, log } = s

  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: SettingsPatch) => {
    const next = settings.update(patch)
    s.onSettingsChanged()
    return next
  })
  const isProvider = (id: unknown): id is ProviderId => ai.list().some((p) => p.id === id)
  const guard = <T>(id: unknown, fn: (id: ProviderId) => Promise<T>): Promise<T> => {
    if (!isProvider(id)) throw new Error('Unknown AI provider.')
    return fn(id)
  }
  ipcMain.handle(IPC.aiStatus, () => ai.list())
  ipcMain.handle(IPC.aiRefresh, (_e, id?: ProviderId) => (id ? guard(id, (p) => ai.refresh(p)) : ai.refresh()))
  ipcMain.handle(IPC.aiConnect, (_e, id: ProviderId, key: string) => guard(id, (p) => ai.connect(p, String(key ?? ''))))
  ipcMain.handle(IPC.aiSignIn, (_e, id: ProviderId) => guard(id, (p) => ai.signIn(p)))
  ipcMain.handle(IPC.aiDisconnect, (_e, id: ProviderId) => guard(id, (p) => ai.disconnect(p)))
  ipcMain.handle(IPC.aiOpenKeyPage, (_e, id: ProviderId) => guard(id, (p) => ai.openKeyPage(p)))

  ipcMain.handle(IPC.humanizeRewrite, (e, req: HumanizeRequest) =>
    humanizer.rewrite(req, (delta) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.humanizeChunk, delta)
    })
  )
  ipcMain.handle(IPC.humanizeCancel, () => humanizer.cancel())

  ipcMain.handle(IPC.codegenGenerate, (e, req: GenerateRequest) =>
    codegen.generate({ ...req, mode: isMode(req?.mode) ? req.mode : 'code' }, (delta) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.codegenChunk, delta)
    })
  )
  ipcMain.handle(IPC.codegenCancel, () => codegen.cancel())

  ipcMain.handle(IPC.projectPick, async () => {
    const win = s.getMainWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { title: 'Open project folder', properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title: 'Open project folder', properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    return openProject(res.filePaths[0])
  })
  ipcMain.handle(IPC.projectOpen, (_e, root: string) => openProject(root))
  ipcMain.handle(IPC.projectReadFile, (_e, root: string, rel: string) => project.readFile(root, rel))

  async function openProject(root: string) {
    try {
      const info = await project.scan(root)
      settings.update({ lastProjectDir: info.root })
      log.info('project', `Opened ${info.root} (${info.fileCount} entries${info.truncated ? ', truncated' : ''})`)
      return info
    } catch (e) {
      log.error('project', `Could not open ${root}: ${(e as Error).message}`)
      return null
    }
  }

  let lastListError = ''
  ipcMain.handle(IPC.windowsList, async () => {
    try {
      const list = await windows.list()
      lastListError = ''
      return list
    } catch (e) {
      const msg = (e as Error).message
      if (msg !== lastListError) log.error('windows', `Window detection failed: ${msg}`)
      lastListError = msg
      return []
    }
  })
  ipcMain.handle(IPC.windowsOpenFile, async (_e, windowId: string, root: string, rel: string) => {
    try {
      const win = await windows.resolve(windowId)
      if (!win) throw new Error('That window is no longer open.')
      await windows.openFile(win, project.resolveInside(root, rel))
      log.info('windows', `Asked ${win.appName} to open ${rel}`)
      return { ok: true }
    } catch (e) {
      log.warn('windows', (e as Error).message)
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.typingStart, async (_e, req: StartTypingRequest) => {
    try {
      if (req?.confirmed !== true) throw new Error('The target must be confirmed before typing starts.')
      if (!isMode(req.mode)) throw new Error('Unknown typing mode.')
      if (typeof req.code !== 'string' || !req.code.trim()) throw new Error('There is nothing to type yet.')
      if (req.code.length > MAX_CODE_CHARS) throw new Error('That is too much to type in one session.')
      if (!windows.backend.supported) throw new Error(`Keyboard automation isn't available on ${process.platform} yet.`)
      // Re-resolve right now: the window must still exist and belong to the same process.
      const target = await windows.resolve(req.windowId)
      if (!target) throw new Error('The selected window is no longer open. Refresh the window list and choose again.')
      if (target.blocked) throw new Error(`${target.appName} is running as administrator, so Windows won't let AutoTyper type into it. Restart AutoTyper as administrator, or open ${target.appName} normally.`)
      const cfg = settings.get()
      typing.start({ mode: req.mode, code: req.code, target, profile: req.profile, editorSafe: cfg.editorSafeMode, countdownSeconds: cfg.countdownSeconds })
      return { ok: true }
    } catch (e) {
      log.error('typing', (e as Error).message)
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle(IPC.typingPause, () => typing.pause())
  ipcMain.handle(IPC.typingResume, () => typing.resume())
  ipcMain.handle(IPC.typingStop, () => typing.stop())
  ipcMain.handle(IPC.typingSetSpeed, (_e, m: number) => typing.setSpeed(m))
  ipcMain.handle(IPC.typingGetStatus, () => typing.current)
  ipcMain.handle(IPC.typingEstimate, (_e, code: string, profile: HumanizationProfile, mode: TypingMode) =>
    typeof code === 'string' && code.length <= MAX_CODE_CHARS
      ? estimateDurationMs(code, profile, 1, { allowNavigation: true, mode: isMode(mode) ? mode : 'code' })
      : 0
  )

  ipcMain.handle(IPC.filesSave, async (_e, code: string, suggestedName: string) => {
    const win = s.getMainWindow()
    const opts = { title: 'Save', defaultPath: suggestedName }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, code, 'utf8')
    log.success('files', `Saved ${res.filePath}`)
    return res.filePath
  })

  ipcMain.handle(IPC.logHistory, () => log.history())
  ipcMain.handle(IPC.logClear, () => log.clear())
  ipcMain.on(IPC.overlayAction, (_e, action: string) => {
    if (action === 'stop') typing.stop('Stopped from overlay')
    else if (action === 'pauseResume') typing.togglePause()
  })
}
