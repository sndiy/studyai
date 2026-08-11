import { contextBridge, ipcRenderer } from 'electron'
import type { AIChunkPayload } from '../src/types'

contextBridge.exposeInMainWorld('api', {

  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close:    () => ipcRenderer.send('window-close'),

    // Window sekarang frameless, jadi titlebar custom perlu tahu state maximize
    // untuk menampilkan ikon yang benar.
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
      const handler = (_e: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on('window:maximized', handler)
      return () => ipcRenderer.removeListener('window:maximized', handler)
    },
  },

  settings: {
    getAll: ()                           => ipcRenderer.invoke('settings:getAll'),
    set:    (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  },

  recent: {
    getAll: ()               => ipcRenderer.invoke('recent:getAll'),
    remove: (path: string)   => ipcRenderer.invoke('recent:remove', path),
  },

  file: {
    open:               ()              => ipcRenderer.invoke('file:open'),
    save:               (note: any)     => ipcRenderer.invoke('file:save', note),
    openAsContext:      ()              => ipcRenderer.invoke('file:openAsContext'),
    readDirect:         (path: string)  => ipcRenderer.invoke('file:readDirect', path),
    getPendingOpenPath: ()              => ipcRenderer.invoke('file:getPendingOpenPath'),
    onOpenExternal:     (cb: (path: string) => void) => {
      const handler = (_e: unknown, path: string) => cb(path)
      ipcRenderer.on('file:openExternal', handler)
      return () => ipcRenderer.removeListener('file:openExternal', handler)
    },
  },

  app: {
    setDirty:   (dirty: boolean) => ipcRenderer.send('app:setDirty', dirty),
    forceClose: ()               => ipcRenderer.send('app:forceClose'),
    onRequestClose: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('app:requestClose', handler)
      return () => ipcRenderer.removeListener('app:requestClose', handler)
    },
  },

  ai: {
    validateKey:       (provider: string, key?: string) => ipcRenderer.invoke('ai:validateKey', provider, key),
    getVerifiedLimits: () => ipcRenderer.invoke('ai:getVerifiedLimits'),

    // [Celah 2] Cache per-key di main — dipakai Settings saat mount (tanpa
    // `force`) dan tombol Refresh (`force: true` melewati cache).
    getModels: (provider: string, opts?: { force?: boolean }) =>
      ipcRenderer.invoke('ai:getModels', provider, opts),

    // [S2] Streaming dijalankan di main process. Renderer TIDAK pernah memegang
    // API key — ia cuma mengirim pesan dan menerima potongan teks.
    stream: (req: {
      requestId: string
      model: string
      messages: { role: string; content: string }[]
      systemPrompt: string
      maxOutputTokens: number
    }) => ipcRenderer.invoke('ai:stream', req),

    cancel: (requestId: string) => ipcRenderer.send('ai:cancel', requestId),

    // [L6] Tipe callback sebelumnya kehilangan `errorKind` — tidak berbahaya
    // saat runtime (payload-nya `any`), tapi berbeda dari `AIChunkPayload`
    // yang benar-benar dikirim main (lihat electron/main.ts `emit()`).
    onChunk: (cb: (payload: AIChunkPayload) => void) => {
      const handler = (_e: unknown, payload: AIChunkPayload) => cb(payload)
      ipcRenderer.on('ai:chunk', handler)
      return () => ipcRenderer.removeListener('ai:chunk', handler)
    },
  },

  openExternal: (url: string) => ipcRenderer.send('open:external', url),
})
