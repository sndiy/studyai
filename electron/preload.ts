import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {

  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close:    () => ipcRenderer.send('window-close'),
  },

  notes: {
    getAll:  ()           => ipcRenderer.invoke('notes:getAll'),
    get:     (id: number) => ipcRenderer.invoke('notes:get', id),
    create:  (data: any)  => ipcRenderer.invoke('notes:create', data),
    save:    (note: any)  => ipcRenderer.invoke('notes:save', note),
    delete:  (id: number) => ipcRenderer.invoke('notes:delete', id),
  },

  settings: {
    getAll: ()                           => ipcRenderer.invoke('settings:getAll'),
    set:    (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  },

  chat: {
    getByNote:   (noteId: string)  => ipcRenderer.invoke('chat:getHistory', noteId ? Number(noteId) : null),
    getGlobal:   ()                => ipcRenderer.invoke('chat:getHistory', null),
    save:        (msg: any)        => ipcRenderer.invoke('chat:addMessage', msg.note_id ?? null, msg.role, msg.content),
    clearByNote: (noteId: string)  => ipcRenderer.invoke('chat:clearHistory', noteId ? Number(noteId) : null),
  },

  stats: {
    get:       () => ipcRenderer.invoke('stats:get'),
    today:     () => ipcRenderer.invoke('stats:get'),
    getRange:  () => Promise.resolve([]),
    increment: () => Promise.resolve({ ok: true }),
  },

  streak: {
    get: () => ipcRenderer.invoke('streak:get'),
  },

  file: {
    import:       ()          => ipcRenderer.invoke('file:import'),
    save:         (note: any) => ipcRenderer.invoke('file:save', note),
    saveAs:       (note: any) => ipcRenderer.invoke('file:saveAs', note),
    registerPath: (noteId: number, filePath: string) => ipcRenderer.invoke('file:registerPath', noteId, filePath),
  },

  ai: {
    validateKey: (provider: string, key: string) => ipcRenderer.invoke('ai:validateKey', provider, key),
  },

  openExternal: (url: string) => ipcRenderer.send('open:external', url),
})
