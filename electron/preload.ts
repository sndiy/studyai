import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {

  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close:    () => ipcRenderer.send('window-close'),
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
    open:          ()         => ipcRenderer.invoke('file:open'),
    save:          (note: any) => ipcRenderer.invoke('file:save', note),
    openAsContext: ()         => ipcRenderer.invoke('file:openAsContext'),
  },

  ai: {
    validateKey: (provider: string, key: string) => ipcRenderer.invoke('ai:validateKey', provider, key),
  },

  openExternal: (url: string) => ipcRenderer.send('open:external', url),
})
