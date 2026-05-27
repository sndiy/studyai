import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // ── Window controls (match electron/main.ts: 'window-*')
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close:    () => ipcRenderer.send('window-close'),
  },

  // ── Notes
  notes: {
    getAll:  ()           => ipcRenderer.invoke('notes:getAll'),
    get:     (id: number) => ipcRenderer.invoke('notes:get', id),
    create:  (data: any)  => ipcRenderer.invoke('notes:create', data),
    save:    (note: any)  => {
      // Pastikan id selalu ada dan dalam format yang benar
      const normalized = {
        id:       note?.id ?? note?.note_id ?? null,
        title:    note?.title    ?? 'Tanpa Judul',
        content:  note?.content  ?? '',
        category: note?.category ?? 'Umum',
      }
      return ipcRenderer.invoke('notes:save', normalized)
    },
    delete:  (id: number) => ipcRenderer.invoke('notes:delete', id),
    search:  (q: string)  => ipcRenderer.invoke('notes:getAll'), // fallback — no search handler
  },

  // ── Settings
  settings: {
    getAll: ()                           => ipcRenderer.invoke('settings:getAll'),
    set:    (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  },

  // ── Chat
  // electron/main.ts exposes: chat:getHistory(noteId), chat:addMessage(noteId,role,content), chat:clearHistory(noteId)
  chat: {
    getByNote:    (noteId: string | number | null) => {
      const id = (noteId == null || noteId === '' || noteId === 'null') ? null
        : typeof noteId === 'string' ? parseInt(noteId, 10)
        : noteId
      return ipcRenderer.invoke('chat:getHistory', id)
    },
    getGlobal:    ()                => ipcRenderer.invoke('chat:getHistory', null),
    save:         (msg: any)        => {
      const noteId = (msg.note_id == null || msg.note_id === '' || msg.note_id === 'null')
        ? null
        : typeof msg.note_id === 'string' ? parseInt(msg.note_id, 10) : msg.note_id
      return ipcRenderer.invoke('chat:addMessage', noteId, msg.role, msg.content)
    },
    clearByNote:  (noteId: string | number | null) => {
      const id = (noteId == null || noteId === '' || noteId === 'null') ? null
        : typeof noteId === 'string' ? parseInt(noteId, 10)
        : noteId
      return ipcRenderer.invoke('chat:clearHistory', id)
    },
    // legacy aliases
    getHistory:   (noteId: number | null) => ipcRenderer.invoke('chat:getHistory', noteId),
    addMessage:   (noteId: number | null, role: string, content: string) => ipcRenderer.invoke('chat:addMessage', noteId, role, content),
    clearHistory: (noteId: number | null) => ipcRenderer.invoke('chat:clearHistory', noteId),
  },

  // ── Stats
  // electron/main.ts only has stats:get and streak:get
  stats: {
    get:       () => ipcRenderer.invoke('stats:get'),
    today:     () => ipcRenderer.invoke('stats:get'),
    getRange:  () => Promise.resolve([]),
    increment: () => Promise.resolve({ ok: true }), // no handler, ignore silently
  },

  // ── Streak
  streak: { get: () => ipcRenderer.invoke('streak:get') },

  // ── File
  file: {
    import:         ()           => ipcRenderer.invoke('file:import'),
    export:         (title: string, content: string) => ipcRenderer.invoke('file:export', title, content),
    exportMd:       (note: any)  => ipcRenderer.invoke('file:export', note?.title ?? '', note?.content ?? ''),
    exportTxt:      (note: any)  => ipcRenderer.invoke('file:export', note?.title ?? '', note?.content ?? ''),
    // bulk ops not implemented in this electron build
    exportJson:     () => Promise.resolve({ success: false }),
    exportMdSingle: () => Promise.resolve({ success: false }),
    exportMdFolder: () => Promise.resolve({ success: false }),
    exportTxtBulk:  () => Promise.resolve({ success: false }),
    importJson:     () => Promise.resolve(null),
    importMdFiles:  () => Promise.resolve(null),
    importTxtFiles: () => Promise.resolve(null),
  },

  // ── AI
  ai: {
    validateKey: (provider: string, key: string) => ipcRenderer.invoke('ai:validateKey', provider, key),
  },

  // ── External links
  openExternal: (url: string) => ipcRenderer.send('open:external', url),
})
