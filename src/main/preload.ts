// src/main/preload.ts — FASE 2 PATCH
// Perubahan:
// [Bug #1]  stats.increment — hapus stub palsu, invoke handler nyata dengan parameter field
// [Bug #3]  chat.clearByNote — teruskan sessionId ke Main agar sesi chat bebas bisa di-clear per sesi
// [Bug #10] notes.search — panggil 'notes:search' dengan query q, bukan 'notes:getAll'
// Seluruh chat.* yang menyentuh chat bebas kini meneruskan sessionId sebagai argumen ke-2

import { contextBridge, ipcRenderer } from 'electron'

// ── Helper: normalisasi noteId ────────────────────────────────────────────────
// Null jika kosong/literal "null", angka jika string numerik, langsung jika number
function normalizeNoteId(noteId: string | number | null | undefined): number | null {
  if (noteId == null || noteId === '' || noteId === 'null') return null
  if (typeof noteId === 'number') return noteId
  const parsed = parseInt(noteId, 10)
  return isNaN(parsed) ? null : parsed
}

contextBridge.exposeInMainWorld('api', {

  // ── Window controls ──────────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close:    () => ipcRenderer.send('window-close'),
  },

  // ── Notes ────────────────────────────────────────────────────────────────────
  notes: {
    getAll: () => ipcRenderer.invoke('notes:getAll'),
    get:    (id: number) => ipcRenderer.invoke('notes:get', id),

    create: (data: any) => ipcRenderer.invoke('notes:create', data),

    save: (note: any) => {
      const normalized = {
        id:       note?.id ?? note?.note_id ?? null,
        title:    note?.title    ?? 'Tanpa Judul',
        content:  note?.content  ?? '',
        category: note?.category ?? 'Umum',
      }
      return ipcRenderer.invoke('notes:save', normalized)
    },

    delete: (id: number) => ipcRenderer.invoke('notes:delete', id),

    // [Bug #10] Panggil handler pencarian nyata dengan query q
    search: (q: string) => ipcRenderer.invoke('notes:search', q),
  },

  // ── Settings ─────────────────────────────────────────────────────────────────
  settings: {
    getAll: ()                           => ipcRenderer.invoke('settings:getAll'),
    set:    (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  },

  // ── Chat ─────────────────────────────────────────────────────────────────────
  // Kontrak Fase 1:
  //   chat:getHistory(noteId, sessionId?)
  //   chat:addMessage(noteId, role, content, sessionId?)
  //   chat:clearHistory(noteId, sessionId?)
  chat: {
    // Ambil chat milik note tertentu
    getByNote: (noteId: string | number | null) =>
      ipcRenderer.invoke('chat:getHistory', normalizeNoteId(noteId), null),

    // Ambil chat bebas milik sesi tertentu
    // [Bug #3] sessionId diteruskan ke Main — tidak lagi jatuh ke bucket global
    getBySession: (sessionId: string) =>
      ipcRenderer.invoke('chat:getHistory', null, sessionId),

    // Legacy: ambil semua chat bebas (tidak ada session_id) — untuk backward compat
    getGlobal: () => ipcRenderer.invoke('chat:getHistory', null, null),

    // Simpan pesan — teruskan sessionId jika ada
    save: (msg: any) => {
      const noteId    = normalizeNoteId(msg.note_id)
      const sessionId = (msg.session_id ?? null) as string | null
      return ipcRenderer.invoke('chat:addMessage', noteId, msg.role, msg.content, sessionId)
    },

    // [Bug #3] clearByNote — teruskan sessionId agar clear per sesi bekerja dengan benar
    // Jika noteId ada → clear berdasarkan noteId
    // Jika noteId null dan sessionId ada → clear sesi chat bebas itu saja
    clearByNote: (noteId: string | number | null, sessionId?: string | null) => {
      const id  = normalizeNoteId(noteId)
      const sid = sessionId ?? null
      return ipcRenderer.invoke('chat:clearHistory', id, sid)
    },

    // Legacy aliases — dipertahankan agar komponen lama tidak break
    getHistory:   (noteId: number | null) =>
      ipcRenderer.invoke('chat:getHistory', noteId, null),
    addMessage:   (noteId: number | null, role: string, content: string, sessionId?: string | null) =>
      ipcRenderer.invoke('chat:addMessage', noteId, role, content, sessionId ?? null),
    clearHistory: (noteId: number | null, sessionId?: string | null) =>
      ipcRenderer.invoke('chat:clearHistory', noteId, sessionId ?? null),
  },

  // ── Stats ─────────────────────────────────────────────────────────────────────
  stats: {
    get:      () => ipcRenderer.invoke('stats:get'),
    today:    () => ipcRenderer.invoke('stats:get'),
    getRange: () => Promise.resolve([]),

    // [Bug #1] Hapus stub palsu — invoke handler nyata dengan parameter field
    increment: (field: 'chat_count' | 'notes_created' = 'chat_count') =>
      ipcRenderer.invoke('stats:increment', field),
  },

  // ── Streak ────────────────────────────────────────────────────────────────────
  streak: {
    get: () => ipcRenderer.invoke('streak:get'),
  },

  // ── File ─────────────────────────────────────────────────────────────────────
  file: {
    import:    ()                              => ipcRenderer.invoke('file:import'),
    export:    (title: string, content: string) => ipcRenderer.invoke('file:export', title, content),
    exportMd:  (note: any)                     => ipcRenderer.invoke('file:export', note?.title ?? '', note?.content ?? ''),
    exportTxt: (note: any)                     => ipcRenderer.invoke('file:export', note?.title ?? '', note?.content ?? ''),
    // Bulk ops tidak diimplementasikan di build Electron ini — stub eksplisit
    exportJson:     () => Promise.resolve({ success: false }),
    exportMdSingle: () => Promise.resolve({ success: false }),
    exportMdFolder: () => Promise.resolve({ success: false }),
    exportTxtBulk:  () => Promise.resolve({ success: false }),
    importJson:     () => Promise.resolve(null),
    importMdFiles:  () => Promise.resolve(null),
    importTxtFiles: () => Promise.resolve(null),
  },

  // ── AI ───────────────────────────────────────────────────────────────────────
  ai: {
    validateKey: (provider: string, key: string) => ipcRenderer.invoke('ai:validateKey', provider, key),
  },

  // ── External links ────────────────────────────────────────────────────────────
  openExternal: (url: string) => ipcRenderer.send('open:external', url),
})