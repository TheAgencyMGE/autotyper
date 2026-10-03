import { app, BrowserWindow, globalShortcut, Menu, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { createAutomationBackend, WindowService } from './automation/WindowService'
import { electronClipboard } from './clipboard'
import { AiConnections } from './ai/AiConnections'
import { CodegenService } from './codegen/CodegenService'
import { HumanizerService } from './humanizer/HumanizerService'
import { registerHotkeys } from './hotkeys'
import { registerIpc } from './ipc'
import { Logger } from './logging/Logger'
import { Overlay } from './overlay'
import { ProjectService } from './project/ProjectService'
import { ScreenShareGuard } from './screenShare'
import { SettingsStore } from './settings/SettingsStore'
import { TypingController } from './typing/TypingController'

const customUserData = process.env.AUTOTYPER_USER_DATA ?? process.env.AUTOCODER_USER_DATA
if (customUserData) app.setPath('userData', customUserData)
else migrateFromAutoCoder()

/** AutoTyper used to be called AutoCoder: carry settings (and the encrypted key) over once. */
function migrateFromAutoCoder(): void {
  try {
    const next = app.getPath('userData')
    const old = join(app.getPath('appData'), 'autocoder', 'settings.json')
    if (existsSync(old) && !existsSync(join(next, 'settings.json'))) {
      mkdirSync(next, { recursive: true })
      copyFileSync(old, join(next, 'settings.json'))
    }
  } catch {
    /* nothing to migrate */
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  const userData = app.getPath('userData')
  const log = new Logger(join(userData, 'logs'))
  const settings = new SettingsStore(userData)
  const project = new ProjectService()
  const backend = createAutomationBackend(join(userData, 'automation'), (level, msg) => log.log(level, 'automation', msg))
  const windows = new WindowService(backend)
  const typing = new TypingController(backend, log, electronClipboard)
  const ai = new AiConnections(settings, log)
  const codegen = new CodegenService(settings, ai, project, log)
  const humanizer = new HumanizerService(ai, log)
  let screenShare: ScreenShareGuard | null = null
  const overlay = new Overlay((win) => screenShare?.track(win))

  const broadcast = (channel: string, payload: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }

  const applyScreenShare = () => {
    screenShare?.setHidden(settings.get().hideFromScreenShare)
  }

  let registeredHotkeys = ''
  const applyHotkeys = () => {
    const { hotkeys } = settings.get()
    // Settings saves happen often (e.g. humanization tweaks); only re-register when hotkeys change.
    const key = `${hotkeys.stop}|${hotkeys.pauseResume}`
    if (key === registeredHotkeys) return
    registeredHotkeys = key
    const problems = registerHotkeys(hotkeys, {
      stop: () => {
        if (typing.isActive) typing.stop(`Emergency stop (${hotkeys.stop})`)
        broadcast(IPC.hotkey, { action: 'stop' })
      },
      pauseResume: () => {
        typing.togglePause()
        broadcast(IPC.hotkey, { action: 'pauseResume' })
      }
    })
    problems.forEach((p) => log.warn('hotkeys', p))
    if (!problems.length) log.info('hotkeys', `Emergency stop: ${hotkeys.stop} · Pause/Resume: ${hotkeys.pauseResume}`)
  }

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 1480,
      height: 920,
      minWidth: 1180,
      minHeight: 720,
      show: false,
      title: 'AutoTyper',
      backgroundColor: '#f6f3ec',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#f6f3ec', symbolColor: '#23211d', height: 64 },
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    screenShare?.track(mainWindow)
    mainWindow.once('ready-to-show', () => mainWindow?.show())
    mainWindow.on('closed', () => {
      mainWindow = null
    })
    // Never navigate the app window; open external links in the browser instead.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

    if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  typing.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.typingStatus, status)
    overlay.update(status)
  })
  log.on('entry', (entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.logEntry, entry)
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    registerIpc({
      settings,
      codegen,
      ai,
      humanizer,
      project,
      windows,
      typing,
      log,
      getMainWindow: () => mainWindow,
      onSettingsChanged: () => {
        applyHotkeys()
        applyScreenShare()
      }
    })
    screenShare = new ScreenShareGuard()
    createWindow()
    applyHotkeys()
    applyScreenShare()
    log.info('app', `AutoTyper ${app.getVersion()} ready · automation: ${backend.name}`)
    void ai.refresh()
    try {
      await backend.init()
      log.success('automation', 'Keyboard automation ready')
    } catch (e) {
      log.error('automation', `Keyboard automation unavailable: ${(e as Error).message}`)
    }
  })

  app.on('will-quit', () => {
    typing.stop('Application closing')
    globalShortcut.unregisterAll()
    backend.dispose()
    overlay.destroy()
    screenShare?.dispose()
  })

  app.on('window-all-closed', () => app.quit())
}
