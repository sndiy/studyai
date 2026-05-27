import { app, ipcMain } from 'electron'
import path from 'path'
import { randomUUID } from 'crypto'

let db: any = null

export function setupDatabase() {
  try {
    const Database = require('better-sqlite3')
    const dbPath = path.join(app.getPath('userData'), 'studyai.db')
    db = new Database(dbPath)

    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Rangkuman Baru',
        content TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Umum',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        word_count INTEGER DEFAULT 0,
        source_file TEXT
      );
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#7c6af7',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_history (
        id TEXT PRIMARY KEY,
        note_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        provider TEXT DEFAULT 'gemini',
        model TEXT DEFAULT 'gemini-2.5-flash'
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stats (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        chat_count INTEGER DEFAULT 0,
        study_minutes INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `)

    const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }
    if (catCount.c === 0) {
      const insertCat = db.prepare('INSERT OR IGNORE INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
      const cats = [
        ['1', 'Android', '#48c896'],
        ['2', 'RPL', '#7c6af7'],
        ['3', 'Jarkom', '#f0be3c'],
        ['4', 'Matdis', '#e05555'],
        ['5', 'Umum', '#6a6a8a']
      ]
      cats.forEach((c: string[]) => insertCat.run(c[0], c[1], c[2], c[3], Date.now()))
    }

    const defaultSettings = [
      ['active_provider', 'gemini'],
      ['active_model', 'gemini-2.5-flash'],
      ['gemini_api_key', ''],
      ['claude_api_key', ''],
      ['openai_api_key', ''],
      ['grok_api_key', ''],
      ['persona_name', 'Mai'],
      ['persona_prompt', 'Kamu adalah Mai, asisten belajar yang cerdas dan supportif. Kamu berbicara dengan hangat tapi tetap fokus pada materi. Kalau pengguna malas, ingatkan dengan tegas tapi tidak judging. Gunakan bahasa Indonesia casual.'],
      ['persona_limit', 'Jawab maksimal 3 paragraf. Sertakan contoh kode untuk topik programming. Gunakan format bullet point untuk list konsep.'],
      ['daily_quota', '1000'],
      ['streak', '0'],
      ['best_streak', '0'],
      ['last_active_date', ''],
      ['max_tokens', '2048'],
      ['web_search_enabled', 'false'],
    ]
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    defaultSettings.forEach(([k, v]) => insertSetting.run(k, v))

    console.log('✅ Database initialized at', dbPath)
  } catch (err) {
    console.error('❌ Database init failed:', err)
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  ipcMain.handle('db:notes:getAll', () => {
    const rows = db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all()
    return rows.map((r: any) => ({
      ...r,
      created_at: formatTs(r.created_at),
      updated_at: formatTs(r.updated_at),
    }))
  })

  ipcMain.handle('db:notes:get', (_: any, id: string) => {
    const r = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
    if (!r) return null
    return { ...r, created_at: formatTs(r.created_at), updated_at: formatTs(r.updated_at) }
  })

  // Unified create handler
  ipcMain.handle('db:notes:create', (_: any, data: { title?: string; category?: string }) => {
    const id = randomUUID()
    const now = Date.now()
    const title = data?.title || 'Rangkuman Baru'
    const category = data?.category || 'Umum'
    db.prepare('INSERT INTO notes (id,title,content,category,created_at,updated_at,word_count) VALUES (?,?,?,?,?,?,?)')
      .run(id, title, '', category, now, now, 0)
    const r = db.prepare('SELECT * FROM notes WHERE id = ?').get(id)
    return { ...r, created_at: formatTs(r.created_at), updated_at: formatTs(r.updated_at) }
  })

  // Unified save handler — accepts note object
  ipcMain.handle('db:notes:save', (_: any, note: any) => {
    try {
      if (!note || !note.id) return { success: false, error: 'ID catatan tidak valid' }
      const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(note.id)
      const wc = note.content ? note.content.split(/\s+/).filter(Boolean).length : 0
      if (existing) {
        db.prepare('UPDATE notes SET title=?,content=?,category=?,updated_at=?,word_count=?,source_file=? WHERE id=?')
          .run(note.title ?? 'Tanpa Judul', note.content ?? '', note.category ?? 'Umum', Date.now(), wc, note.source_file || null, note.id)
      } else {
        const now = Date.now()
        db.prepare('INSERT INTO notes (id,title,content,category,created_at,updated_at,word_count,source_file) VALUES (?,?,?,?,?,?,?,?)')
          .run(note.id, note.title ?? 'Tanpa Judul', note.content ?? '', note.category ?? 'Umum', now, now, wc, note.source_file || null)
      }
      return { success: true }
    } catch (e) {
      console.error('db:notes:save error:', e)
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('db:notes:delete', (_: any, id: string) => {
    db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    db.prepare('DELETE FROM chat_history WHERE note_id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('db:notes:search', (_: any, query: string) => {
    const rows = db.prepare("SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC")
      .all(`%${query}%`, `%${query}%`)
    return rows.map((r: any) => ({
      ...r,
      created_at: formatTs(r.created_at),
      updated_at: formatTs(r.updated_at),
    }))
  })

  // ── Categories ───────────────────────────────────────────────────────────
  ipcMain.handle('db:categories:getAll', () => {
    return db.prepare('SELECT * FROM categories ORDER BY name ASC').all()
  })
  ipcMain.handle('db:categories:save', (_: any, cat: any) => {
    db.prepare('INSERT OR REPLACE INTO categories (id,name,color,created_at) VALUES (?,?,?,?)')
      .run(cat.id, cat.name, cat.color, Date.now())
    return { success: true }
  })
  ipcMain.handle('db:categories:delete', (_: any, id: string) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
    return { success: true }
  })

  // ── Chat ─────────────────────────────────────────────────────────────────
  ipcMain.handle('db:chat:getByNote', (_: any, noteId: string) => {
    try {
      if (!noteId || noteId === 'null' || noteId === '') {
        return db.prepare('SELECT * FROM chat_history WHERE note_id IS NULL ORDER BY created_at ASC LIMIT 100').all()
      }
      return db.prepare('SELECT * FROM chat_history WHERE note_id = ? ORDER BY created_at ASC').all(noteId)
    } catch (e) {
      console.error('db:chat:getByNote error:', e)
      return []
    }
  })
  ipcMain.handle('db:chat:getGlobal', () => {
    return db.prepare('SELECT * FROM chat_history WHERE note_id IS NULL ORDER BY created_at ASC LIMIT 100').all()
  })
  ipcMain.handle('db:chat:save', (_: any, msg: any) => {
    try {
      if (!msg || !msg.id || !msg.role || !msg.content) return { success: false, error: 'Data pesan tidak lengkap' }
      const noteId = (msg.note_id === 'null' || msg.note_id === '' || msg.note_id == null) ? null : msg.note_id
      db.prepare('INSERT OR REPLACE INTO chat_history (id,note_id,role,content,created_at,provider,model) VALUES (?,?,?,?,?,?,?)')
        .run(msg.id, noteId, msg.role, msg.content, Date.now(), msg.provider || 'gemini', msg.model || 'gemini-2.5-flash')
      return { success: true }
    } catch (e) {
      console.error('db:chat:save error:', e)
      return { success: false, error: String(e) }
    }
  })
  ipcMain.handle('db:chat:clearByNote', (_: any, noteId: string) => {
    try {
      if (!noteId || noteId === 'null' || noteId === '') {
        db.prepare('DELETE FROM chat_history WHERE note_id IS NULL').run()
      } else {
        db.prepare('DELETE FROM chat_history WHERE note_id = ?').run(noteId)
      }
      return { success: true }
    } catch (e) {
      console.error('db:chat:clearByNote error:', e)
      return { success: false, error: String(e) }
    }
  })

  // ── Settings ─────────────────────────────────────────────────────────────
  ipcMain.handle('db:settings:getAll', () => {
    const rows = db.prepare('SELECT * FROM settings').all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]))
  })
  ipcMain.handle('db:settings:set', (_: any, key: string, value: string) => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
    return { success: true }
  })

  // ── Stats ─────────────────────────────────────────────────────────────────
  ipcMain.handle('db:stats:today', () => {
    const today = new Date().toISOString().split('T')[0]
    return db.prepare('SELECT * FROM stats WHERE date = ?').get(today)
  })
  ipcMain.handle('db:stats:increment', (_: any, field: 'chat_count' | 'study_minutes') => {
    const today = new Date().toISOString().split('T')[0]
    const existing = db.prepare('SELECT id FROM stats WHERE date = ?').get(today)
    if (existing) {
      db.prepare(`UPDATE stats SET ${field} = ${field} + 1 WHERE date = ?`).run(today)
    } else {
      const id = `stat_${Date.now()}`
      const data: Record<string, number> = { chat_count: 0, study_minutes: 0 }
      data[field] = 1
      db.prepare('INSERT INTO stats (id,date,chat_count,study_minutes,created_at) VALUES (?,?,?,?,?)')
        .run(id, today, data.chat_count, data.study_minutes, Date.now())
    }
    return { success: true }
  })
  ipcMain.handle('db:stats:getRange', (_: any, days: number) => {
    return db.prepare('SELECT * FROM stats ORDER BY date DESC LIMIT ?').all(days)
  })
}

function formatTs(ts: number | string): string {
  if (!ts) return ''
  const n = typeof ts === 'string' ? parseInt(ts) : ts
  if (isNaN(n)) return String(ts)
  const d = new Date(n)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
