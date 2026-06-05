import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

const USER_DATA    = app.getPath('userData')
const SETTINGS_PATH = join(USER_DATA, 'settings.json')
const RECENT_PATH   = join(USER_DATA, 'recent.json')

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  gemini_api_key:  '',
  openai_api_key:  '',
  active_model:    'gemini-1.5-flash',
  persona_name:    'Mai',
  persona_prompt:  'Kamu adalah Mai, asisten belajar yang cerdas dan supportif. Berbicara bahasa Indonesia dengan hangat dan fokus pada materi.',
  persona_limit:   'Jawab maksimal 3 paragraf. Sertakan contoh kode untuk topik programming.',
  max_tokens:      '2048',
}

function loadSettings(): Record<string, string> {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
      return { ...DEFAULT_SETTINGS, ...raw }
    }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(data: Record<string, string>) {
  writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

// Recent files: [{ path, title, updatedAt }]
function loadRecent(): { path: string; title: string; updatedAt: string }[] {
  try {
    if (existsSync(RECENT_PATH)) return JSON.parse(readFileSync(RECENT_PATH, 'utf-8'))
  } catch {}
  return []
}

function saveRecent(list: { path: string; title: string; updatedAt: string }[]) {
  writeFileSync(RECENT_PATH, JSON.stringify(list, null, 2), 'utf-8')
}

function addToRecent(filePath: string, title: string) {
  let list = loadRecent().filter(r => r.path !== filePath)
  list.unshift({ path: filePath, title, updatedAt: new Date().toLocaleString('id-ID') })
  if (list.length > 20) list = list.slice(0, 20)
  saveRecent(list)
}

// ── Window ────────────────────────────────────────────────────────────────────
let win: BrowserWindow

function createWindow() {
  const iconPath = join(__dirname, '../../resources/icon.png')
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 900, minHeight: 600,
    backgroundColor: '#0b0b0f',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ── Window controls ───────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => win.minimize())
ipcMain.on('window-maximize', () => win.isMaximized() ? win.restore() : win.maximize())
ipcMain.on('window-close',    () => win.close())
ipcMain.on('open:external',   (_e, url: string) => shell.openExternal(url))

// ── Settings (JSON file, bukan DB) ────────────────────────────────────────────
ipcMain.handle('settings:getAll', () => loadSettings())

ipcMain.handle('settings:set', (_e, key: string, value: string) => {
  const s = loadSettings()
  s[key] = value
  saveSettings(s)
  return { ok: true }
})

// ── Recent files ──────────────────────────────────────────────────────────────
ipcMain.handle('recent:getAll', () => loadRecent())

ipcMain.handle('recent:remove', (_e, filePath: string) => {
  const list = loadRecent().filter(r => r.path !== filePath)
  saveRecent(list)
  return { ok: true }
})

// ── File: Buka file (open dialog) ─────────────────────────────────────────────
ipcMain.handle('file:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Buka File',
    filters: [
      { name: 'Markdown',   extensions: ['md']   },
      { name: 'JSON',       extensions: ['json']  },
      { name: 'Plain Text', extensions: ['txt']   },
    ],
    properties: ['openFile'],
  })
  if (res.canceled || !res.filePaths.length) return null

  const filePath = res.filePaths[0]
  return readFileContent(filePath)
})

function readFileContent(filePath: string): { title: string; content: string; filePath: string } | null {
  try {
    const ext  = filePath.split('.').pop()?.toLowerCase()
    const name = filePath.split(/[\\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Tanpa Judul'
    let text   = readFileSync(filePath, 'utf-8').trim()

    if (ext === 'json') {
      try {
        const parsed = JSON.parse(text)
        if (parsed?.note?.content != null) {
          return { title: parsed.note.title ?? name, content: parsed.note.content, filePath }
        }
        text = JSON.stringify(parsed, null, 2)
      } catch {}
    }

    return { title: name, content: text, filePath }
  } catch {
    return null
  }
}

// ── File: Simpan (Ctrl+S) ─────────────────────────────────────────────────────
// Kalau filePath sudah ada → overwrite langsung
// Kalau belum → buka dialog Save As
ipcMain.handle('file:save', async (_e, note: {
  title: string; content: string; filePath?: string | null
}) => {
  let targetPath = note.filePath

  if (!targetPath) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Simpan File',
      defaultPath: (note.title || 'Tanpa Judul') + '.md',
      filters: [
        { name: 'Markdown (.md)',    extensions: ['md']   },
        { name: 'JSON (.json)',      extensions: ['json']  },
        { name: 'Plain Text (.txt)', extensions: ['txt']  },
      ],
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    targetPath = res.filePath
  }

  try {
    const ext = targetPath.split('.').pop()?.toLowerCase()
    if (ext === 'json') {
      const payload = {
        version: '2.0',
        saved_at: new Date().toLocaleString('id-ID'),
        note: { title: note.title, content: note.content },
      }
      writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf-8')
    } else {
      writeFileSync(targetPath, note.content, 'utf-8')
    }
    addToRecent(targetPath, note.title)
    return { ok: true, filePath: targetPath }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
})

// ── File: Buka file sebagai konteks chat ──────────────────────────────────────
ipcMain.handle('file:openAsContext', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Pilih file sebagai konteks',
    filters: [
      { name: 'Markdown',   extensions: ['md']   },
      { name: 'JSON',       extensions: ['json']  },
      { name: 'Plain Text', extensions: ['txt']   },
    ],
    properties: ['openFile'],
  })
  if (res.canceled || !res.filePaths.length) return null
  return readFileContent(res.filePaths[0])
})

// ── AI: Validate API key ──────────────────────────────────────────────────────
ipcMain.handle('ai:validateKey', async (_e, provider: string, key: string) => {
  if (!key) return { valid: false, error: 'API key kosong' }
  try {
    if (provider === 'gemini') {
      const controller = new AbortController()
      const timeout    = setTimeout(() => controller.abort(), 8000)
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
          { signal: controller.signal }
        )
        clearTimeout(timeout)
        if (!r.ok) return { valid: false, error: 'API key tidak valid' }
        const data   = await r.json() as any
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
