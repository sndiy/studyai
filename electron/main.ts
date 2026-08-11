import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } from 'electron'
import { join, basename, resolve, normalize, isAbsolute } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { stat as statAsync, readFile as readFileAsync } from 'fs/promises'
import { createHash } from 'crypto'
import { streamAI, providerOf, listGeminiModels, listOpenAIModels, type ErrorKind } from './aiProvider'
import { extensionOf } from '../src/lib/filePath'
import { sortModelsForDisplay } from '../src/lib/providers'
import { atomicWriteSync } from './fsAtomic'
import { initSettings, loadSettings, saveSettings, publicSettings, type WriteResult } from './settingsStore'

// ── Perf instrumentation (STUDYAI_PERF=1) ────────────────────────────────────
// process.getCreationTime() adalah waktu spawn process OS sebenarnya (khusus
// Electron), jadi ini mengukur dari spawn — bukan dari mulai eval JS module ini.
const SPAWN = process.getCreationTime?.() ?? Date.now()
const PERF  = !!process.env['STUDYAI_PERF']
export const mark = (label: string): void => {
  if (PERF) console.log(`[perf] ${label} ${Math.round(Date.now() - SPAWN)}`)
}
mark('main-eval')

const USER_DATA    = app.getPath('userData')
const RECENT_PATH  = join(USER_DATA, 'recent.json')

// Settings (baca/tulis/enkripsi/migrasi) dipindah ke ./settingsStore — satu
// pembacaan+dekripsi di-cache di memori alih-alih dibaca ulang dari disk di
// setiap pemanggilan (dulu 4x sebelum window pernah tampil).

// Recent files: [{ path, title, updatedAt }]
async function loadRecent(): Promise<{ path: string; title: string; updatedAt: string }[]> {
  try {
    if (existsSync(RECENT_PATH)) return JSON.parse(await readFileAsync(RECENT_PATH, 'utf-8'))
  } catch (e) {
    console.error('[StudyAI] Failed to load recent files:', e)
  }
  return []
}

function saveRecent(list: { path: string; title: string; updatedAt: string }[]): WriteResult {
  try {
    atomicWriteSync(RECENT_PATH, JSON.stringify(list, null, 2))
    return { ok: true }
  } catch (e: any) {
    console.error('[StudyAI] Failed to save recent files:', e?.message ?? e)
    return { ok: false, error: e?.message ?? String(e) }
  }
}

// [B17-fix] Sebelumnya hasil saveRecent() dibuang begitu saja di sini — kalau
// recent.json gagal ditulis, kegagalannya lenyap tanpa log maupun pesan,
// berbeda dari kebijakan [B8] yang dipegang konsisten di jalur tulis lain.
async function addToRecent(filePath: string, title: string): Promise<WriteResult> {
  let list = (await loadRecent()).filter(r => r.path !== filePath)
  list.unshift({ path: filePath, title, updatedAt: new Date().toISOString() })
  if (list.length > 20) list = list.slice(0, 20)
  return saveRecent(list)
}

// ── Validasi path & ukuran file ───────────────────────────────────────────────
// [S4] security.md mewajibkan path yang masuk lewat IPC divalidasi sebelum
// dipakai untuk operasi filesystem. [B13] Baca file sinkron tanpa batas ukuran
// membekukan main process, jadi ukurannya dibatasi juga.
const ALLOWED_EXT     = new Set(['md', 'markdown', 'txt', 'json'])
const MAX_FILE_BYTES  = 16 * 1024 * 1024   // 16 MB

type PathCheck = { ok: true; path: string } | { ok: false; error: string }

function checkFilePath(input: unknown): PathCheck {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'Path file tidak valid' }
  }
  if (input.includes('\0')) {
    return { ok: false, error: 'Path file tidak valid' }
  }
  const resolved = resolve(normalize(input))
  if (!isAbsolute(resolved)) {
    return { ok: false, error: 'Path file harus absolut' }
  }
  const ext = extensionOf(resolved)
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, error: `Tipe file ".${ext || '?'}" tidak didukung. Hanya .md, .txt, dan .json.` }
  }
  return { ok: true, path: resolved }
}

// ── Front-matter judul ────────────────────────────────────────────────────────
// [B9] Judul dokumen dulu tidak pernah ikut tersimpan untuk .md/.txt, jadi hilang
// (kembali ke nama file) setiap kali file dibuka ulang. Sekarang judul ditulis
// sebagai YAML front-matter — tapi HANYA kalau judulnya beda dari nama file,
// supaya file yang judulnya sudah sama dengan nama file tetap bersih.
//
// Batasan yang disengaja: kalau sebuah file punya front-matter dengan key SELAIN
// `title`, blok itu tidak disentuh sama sekali (dibiarkan jadi bagian isi) agar
// kita tidak pernah menghapus metadata milik tool lain.
// Trailing `(?:[ \t]*\r?\n)?` ikut menelan satu baris kosong sesudah penutup `---`,
// kalau tidak, baris kosong itu bocor jadi baris pertama isi dokumen setiap kali dibuka.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)?/
const MANAGED_FM_KEYS = new Set(['title'])

function unquoteYaml(v: string): string {
  const t = v.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return t
}

function quoteYaml(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function parseFrontmatter(text: string): { title: string | null; body: string } {
  const m = text.match(FRONTMATTER_RE)
  if (!m) return { title: null, body: text }

  const lines = m[1].split(/\r?\n/).filter(l => l.trim() !== '')
  const entries: [string, string][] = []
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i < 0) return { title: null, body: text }                 // bukan key: value → jangan diutak-atik
    const key = line.slice(0, i).trim().toLowerCase()
    if (!MANAGED_FM_KEYS.has(key)) return { title: null, body: text } // ada key asing → biarkan utuh
    entries.push([key, line.slice(i + 1)])
  }

  const raw = entries.find(e => e[0] === 'title')?.[1]
  if (raw === undefined) return { title: null, body: text }
  const title = unquoteYaml(raw)
  return { title: title || null, body: text.slice(m[0].length) }
}

function withFrontmatter(title: string, content: string, targetPath: string): string {
  const base = basename(targetPath).replace(/\.[^.]+$/, '')
  if (!title || title === base) return content
  return `---\ntitle: ${quoteYaml(title)}\n---\n\n${content}`
}

// ── Open-with-OS: cari path file dari argv (cold start & second-instance) ─────
const OPENABLE_EXT = /\.(md)$/i

function getFilePathFromArgv(argv: string[]): string | null {
  const args = process.defaultApp ? argv.slice(2) : argv.slice(1)
  return args.find(a => !a.startsWith('-') && OPENABLE_EXT.test(a)) ?? null
}

let pendingOpenFilePath: string | null = getFilePathFromArgv(process.argv)

// [S5] shell.openExternal dulu menerima string apa pun. Skema selain http/https
// (file:, dan protokol custom yang terdaftar di OS) bisa memicu eksekusi.
function openExternalSafely(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url)
      return
    }
    console.warn('[StudyAI] Menolak membuka URL dengan protokol tidak diizinkan:', parsed.protocol)
  } catch {
    console.warn('[StudyAI] Menolak membuka URL yang tidak valid')
  }
}

// ── Window ────────────────────────────────────────────────────────────────────
let win: BrowserWindow | null = null

// [B2] Dokumen dengan perubahan belum disimpan tidak boleh hilang saat app ditutup.
// Renderer menyinkronkan status dirty ke sini; `close` di-cancel dan renderer
// diminta menampilkan dialog Simpan / Buang / Batal.
let isDocDirty  = false
let forceClose  = false

/** Harus sama dengan --surface-app di src/styles/tokens.css. */
const WINDOW_BG = { dark: '#08080e', light: '#eceef6' } as const

function createWindow() {
  // icon_256.png (58 KB) cukup untuk taskbar/window — icon.png lama 454 KB @1024².
  const iconPath = join(__dirname, '../../resources/icon_256.png')

  // Dulu di-hardcode ke warna gelap, sehingga user light theme selalu kena
  // kedipan gelap saat app dibuka.
  const theme = loadSettings().theme === 'light' ? 'light' : 'dark'

  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 900, minHeight: 600,
    backgroundColor: WINDOW_BG[theme],
    // Chrome window digambar sendiri oleh renderer (src/components/Titlebar).
    frame: false,
    // Jangan tampilkan window sampai frame pertama siap — menghilangkan
    // kedipan latar kosong saat start.
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false,
      sandbox: true,          // [S7] preload cuma butuh contextBridge + ipcRenderer
      webviewTag: false,
    },
  })
  mark('window-created')

  if (PERF) {
    win.webContents.on('did-finish-load', () => mark('did-finish-load'))
    // Menumpang console pipe yang sudah ada — renderer nge-log lewat console.log
    // biasa, main cuma meneruskan baris yang berawalan tag [perf] ke stdout-nya
    // sendiri supaya semua timestamp ada di satu aliran output yang sama.
    win.webContents.on('console-message', (_e, level, msg) => {
      // level: 0 verbose, 1 info, 2 warning, 3 error (dok Electron). Warning/
      // error ikut diteruskan supaya mode diagnostik ini juga menangkap
      // pelanggaran CSP atau error modul dinamis (import() gagal dsb).
      if (msg.startsWith('[perf]') || level >= 2) console.log(`[renderer:${level}]`, msg)
    })
  }

  // [B3][S3] Tanpa guard ini, satu klik pada link di jawaban AI atau di file .md
  // yang dibuka akan menavigasi renderer ke situs remote — dan preload ikut jalan
  // di halaman itu, sehingga situs remote mendapat window.api (baca/tulis file).
  const rendererBase = process.env['ELECTRON_RENDERER_URL']
    ?? pathToFileURL(join(__dirname, '../renderer/index.html')).toString()

  const isInternalUrl = (url: string) =>
    url === rendererBase || url.startsWith(rendererBase + '#') || url.startsWith(rendererBase + '?')
    || (!!process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL']!))

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }   // jangan pernah membuat window anak yang mewarisi preload
  })

  win.webContents.on('will-navigate', (e, url) => {
    if (isInternalUrl(url)) return
    e.preventDefault()
    openExternalSafely(url)
  })

  // Redirect di tengah navigasi juga harus dijaga
  win.webContents.on('will-redirect', (e, url) => {
    if (isInternalUrl(url)) return
    e.preventDefault()
  })

  win.on('close', (e) => {
    if (forceClose || !isDocDirty) return
    // Kalau renderer sudah mati, jangan sandera user — biarkan window tertutup
    if (win?.webContents.isCrashed() || win?.webContents.isDestroyed()) return
    e.preventDefault()
    win?.webContents.send('app:requestClose')
  })

  win.once('ready-to-show', () => {
    win?.show()
    mark('ready-to-show')
    // Jaringan (ListModels Gemini/OpenAI) ditunda sampai window benar-benar
    // tampil, supaya tidak berebut main thread/socket dengan pembuatan window.
    // Kalau user langsung memakai AI sebelum timer ini sempat jalan,
    // ensureWarmed() juga dipanggil dari ai:getModels/ai:stream — lihat di sana.
    setTimeout(() => { void ensureWarmed() }, 1500)
  })

  // Titlebar custom harus ikut berubah ikonnya saat window di-maximize lewat
  // jalur lain (snap Windows, double-click tepi, shortcut OS).
  const sendMaximized = () => win?.webContents.send('window:maximized', !!win?.isMaximized())
  win.on('maximize',   sendMaximized)
  win.on('unmaximize', sendMaximized)

  win.on('closed', () => {
    win = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const filePath = getFilePathFromArgv(argv)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (filePath) win.webContents.send('file:openExternal', filePath)
    }
  })

  app.whenReady().then(() => {
    mark('app-ready')
    // Satu baca+migrasi+dekripsi settings.json, di-cache di memori — dulu ini
    // 4 pembacaan terpisah (migrateSecretsToEncrypted, removeDeadSettingsKeys,
    // warmVerifiedLimits, createWindow masing-masing baca sendiri) sebelum
    // window pernah tampil. warmVerifiedLimits (2 panggilan HTTPS keluar) juga
    // TIDAK lagi dipanggil di sini — lihat win.once('ready-to-show') di bawah.
    initSettings()
    mark('settings-loaded')
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}

// ── Window controls ───────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => win?.minimize())
ipcMain.on('window-maximize', () => { if (win) { win.isMaximized() ? win.restore() : win.maximize() } })
// Tetap lewat win.close() supaya guard perubahan-belum-disimpan di
// win.on('close') di atas tetap terpicu, sama seperti tombol X bawaan OS dulu.
ipcMain.on('window-close',    () => win?.close())
ipcMain.handle('window:isMaximized', () => !!win?.isMaximized())
ipcMain.on('open:external',   (_e, url: string) => openExternalSafely(url))

// ── App lifecycle / unsaved-changes guard ────────────────────────────────────
ipcMain.on('app:setDirty',   (_e, dirty: boolean) => { isDocDirty = !!dirty })
ipcMain.on('app:forceClose', () => { forceClose = true; win?.close() })

// ── Settings (JSON file, bukan DB) ────────────────────────────────────────────
// [S2] Renderer hanya menerima bentuk yang sudah diredaksi — tanpa API key
ipcMain.handle('settings:getAll', () => publicSettings())

// [L1] Sebelumnya TANPA allowlist maupun validasi nilai — renderer bisa
// menulis key APA PUN ke settings.json lewat sini, termasuk menimpa
// gemini_api_key/openai_api_key dengan nilai sembarang. Asimetris dengan
// jalur baca (`publicSettings`) yang diallowlist ketat. Daftar di bawah
// adalah SEMUA key yang benar-benar dipanggil lewat `updateSetting()` dari
// renderer (lihat src/components/Settings/Settings.tsx dan useStore.ts).
const WRITABLE_SETTING_KEYS = new Set([
  'gemini_api_key', 'openai_api_key',
  'active_model', 'persona_name', 'persona_prompt', 'persona_limit',
  'max_tokens', 'theme', 'sidebar_collapsed',
])
const MAX_SETTING_VALUE_LENGTH = 20_000   // persona_prompt/persona_limit bisa panjang, tapi tidak tak terbatas

// [B8] Hasil tulis diteruskan apa adanya ke renderer — kegagalan tidak lagi ditelan
ipcMain.handle('settings:set', (_e, key: string, value: string) => {
  if (typeof key !== 'string' || !WRITABLE_SETTING_KEYS.has(key)) {
    return { ok: false, error: `Setting "${key}" tidak dikenali.` }
  }
  if (typeof value !== 'string' || value.length > MAX_SETTING_VALUE_LENGTH) {
    return { ok: false, error: 'Nilai setting tidak valid.' }
  }
  const s = loadSettings()
  s[key] = value
  return saveSettings(s)
})

// ── Recent files ──────────────────────────────────────────────────────────────
ipcMain.handle('recent:getAll', () => loadRecent())

ipcMain.handle('recent:remove', async (_e, filePath: string) => {
  const list = (await loadRecent()).filter(r => r.path !== filePath)
  return saveRecent(list)
})

// ── File: Baca file langsung (untuk recent files) ────────────────────────────
ipcMain.handle('file:readDirect', (_e, filePath: string) => {
  return readFileContent(filePath)
})

// ── File: Path file yang dibuka lewat OS "Open With" saat cold start ─────────
ipcMain.handle('file:getPendingOpenPath', () => {
  const p = pendingOpenFilePath
  pendingOpenFilePath = null
  return p
})

// ── File: Buka file (open dialog) ─────────────────────────────────────────────
ipcMain.handle('file:open', async () => {
  if (!win) return null
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

type ReadResult =
  | { ok: true; title: string; content: string; filePath: string }
  | { ok: false; error: string }

async function readFileContent(rawPath: string): Promise<ReadResult> {
  // [S4] Validasi path sebelum menyentuh filesystem
  const check = checkFilePath(rawPath)
  if (!check.ok) return check
  const filePath = check.path

  try {
    // [B13] Batasi ukuran — baca file besar membekukan seluruh app kalau sinkron
    let stat
    try {
      stat = await statAsync(filePath)
    } catch {
      return { ok: false, error: 'File tidak ditemukan atau tidak bisa diakses' }
    }
    if (!stat.isFile()) return { ok: false, error: 'Path yang dipilih bukan sebuah file' }
    if (stat.size > MAX_FILE_BYTES) {
      const mb = (stat.size / 1024 / 1024).toFixed(1)
      return { ok: false, error: `File terlalu besar (${mb} MB). Batas maksimal ${MAX_FILE_BYTES / 1024 / 1024} MB.` }
    }

    const ext  = extensionOf(filePath)
    const name = basename(filePath).replace(/\.[^.]+$/, '') || 'Tanpa Judul'
    let text: string
    try {
      text = (await readFileAsync(filePath, 'utf-8')).trim()
    } catch (readErr: any) {
      console.error('[StudyAI] Failed to read file:', filePath, readErr?.code ?? readErr?.message)
      return {
        ok: false,
        error: readErr?.code === 'EACCES' || readErr?.code === 'EPERM'
          ? 'Tidak punya izin membaca file ini'
          : readErr?.code === 'EBUSY'
            ? 'File sedang dipakai program lain'
            : 'File tidak bisa dibaca',
      }
    }

    if (ext === 'json') {
      try {
        const parsed = JSON.parse(text)
        // [B25-fix] `!= null` lolos untuk objek/angka — file .json dari sumber
        // lain (bukan hasil app ini) bisa menaruh non-string di sini, yang lalu
        // meledak di chunkText/marked saat dipakai seolah string.
        if (typeof parsed?.note?.content === 'string') {
          const title = typeof parsed.note.title === 'string' ? parsed.note.title : name
          return { ok: true, title, content: parsed.note.content, filePath }
        }
        text = JSON.stringify(parsed, null, 2)
      } catch {
        // JSON rusak → tampilkan apa adanya sebagai teks, jangan gagalkan
      }
      return { ok: true, title: name, content: text, filePath }
    }

    // [B9] Ambil judul dari front-matter kalau ada, dan keluarkan bloknya dari isi
    const { title: fmTitle, body } = parseFrontmatter(text)
    return { ok: true, title: fmTitle ?? name, content: body, filePath }
  } catch (e: any) {
    console.error('[StudyAI] Failed to read file content:', filePath, e?.message ?? e)
    return { ok: false, error: 'File tidak bisa dibaca' }
  }
}

// ── File: Simpan (Ctrl+S) ─────────────────────────────────────────────────────
// Kalau filePath sudah ada → overwrite langsung
// Kalau belum → buka dialog Save As
ipcMain.handle('file:save', async (_e, note: {
  title: string; content: string; filePath?: string | null
}) => {
  let targetPath = note.filePath

  // [S4] Path yang datang dari renderer tetap divalidasi, bukan dipercaya
  if (targetPath) {
    const check = checkFilePath(targetPath)
    if (!check.ok) return { ok: false, error: check.error }
    targetPath = check.path
  }

  if (!targetPath) {
    if (!win) return { ok: false, error: 'Window tidak tersedia' }
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

    // [B7-fix] Beberapa OS (terutama Linux/AppImage) tidak menambahkan ekstensi
    // otomatis meski salah satu filter dipilih di dialog. Tanpa ini, path tanpa
    // ekstensi ditulis apa adanya lalu SELAMANYA ditolak checkFilePath saat
    // dibuka ulang lewat recent files.
    let dialogPath = res.filePath
    if (!extensionOf(dialogPath)) dialogPath += '.md'

    // [S4] Path hasil dialog TETAP divalidasi — sebelumnya hanya path yang
    // datang dari renderer (note.filePath, jalur overwrite di atas) yang dicek.
    const check = checkFilePath(dialogPath)
    if (!check.ok) return { ok: false, error: check.error }
    targetPath = check.path
  }

  try {
    // [B22-fix] Satu cara menghitung ekstensi untuk seluruh app — sebelumnya
    // di sini `targetPath.split('.').pop()` bisa menyimpang dari extensionOf()
    // yang dipakai checkFilePath untuk path bertitik di nama folder.
    const ext = extensionOf(targetPath)
    if (ext === 'json') {
      const payload = {
        version: '2.0',
        saved_at: new Date().toISOString(),
        note: { title: note.title, content: note.content },
      }
      atomicWriteSync(targetPath, JSON.stringify(payload, null, 2))
    } else {
      // [B9] Judul ikut tersimpan sebagai front-matter kalau beda dari nama file
      atomicWriteSync(targetPath, withFrontmatter(note.title, note.content, targetPath))
    }
    const recentResult = await addToRecent(targetPath, note.title)
    return {
      ok: true,
      filePath: targetPath,
      // [B17-fix] Gagal update recent.json bukan alasan melaporkan save
      // sebagai gagal — file dokumennya sendiri sudah tersimpan — tapi
      // renderer tetap harus tahu supaya tidak menganggap semuanya mulus.
      ...(recentResult.ok ? {} : { recentWarning: recentResult.error }),
    }
  } catch (e: any) {
    console.error('[StudyAI] Failed to save file:', targetPath, e?.message ?? e)
    return { ok: false, error: e?.message ?? String(e) }
  }
})

// ── File: Buka file sebagai konteks chat ──────────────────────────────────────
ipcMain.handle('file:openAsContext', async () => {
  if (!win) return null
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

// ── AI: Daftar model per-provider, cache per key selama proses berjalan ──────
// [Celah 2] Sebelumnya tidak ada cache sama sekali — Settings di-mount ulang
// setiap kali user pindah tab, jadi ListModels Gemini dipanggil ulang tiap buka
// Pengaturan, dan daftar OpenAI hilang total sampai user menekan Validasi lagi.
// Fingerprint (bukan key mentah) dipakai supaya cache otomatis basi begitu key
// diganti (aturan 2 docs/ai-rules/api-integration.md), dan key tidak pernah
// ikut disimpan/di-log dalam bentuk yang bisa dibaca balik.
type ModelProvider = 'gemini' | 'openai'
type ModelCacheEntry = { fingerprint: string; models: string[]; limits: Record<string, number>; fetchedAt: number }
const modelCache = new Map<ModelProvider, ModelCacheEntry>()

// `provider !== 'gemini' && provider !== 'openai'` on a plain `string` does NOT
// narrow back to the literal union afterwards (TS can't express "string minus
// two literals") — a type predicate is needed so `modelCache.get(provider)` below
// type-checks without an unsafe cast.
function isModelProvider(p: string): p is ModelProvider {
  return p === 'gemini' || p === 'openai'
}

function fingerprintKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function cacheModels(provider: 'gemini' | 'openai', key: string, result: { models: string[]; limits: Record<string, number> }) {
  modelCache.set(provider, {
    fingerprint: fingerprintKey(key),
    models:      result.models,
    limits:      result.limits,
    fetchedAt:   Date.now(),
  })
  if (Object.keys(result.limits).length > 0) {
    verifiedInputLimits = { ...verifiedInputLimits, ...result.limits }
  }
}

// ── AI: Validate API key ──────────────────────────────────────────────────────
// [Aturan 1] Daftar model SELALU dari endpoint resmi provider memakai key aktif.
// Sebelumnya provider selain gemini langsung `return { valid: true, models: [] }`
// TANPA memanggil API sama sekali — key OpenAI tidak pernah benar-benar divalidasi
// dan daftar modelnya hardcoded di UI.
// Kalau `key` tidak dikirim, pakai key tersimpan — supaya tombol Refresh tidak
// memerlukan key-nya ada di renderer.
ipcMain.handle('ai:validateKey', async (_e, provider: string, key?: string) => {
  // [L6] Sebelumnya `provider` diinterpolasi langsung ke `${provider}_api_key`
  // SEBELUM divalidasi — berbeda dari `ai:getModels` di bawah yang sudah
  // memvalidasi lebih dulu lewat `isModelProvider`. Dampaknya terbatas (cuma
  // menghasilkan lookup yang selalu `undefined` untuk provider tidak dikenal),
  // tapi tetap tidak konsisten dengan pola yang sudah benar di IPC lain.
  if (!isModelProvider(provider)) {
    return { valid: false, error: `Provider "${provider}" belum didukung`, errorKind: 'other' }
  }

  const effectiveKey = (key ?? loadSettings()[`${provider}_api_key`] ?? '').trim()
  if (!effectiveKey) return { valid: false, error: 'API key kosong', errorKind: 'auth' }

  const result = provider === 'gemini' ? await listGeminiModels(effectiveKey) : await listOpenAIModels(effectiveKey)
  if (!result.valid) return result

  cacheModels(provider, effectiveKey, result)
  return result
})

// [Celah 2] Dipanggil Settings saat mount / tombol Refresh — TIDAK memanggil
// provider kalau cache masih cocok dengan key yang sekarang tersimpan, kecuali
// `force: true`. Ini yang membuat pindah tab Pengaturan tidak memicu fetch baru.
ipcMain.handle('ai:getModels', async (_e, provider: string, opts?: { force?: boolean }) => {
  void ensureWarmed()   // jaga-jaga kalau idle timer startup belum sempat jalan
  if (!isModelProvider(provider)) {
    return { valid: false, error: `Provider "${provider}" belum didukung`, errorKind: 'other' }
  }
  const key = (loadSettings()[`${provider}_api_key`] ?? '').trim()
  if (!key) return { valid: false, error: 'API key belum dikonfigurasi.', errorKind: 'auth' }

  const fingerprint = fingerprintKey(key)
  const cached = modelCache.get(provider)
  if (!opts?.force && cached && cached.fingerprint === fingerprint) {
    return { valid: true, models: cached.models, limits: cached.limits }
  }

  const result = provider === 'gemini' ? await listGeminiModels(key) : await listOpenAIModels(key)
  if (result.valid) cacheModels(provider, key, result)
  return result
})

// [Aturan 4] Apakah model yang tersimpan masih ada di daftar terverifikasi terakhir
ipcMain.handle('ai:getVerifiedLimits', () => verifiedInputLimits)

// ── AI: Streaming (dijalankan DI MAIN, key tidak pernah ke renderer) ─────────
// [S2] Renderer mengirim pesan + model saja. Main yang mengambil API key dari
// settings terenkripsi, memanggil provider, lalu mengalirkan potongan teks
// kembali lewat event `ai:chunk`.
const activeStreams = new Map<string, AbortController>()

// [B11] Batas input per model, hasil verifikasi langsung dari ListModels provider.
// Menggantikan tabel hardcode yang membuat model baru dianggap cuma 32k token.
let verifiedInputLimits: Record<string, number> = {}

// [M5] Kalau model yang tersimpan sudah tidak ada di daftar terverifikasi
// provider-nya SENDIRI saat startup (mis. dipensiunkan provider sejak app
// terakhir dibuka), pindahkan otomatis ke model terbaik yang MASIH ada —
// daripada membiarkan user terjebak diam-diam memakai model mati sampai
// mereka kebetulan membuka Pengaturan. `selectActiveModelMissing` di renderer
// tetap jadi jaring pengaman untuk perubahan key SETELAH startup.
function maybeCorrectActiveModel(provider: 'gemini' | 'openai', models: string[]) {
  if (models.length === 0) return
  const s = loadSettings()
  const current = s.active_model
  if (providerOf(current) !== provider) return
  if (models.includes(current)) return
  const best = sortModelsForDisplay(models)[0]
  if (!best) return
  s.active_model = best
  const result = saveSettings(s)
  if (result.ok) {
    console.log(`[StudyAI] active_model "${current}" tidak lagi tersedia di key ini, dipindah otomatis ke "${best}"`)
  }
}

// Hangatkan daftar model + batas token saat startup kalau key sudah ada, supaya
// perhitungan token benar tanpa user harus membuka halaman Pengaturan dulu.
async function warmVerifiedLimits() {
  const s = loadSettings()
  const jobs: Promise<unknown>[] = []
  // [Celah 2] Hasil warm-up ikut mengisi modelCache, supaya kunjungan pertama ke
  // halaman Pengaturan tidak perlu fetch jaringan lagi kalau key tidak berubah.
  if (s.gemini_api_key) jobs.push(listGeminiModels(s.gemini_api_key).then(r => {
    if (r.valid) { cacheModels('gemini', s.gemini_api_key, r); maybeCorrectActiveModel('gemini', r.models) }
  }))
  if (s.openai_api_key) jobs.push(listOpenAIModels(s.openai_api_key).then(r => {
    if (r.valid) { cacheModels('openai', s.openai_api_key, r); maybeCorrectActiveModel('openai', r.models) }
  }))
  // Kegagalan di sini tidak fatal — perhitungan token jatuh ke tabel cadangan
  await Promise.allSettled(jobs)
}

// warmVerifiedLimits() dulu dipanggil langsung dari app.whenReady(), berarti 2
// panggilan HTTPS keluar (Gemini + OpenAI ListModels) berlomba dengan pembuatan
// window setiap kali app dibuka — walau di-`void`, keduanya tetap berebut event
// loop & socket dengan langkah-langkah lain saat startup.
//
// Sekarang dipanggil belakangan (idle timer setelah ready-to-show), TAPI kalau
// user langsung memakai AI sebelum timer itu sempat jalan, ai:getModels/ai:stream
// di bawah juga memanggil ensureWarmed() — jadi pemakaian AI pertama tidak
// pernah lebih lambat dari sebelumnya, sekaligus startup tidak pernah menunggu
// jaringan. Promise di-memo supaya dipanggil dari manapun & berkali-kali tetap
// cuma menjalankan satu round-trip jaringan.
let warmedPromise: Promise<void> | null = null
function ensureWarmed(): Promise<void> {
  if (!warmedPromise) warmedPromise = warmVerifiedLimits()
  return warmedPromise
}

// [Aturan 8] Saran pindah provider — hanya kalau provider satunya benar-benar
// punya key tersimpan, supaya sarannya bisa langsung dieksekusi user.
function alternativeProviderHint(model: string): string | null {
  const s = loadSettings()
  const current = providerOf(model)
  if (current === 'gemini' && s.openai_api_key) {
    return 'Kamu punya key OpenAI tersimpan — ganti model ke GPT di Pengaturan sebagai alternatif.'
  }
  if (current === 'openai' && s.gemini_api_key) {
    return 'Kamu punya key Gemini tersimpan — ganti model ke Gemini di Pengaturan sebagai alternatif.'
  }
  return null
}

function keyForModel(
  model: string, settings: Record<string, string>
): { key: string } | { error: string; errorKind: ErrorKind } {
  switch (providerOf(model)) {
    case 'gemini': return settings.gemini_api_key
      ? { key: settings.gemini_api_key }
      : { error: 'API key Gemini belum dikonfigurasi. Buka Pengaturan.', errorKind: 'auth' }
    case 'openai': return settings.openai_api_key
      ? { key: settings.openai_api_key }
      : { error: 'API key OpenAI belum dikonfigurasi. Buka Pengaturan.', errorKind: 'auth' }
    default:       return { error: `Model tidak dikenali: "${model}". Periksa pengaturan provider.`, errorKind: 'other' }
  }
}

ipcMain.handle('ai:stream', async (e, req: {
  requestId:        string
  model:            string
  messages:         { role: string; content: string }[]
  systemPrompt:     string
  maxOutputTokens:  number
}) => {
  void ensureWarmed()   // jaga-jaga kalau idle timer startup belum sempat jalan
  const { requestId, model, messages, systemPrompt, maxOutputTokens } = req

  const emit = (chunk: { text: string; done: boolean; error?: string; errorKind?: string }) => {
    if (!e.sender.isDestroyed()) e.sender.send('ai:chunk', { requestId, ...chunk })
  }

  const resolved = keyForModel(model, loadSettings())
  if ('error' in resolved) {
    // [L6] Sebelumnya errorKind tidak disertakan di sini, jadi store selalu
    // jatuh ke default 'other' — kebetulan benar untuk "model tidak
    // dikenali", tapi salah untuk "key belum dikonfigurasi" (seharusnya
    // 'auth', sama seperti kegagalan auth lain).
    emit({ text: '', done: true, error: resolved.error, errorKind: resolved.errorKind })
    return { started: false }
  }

  const controller = new AbortController()
  activeStreams.set(requestId, controller)

  // [B7] Sebelumnya streaming sama sekali tidak punya timeout. Kalau koneksi
  // menggantung tanpa menutup socket (Wi-Fi mati, captive portal), UI stuck di
  // "Generating..." selamanya. Timer di-arm sejak awal (jadi ikut menjaga fase
  // koneksi awal) dan di-reset tiap kali ada potongan teks masuk.
  const STALL_MS = 60_000
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let stalled = false

  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => { stalled = true; controller.abort() }, STALL_MS)
  }
  const disarmStall = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
  }

  const send = (chunk: { text: string; done: boolean; error?: string; errorKind?: string }) => {
    if (chunk.done || chunk.error) {
      disarmStall()
      // Abort karena stall terlihat seperti pembatalan biasa dari sisi fetch.
      // Terjemahkan jadi error yang jelas, jangan dibiarkan lewat sebagai "selesai".
      if (stalled && !chunk.error) {
        emit({
          text: '', done: true, errorKind: 'network',
          error: `Tidak ada respons dari provider selama ${STALL_MS / 1000} detik — koneksi kemungkinan terputus.`,
        })
        return
      }
      // [Aturan 8] Kalau satu provider kena limit sementara provider lain punya key,
      // beri jalan keluar konkret alih-alih membiarkan user buntu.
      if (chunk.error && chunk.errorKind === 'quota') {
        const alt = alternativeProviderHint(model)
        if (alt) chunk = { ...chunk, error: `${chunk.error} ${alt}` }
      }
    } else {
      armStall()
    }
    emit(chunk)
  }

  armStall()
  try {
    await streamAI({
      apiKey: resolved.key,
      model,
      messages,
      systemPrompt,
      maxOutputTokens,
      abortSignal: controller.signal,
      onChunk: send,
    })
  } finally {
    disarmStall()
    activeStreams.delete(requestId)
  }
  return { started: true }
})

ipcMain.on('ai:cancel', (_e, requestId: string) => {
  activeStreams.get(requestId)?.abort()
  activeStreams.delete(requestId)
})
