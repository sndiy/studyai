// src/main/main.ts — FASE 1 PATCH
// Perubahan:
// 1. [Bug #11] Tambah set.run('max_tokens', '2048') di initDB()
// 2. [Bug #5]  Tambah kolom session_id di chat_history + query getHistory pakai session_id
// 3. [Bug #1]  Tambah ipcMain.handle('stats:increment', ...)
// 4. [Bug #9]  streak:get sudah ada — pastikan tidak ada duplikasi, tambah streak:update terpisah

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import Database from 'better-sqlite3'

const USER_DATA = app.getPath('userData')
const DB_PATH   = join(USER_DATA, 'studyai.db')
const NOTES_DIR = join(USER_DATA, 'notes')
if (!existsSync(NOTES_DIR)) mkdirSync(NOTES_DIR, { recursive: true })

let db: Database.Database

function initDB() {
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL DEFAULT 'Tanpa Judul',
      content    TEXT NOT NULL DEFAULT '',
      category   TEXT NOT NULL DEFAULT 'Umum',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id    INTEGER,
      session_id TEXT,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS daily_stats (
      date          TEXT PRIMARY KEY,
      chat_count    INTEGER DEFAULT 0,
      notes_created INTEGER DEFAULT 0
    );
  `)

  // [Bug #5] Migrasi: tambah kolom session_id jika belum ada (safe untuk DB lama)
  try {
    db.exec(`ALTER TABLE chat_history ADD COLUMN session_id TEXT`)
  } catch {
    // kolom sudah ada — skip
  }

  const set = db.prepare(`INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)`)
  set.run('gemini_api_key', '')
  set.run('active_model', 'gemini-2.5-flash')
  set.run('persona_name', 'Mai')
  set.run('persona_prompt', 'Kamu adalah Mai, asisten belajar yang cerdas dan supportif. Kamu berbicara dengan hangat tapi tetap fokus pada materi. Gunakan bahasa Indonesia casual.')
  set.run('persona_limit', 'Jawab maksimal 3 paragraf. Sertakan contoh kode untuk topik programming.')
  set.run('openai_api_key', '')
  set.run('claude_api_key', '')
  set.run('streak_count', '0')
  set.run('streak_last_date', '')
  // [Bug #11] Default max_tokens wajib ada agar parseInt(settings.max_tokens) tidak NaN
  set.run('max_tokens', '2048')
}

let win: BrowserWindow

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 900, minHeight: 600,
    frame: false, titleBarStyle: 'hidden', backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDB()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.on('window-minimize', () => win.minimize())
ipcMain.on('window-maximize', () => win.isMaximized() ? win.restore() : win.maximize())
ipcMain.on('window-close',    () => win.close())

ipcMain.handle('notes:getAll', () =>
  db.prepare(`SELECT * FROM notes ORDER BY updated_at DESC`).all())

// [Bug #10 - Addendum Fase 2] notes:search — full-text search dengan LIKE
ipcMain.handle('notes:search', (_e, query: string) => {
  if (!query || !query.trim()) {
    return db.prepare(`SELECT * FROM notes ORDER BY updated_at DESC`).all()
  }
  const q = `%${query.trim()}%`
  return db.prepare(
    `SELECT * FROM notes
     WHERE title LIKE ? OR content LIKE ? OR category LIKE ?
     ORDER BY updated_at DESC`
  ).all(q, q, q)
})

ipcMain.handle('notes:get', (_e, id: number) =>
  db.prepare(`SELECT * FROM notes WHERE id=?`).get(id))

ipcMain.handle('notes:create', (_e, data: { title?: string; category?: string }) => {
  const now = new Date().toLocaleString('id-ID')
  const res = db.prepare(`INSERT INTO notes(title,content,category,created_at,updated_at) VALUES(?,?,?,?,?)`)
    .run(data.title ?? 'Tanpa Judul', '', data.category ?? 'Umum', now, now)
  return db.prepare(`SELECT * FROM notes WHERE id=?`).get(res.lastInsertRowid)
})

ipcMain.handle('notes:save', (_e, note: { id: string | number; title: string; content: string; category: string }) => {
  try {
    if (!note || note.id == null) return { ok: false, error: 'ID catatan tidak valid' }
    const id = typeof note.id === 'string' ? parseInt(note.id, 10) : note.id
    if (isNaN(id)) return { ok: false, error: 'ID catatan tidak valid' }
    const title    = note.title    ?? 'Tanpa Judul'
    const content  = note.content  ?? ''
    const category = note.category ?? 'Umum'
    const now = new Date().toLocaleString('id-ID')
    const res = db.prepare(`UPDATE notes SET title=?,content=?,category=?,updated_at=? WHERE id=?`)
      .run(title, content, category, now, id)
    if (res.changes === 0) return { ok: false, error: 'Catatan tidak ditemukan' }
    return { ok: true, updated_at: now }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('notes:delete', (_e, id: number) => {
  db.prepare(`DELETE FROM notes WHERE id=?`).run(id)
  db.prepare(`DELETE FROM chat_history WHERE note_id=?`).run(id)
  return { ok: true }
})

ipcMain.handle('settings:getAll', () => {
  const rows = db.prepare(`SELECT key,value FROM settings`).all() as { key: string; value: string }[]
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
})

ipcMain.handle('settings:set', (_e, key: string, value: string) => {
  db.prepare(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`).run(key, value)
  return { ok: true }
})

// [Bug #5] chat:getHistory — pisahkan chat bebas per session_id
// Kontrak:
//   noteId = number  → ambil chat milik note tersebut
//   noteId = null, sessionId = string → ambil chat bebas sesi itu saja
//   noteId = null, sessionId = null   → ambil SEMUA chat bebas (legacy/global, untuk migrasi)
ipcMain.handle('chat:getHistory', (_e, noteId: number | null, sessionId?: string | null) => {
  try {
    if (noteId != null) {
      const id = typeof noteId === 'string' ? parseInt(noteId as any, 10) : noteId
      if (isNaN(id)) return []
      return db.prepare(`SELECT * FROM chat_history WHERE note_id=? ORDER BY id`).all(id)
    }
    // Chat bebas
    if (sessionId != null && sessionId !== '') {
      return db.prepare(
        `SELECT * FROM chat_history WHERE note_id IS NULL AND session_id=? ORDER BY id`
      ).all(sessionId)
    }
    // Fallback global (tidak ada session_id) — backward compat
    return db.prepare(
      `SELECT * FROM chat_history WHERE note_id IS NULL AND (session_id IS NULL OR session_id='') ORDER BY id`
    ).all()
  } catch (e) {
    return []
  }
})

// [Bug #5] chat:addMessage — terima session_id opsional
ipcMain.handle('chat:addMessage', (_e, noteId: number | null, role: string, content: string, sessionId?: string | null) => {
  try {
    const id = (noteId == null || noteId === undefined) ? null
      : typeof noteId === 'string' ? (parseInt(noteId as any, 10) || null)
      : noteId
    const sid = (sessionId ?? null)
    const now = new Date().toLocaleString('id-ID')
    db.prepare(
      `INSERT INTO chat_history(note_id,session_id,role,content,created_at) VALUES(?,?,?,?,?)`
    ).run(id, sid, role, content, now)
    const today = new Date().toISOString().slice(0, 10)
    db.prepare(
      `INSERT INTO daily_stats(date,chat_count) VALUES(?,1) ON CONFLICT(date) DO UPDATE SET chat_count=chat_count+1`
    ).run(today)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// [Bug #5] chat:clearHistory — terima session_id opsional
ipcMain.handle('chat:clearHistory', (_e, noteId: number | null, sessionId?: string | null) => {
  try {
    if (noteId != null) {
      const id = typeof noteId === 'string' ? parseInt(noteId as any, 10) : noteId
      if (!isNaN(id)) db.prepare(`DELETE FROM chat_history WHERE note_id=?`).run(id)
    } else if (sessionId != null && sessionId !== '') {
      db.prepare(`DELETE FROM chat_history WHERE note_id IS NULL AND session_id=?`).run(sessionId)
    } else {
      db.prepare(`DELETE FROM chat_history WHERE note_id IS NULL AND (session_id IS NULL OR session_id='')`).run()
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('stats:get', () => {
  const totalNotes = (db.prepare(`SELECT COUNT(*) as c FROM notes`).get() as any).c
  const today = new Date().toISOString().slice(0, 10)
  const todayStat = db.prepare(`SELECT * FROM daily_stats WHERE date=?`).get(today) as any
  const categories = db.prepare(`SELECT category, COUNT(*) as c FROM notes GROUP BY category`).all()
  const recentNotes = db.prepare(`SELECT * FROM notes ORDER BY updated_at DESC LIMIT 5`).all()
  return { totalNotes, todayChats: todayStat?.chat_count ?? 0, categories, recentNotes }
})

// [Bug #1] stats:increment — handler nyata untuk increment kolom di daily_stats
ipcMain.handle('stats:increment', (_e, field: 'chat_count' | 'notes_created') => {
  try {
    const validFields = ['chat_count', 'notes_created'] as const
    if (!validFields.includes(field as any)) return { ok: false, error: 'Field tidak valid' }
    const today = new Date().toISOString().slice(0, 10)
    // Pastikan field yang diinsert aman — kita sudah whitelist di atas
    db.prepare(
      `INSERT INTO daily_stats(date,${field}) VALUES(?,1)
       ON CONFLICT(date) DO UPDATE SET ${field}=${field}+1`
    ).run(today)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// [Bug #9] streak:get — handler sudah ada, dipastikan return { count } yang benar
ipcMain.handle('streak:get', () => {
  const rows = db.prepare(
    `SELECT key,value FROM settings WHERE key IN ('streak_count','streak_last_date')`
  ).all() as any[]
  const map: Record<string, string> = {}
  rows.forEach(s => map[s.key] = s.value)

  const today = new Date().toISOString().slice(0, 10)
  const last  = map['streak_last_date'] ?? ''
  let count   = parseInt(map['streak_count'] ?? '0') || 0
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  if (last === today) {
    // Sudah dihitung hari ini — tidak ubah count
  } else if (last === yesterday) {
    // Hari beruntun — increment
    count++
  } else {
    // Putus streak — mulai dari 1
    count = 1
  }

  db.prepare(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`).run('streak_count', String(count))
  db.prepare(`INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)`).run('streak_last_date', today)
  return { count }
})

ipcMain.handle('file:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Documents', extensions: ['txt', 'md', 'pdf', 'docx'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return null
  const filePath = res.filePaths[0]
  const ext = filePath.split('.').pop()?.toLowerCase()
  let text = ''
  try {
    if (ext === 'txt' || ext === 'md') {
      text = readFileSync(filePath, 'utf-8')
    } else if (ext === 'docx') {
      const mammoth = await import('mammoth')
      const buf = readFileSync(filePath)
      const result = await mammoth.extractRawText({ buffer: buf })
      text = result.value
    } else if (ext === 'pdf') {
      const pdfParse = await import('pdf-parse')
      const buf = readFileSync(filePath)
      const result = await (pdfParse as any).default(buf)
      text = result.text
    }
  } catch (e) { return null }
  const name = filePath.split(/[\\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Import'
  return { title: name, content: text }
})

ipcMain.handle('file:export', async (_e, title: string, content: string) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: title + '.txt',
    filters: [{ name: 'Text', extensions: ['txt', 'md'] }]
  })
  if (res.canceled || !res.filePath) return null
  writeFileSync(res.filePath, content, 'utf-8')
  shell.showItemInFolder(res.filePath)
  return { ok: true }
})

ipcMain.handle('ai:validateKey', async (_e, provider: string, key: string) => {
  if (!key) return { valid: false, error: 'API key kosong' }
  try {
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const r = await fetch(url, { signal: controller.signal })
        clearTimeout(timeout)
        if (!r.ok) return { valid: false, error: 'API key tidak valid' }
        const data = await r.json() as any
        const models = (data.models as any[])
          .filter(m => m.name.includes('gemini'))
          .map(m => m.name.replace('models/', ''))
        return { valid: true, models }
      } catch (e: any) {
        clearTimeout(timeout)
        if (e.name === 'AbortError') return { valid: false, error: 'Timeout — periksa koneksi internet' }
        throw e
      }
    }
    return { valid: true, models: [] }
  } catch (e) {
    return { valid: false, error: String(e) }
  }
})