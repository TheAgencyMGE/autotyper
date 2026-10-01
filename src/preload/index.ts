import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AutoTyperApi } from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AutoTyperApi & { overlayAction(action: 'stop' | 'pauseResume'): void } = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  ai: {
    status: () => ipcRenderer.invoke(IPC.aiStatus),
    refresh: (id) => ipcRenderer.invoke(IPC.aiRefresh, id),
    connect: (id, key) => ipcRenderer.invoke(IPC.aiConnect, id, key),
    signIn: (id) => ipcRenderer.invoke(IPC.aiSignIn, id),
    disconnect: (id) => ipcRenderer.invoke(IPC.aiDisconnect, id),
    openKeyPage: (id) => ipcRenderer.invoke(IPC.aiOpenKeyPage, id)
  },
  humanizer: {
    rewrite: (req) => ipcRenderer.invoke(IPC.humanizeRewrite, req),
    cancel: () => ipcRenderer.invoke(IPC.humanizeCancel),
    onChunk: (cb) => subscribe(IPC.humanizeChunk, cb)
  },
  codegen: {
    generate: (req) => ipcRenderer.invoke(IPC.codegenGenerate, req),
    cancel: () => ipcRenderer.invoke(IPC.codegenCancel),
    onChunk: (cb) => subscribe(IPC.codegenChunk, cb)
  },
  project: {
    pick: () => ipcRenderer.invoke(IPC.projectPick),
    open: (root) => ipcRenderer.invoke(IPC.projectOpen, root),
    readFile: (root, rel) => ipcRenderer.invoke(IPC.projectReadFile, root, rel)
  },
  windows: {
    list: () => ipcRenderer.invoke(IPC.windowsList),
    openFileInEditor: (id, root, rel) => ipcRenderer.invoke(IPC.windowsOpenFile, id, root, rel)
  },
  typing: {
    start: (req) => ipcRenderer.invoke(IPC.typingStart, req),
    pause: () => ipcRenderer.invoke(IPC.typingPause),
    resume: () => ipcRenderer.invoke(IPC.typingResume),
    stop: () => ipcRenderer.invoke(IPC.typingStop),
    setSpeed: (m) => ipcRenderer.invoke(IPC.typingSetSpeed, m),
    estimate: (code, profile, mode) => ipcRenderer.invoke(IPC.typingEstimate, code, profile, mode),
    status: () => ipcRenderer.invoke(IPC.typingGetStatus),
    onStatus: (cb) => subscribe(IPC.typingStatus, cb)
  },
  files: {
    save: (code, name) => ipcRenderer.invoke(IPC.filesSave, code, name)
  },
  log: {
    history: () => ipcRenderer.invoke(IPC.logHistory),
    onEntry: (cb) => subscribe(IPC.logEntry, cb),
    clear: () => ipcRenderer.invoke(IPC.logClear)
  },
  onHotkey: (cb) => subscribe(IPC.hotkey, cb),
  overlayAction: (action) => ipcRenderer.send(IPC.overlayAction, action),
  platform: process.platform
}

contextBridge.exposeInMainWorld('autotyper', api)
