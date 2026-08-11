import { create } from 'zustand'
import type {
  Document, RecentFile, Settings, ChatMessage, View, PendingNav, Toast, AIChunkPayload, ErrorKind,
} from '../types'
import { chunkText, selectRelevantChunks, formatChunksAsContext, MAX_TOKENS_PER_CHUNK } from '../lib/chunker'
import { buildSafeMessages, resolveInputLimit } from '../lib/aiStream'
import { providerOf, type Provider } from '../lib/providers'
import { withViewTransition } from '../lib/viewTransition'
import { DEFAULT_PERSONA_PROMPT, DEFAULT_PERSONA_LIMIT } from '../lib/personaDefaults'

// [Bug #4] Sinkron dengan SECRET_KEYS di electron/main.ts. Main tidak pernah
// mengirim nilai key ini ke renderer (lihat publicSettings/[S2]), tapi
// updateSetting() di bawah bisa dipanggil DENGAN key mentah sebagai `value`
// (mis. dari Settings.tsx saat user menyimpan API key) — daftar ini yang
// mencegah nilai itu numpang lewat update optimistis ke store.
const SECRET_SETTING_KEYS = new Set(['gemini_api_key', 'openai_api_key'])

// [Celah 2] Daftar model per provider, hidup di store supaya remount Settings
// (ganti view lalu balik) tidak perlu fetch ulang — sumber kebenarannya sendiri
// (cache per-key) ada di main process; ini cuma cerminan di renderer.
export type ModelProvider = Extract<Provider, 'gemini' | 'openai'>
export interface ProviderModelsState {
  models:  string[]
  error:   string | null
  loading: boolean
}

export type AIStatus = 'idle' | 'chunking' | 'selecting' | 'sending' | 'streaming' | 'error'

/** Harus sama dengan durasi @keyframes toastOut (--dur-2) di motion.css. */
const TOAST_EXIT_MS = 180

// [S2] Satu listener IPC untuk seluruh umur aplikasi; potongan stream diarahkan
// ke handler request yang sesuai berdasarkan requestId. Tidak ada listener yang
// didaftarkan per-request, jadi tidak ada penumpukan listener.
const chunkHandlers = new Map<string, (p: AIChunkPayload) => void>()
let chunkListenerReady = false

function ensureChunkListener() {
  if (chunkListenerReady) return
  chunkListenerReady = true
  window.api.ai.onChunk(p => chunkHandlers.get(p.requestId)?.(p))
}

export interface StoreState {
  // ── Layout ────────────────────────────────────────────────────────────────
  /** Dipersist lewat setting `sidebar_collapsed` ('1' | '0'). */
  sidebarCollapsed: boolean
  toggleSidebar: () => void

  /** Command palette (Ctrl/Cmd+K) — murni sesi, tidak dipersist. */
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void

  // ── View ──────────────────────────────────────────────────────────────────
  currentView: View
  setView: (v: View) => void

  // ── Document (file aktif di editor) ───────────────────────────────────────
  doc: Document | null
  setDoc: (doc: Document | null) => void
  updateContent: (content: string) => void
  updateTitle: (title: string) => void
  markDirty: () => void
  /** [Bug #1] Dipanggil Editor setelah round-trip check saat load; null = tidak ada yang hilang */
  setContentWarning: (lost: string[] | null) => void

  // Buka file via dialog
  openFile: () => Promise<void>
  // New document kosong
  newDoc: () => void
  // Simpan — Ctrl+S: overwrite kalau ada path, Save As kalau belum.
  // Mengembalikan true kalau benar-benar tersimpan.
  // [Bug #1] `force: true` melewati gerbang contentWarning (dipakai setelah user
  // mengonfirmasi lewat dialog saveBlockedByFidelity).
  saveDoc: (opts?: { force?: boolean }) => Promise<boolean>
  /** [Bug #1] Konstruksi yang terdeteksi hilang dari dokumen aktif — non-null berarti
   *  saveDoc() baru saja menahan penulisan dan menunggu konfirmasi eksplisit. */
  saveBlockedByFidelity: string[] | null
  confirmLossySave: () => Promise<void>
  cancelLossySave: () => void

  // ── Recent files ──────────────────────────────────────────────────────────
  recentFiles: RecentFile[]
  loadRecent: () => Promise<void>
  openRecent: (filePath: string, title: string) => Promise<void>
  removeRecent: (filePath: string) => Promise<void>

  // ── Guard perubahan belum disimpan ────────────────────────────────────────
  // [B1][B2] Semua jalur yang membuang dokumen aktif lewat sini
  pendingNav: PendingNav | null
  openExternalFile: (filePath: string) => Promise<void>
  requestClose: () => void
  discardAndContinue: () => Promise<void>
  saveAndContinue: () => Promise<void>
  cancelPendingNav: () => void

  // ── Toast global ──────────────────────────────────────────────────────────
  // [B8] Kegagalan simpan/tulis tidak boleh diam
  toast: Toast | null
  toastLeaving: boolean
  showToast: (kind: Toast['kind'], msg: string) => void
  dismissToast: () => void
  _toastTimeoutId: ReturnType<typeof setTimeout> | null
  _toastExitId: ReturnType<typeof setTimeout> | null

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: Settings | null
  loadSettings: () => Promise<void>
  updateSetting: (key: string, value: string) => Promise<boolean>

  // ── Chat (in-memory, tidak disimpan ke file/DB) ───────────────────────────
  messages: ChatMessage[]
  /** [C4] `false` = pesan DITOLAK sebelum masuk transkrip (key belum ada,
   *  input kosong, atau ada request lain sedang berjalan) — Chat.tsx memakai
   *  ini untuk mengembalikan teks ke textarea alih-alih menghilangkannya. */
  sendMessage: (
    userText: string,
    useContext: boolean,
    useWebSearch?: boolean,
    fileContext?: { title: string; content: string } | null
  ) => Promise<boolean>
  clearMessages: () => void

  streamingText:  string
  aiStatus:       AIStatus
  aiStatusDetail: string
  /** [B4] Token generasi — callback dari request lama diabaikan kalau sudah tidak cocok */
  activeRequestId: string | null
  _errorTimeoutId: ReturnType<typeof setTimeout> | null
  cancelStream: () => void

  // ── Kepatuhan api-integration ─────────────────────────────────────────────
  /** [B11] Batas input terverifikasi dari ListModels provider */
  verifiedLimits: Record<string, number>
  loadVerifiedLimits: () => Promise<void>
  /** [Aturan 5] Jenis error terakhir — menentukan apakah "Coba lagi" ditampilkan */
  lastErrorKind: ErrorKind | null
  /** [Aturan 7] Retry hanya atas perintah user, tidak pernah otomatis */
  lastAttempt: { userText: string; useContext: boolean; fileContext: { title: string; content: string } | null } | null
  retryLast: () => Promise<void>

  // ── Celah 2/5: daftar model terverifikasi per provider ───────────────────
  providerModels: Record<ModelProvider, ProviderModelsState>
  /** `force` melewati cache di main (dipakai tombol Refresh) */
  loadProviderModels: (provider: ModelProvider, force?: boolean) => Promise<void>
}

// [Bug #15] Identitas dokumen stabil, independen dari filePath (yang berubah
// lewat Save As). Sama sekali bukan untuk keamanan — cuma pembeda sesi.
function newDocId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// [M7] `set()` di React 18 dibatch — sebuah `set({aiStatus:'chunking'})` yang
// LANGSUNG diikuti kerja sinkron berat (chunkText pada dokumen sampai 16 MB)
// tidak pernah sempat di-paint; browser baru menggambar status SETELAH semua
// kerja sinkron itu selesai, jadi 'Memecah dokumen...'/'Memilih bagian
// relevan...' tidak pernah terlihat dan UI kelihatan diam/beku. Menyerahkan
// giliran ke event loop di sini memberi React kesempatan nge-paint dulu.
function yieldToRender(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function toAlternating(msgs: { role: string; content: string }[]) {
  let start = 0
  while (start < msgs.length && msgs[start].role !== 'user') start++
  const trimmed = msgs.slice(start)
  const result: { role: string; content: string }[] = []
  for (const msg of trimmed) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      result[result.length - 1] = { role: last.role, content: last.content + '\n\n' + msg.content }
    } else {
      result.push({ ...msg })
    }
  }
  let end = result.length
  while (end > 0 && result[end - 1].role !== 'user') end--
  return result.slice(0, end)
}

export const useStore = create<StoreState>((set, get) => {

  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

  // Baca file dari path & load ke doc — dipakai openRecent & openExternalFile
  const loadFileByPath = async (filePath: string) => {
    const result = await window.api.file.readDirect(filePath)
    if (!result.ok) {
      // [B14] Gagal baca bisa berarti file terhapus TAPI bisa juga permission denied /
      // file sedang dikunci. Kabari user, dan hanya bersihkan recent kalau memang ada di sana.
      get().showToast('err', `Gagal membuka "${fileName(filePath)}": ${result.error}`)
      if (get().recentFiles.some(r => r.path === filePath)) {
        await window.api.recent.remove(filePath)
        await get().loadRecent()
      }
      return
    }
    set({
      doc: { docId: newDocId(), title: result.title, content: result.content, filePath: result.filePath, isDirty: false, contentWarning: null },
      currentView: 'editor',
    })
    await get().loadRecent()
  }

  const doNewDoc = () => set({
    doc: { docId: newDocId(), title: 'Tanpa Judul', content: '', filePath: null, isDirty: false, contentWarning: null },
    currentView: 'editor',
  })

  const doOpenFile = async () => {
    const result = await window.api.file.open()
    if (!result) return                    // dialog dibatalkan user
    if (!result.ok) {
      get().showToast('err', `Gagal membuka file: ${result.error}`)
      return
    }
    set({
      doc: { docId: newDocId(), title: result.title, content: result.content, filePath: result.filePath, isDirty: false, contentWarning: null },
      currentView: 'editor',
    })
    await get().loadRecent()
  }

  const runNav = async (nav: PendingNav) => {
    switch (nav.kind) {
      case 'new':        doNewDoc();                        break
      case 'openDialog': await doOpenFile();                break
      case 'openPath':   await loadFileByPath(nav.filePath); break
      case 'close':      window.api.app.forceClose();       break
    }
  }

  // [B1][B2] Satu gerbang untuk semua aksi yang membuang dokumen aktif.
  // Return false = aksi ditunda, dialog konfirmasi sedang ditampilkan.
  const guard = (nav: PendingNav): boolean => {
    if (get().doc?.isDirty) {
      set({ pendingNav: nav })
      return false
    }
    return true
  }

  return {

  // ── View ───────────────────────────────────────────────────────────────────
  currentView: 'editor',
  // Dibungkus View Transition supaya perpindahan view menyilang halus. Semua
  // pemanggil ikut kebagian, bukan cuma sidebar.
  setView: (v) => {
    if (get().currentView === v) return
    withViewTransition(() => set({ currentView: v }))
  },

  // ── Layout ─────────────────────────────────────────────────────────────────
  // Dihidrasi dari settings di loadSettings(); nilai awal false supaya render
  // pertama tidak sempat memperlihatkan rail yang salah lebar.
  sidebarCollapsed: false,

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    set({ sidebarCollapsed: next })
    void get().updateSetting('sidebar_collapsed', next ? '1' : '0')
  },

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  // ── Document ───────────────────────────────────────────────────────────────
  doc: null,

  setDoc: (doc) => set({ doc }),

  updateContent: (content) => set(state => ({
    doc: state.doc ? { ...state.doc, content, isDirty: true } : null,
  })),

  updateTitle: (title) => set(state => ({
    doc: state.doc ? { ...state.doc, title, isDirty: true } : null,
  })),

  markDirty: () => set(state => ({
    doc: state.doc ? { ...state.doc, isDirty: true } : null,
  })),

  setContentWarning: (lost) => set(state => ({
    doc: state.doc ? { ...state.doc, contentWarning: lost } : null,
  })),

  openFile: async () => {
    if (!guard({ kind: 'openDialog' })) return
    await doOpenFile()
  },

  newDoc: () => {
    if (!guard({ kind: 'new' })) return
    doNewDoc()
  },

  saveDoc: async (opts) => {
    const { doc } = get()
    if (!doc) return false

    // [Bug #1] Konstruksi yang terdeteksi hilang saat parsing (tabel/gambar/
    // task-list yang tidak dikenal schema editor, atau apa pun lain di masa
    // depan) TIDAK ditulis diam-diam menimpa file — tahan dan minta konfirmasi
    // eksplisit lewat dialog global (App.tsx), kecuali pemanggil sudah
    // mengonfirmasi (`force`, dipakai confirmLossySave di bawah).
    if (doc.contentWarning?.length && !opts?.force) {
      set({ saveBlockedByFidelity: doc.contentWarning })
      return false
    }

    const docId = doc.docId
    let res: Awaited<ReturnType<typeof window.api.file.save>>
    try {
      res = await window.api.file.save({
        title:    doc.title,
        content:  doc.content,
        filePath: doc.filePath,
      })
    } catch (e) {
      get().showToast('err', `Gagal menyimpan: ${String(e)}`)
      return false
    }

    if (res.ok && res.filePath) {
      const savedPath = res.filePath
      set(state => {
        // [Bug #15] Dialog Save As itu async — dokumen aktif bisa sudah DIGANTI
        // (file baru/lain dibuka) selagi menunggu. Jangan tempelkan path hasil
        // simpan ke dokumen yang berbeda dari yang diminta untuk disimpan.
        if (!state.doc || state.doc.docId !== docId) return {}
        // User juga bisa saja mengetik selagi dialog terbuka. Jangan tandai
        // bersih kalau isinya sudah berubah dari yang benar-benar ditulis.
        const changedWhileSaving =
          state.doc.content !== doc.content || state.doc.title !== doc.title
        // [Bug #1] Apa pun yang barusan ditulis SEKARANG jadi isi file — tidak
        // ada lagi "hilang dibanding disk" untuk dibandingkan sampai dokumen
        // ini dimuat ulang dari luar. Tanpa ini, save paksa yang sudah
        // dikonfirmasi user akan terus memicu dialog yang sama di setiap Ctrl+S.
        return { doc: { ...state.doc, filePath: savedPath, isDirty: changedWhileSaving, contentWarning: null } }
      })
      // [Bug #17] Dokumennya sendiri sudah tersimpan — ini tidak fatal — tapi
      // renderer tetap harus tahu kalau recent.json gagal diperbarui.
      if (res.recentWarning) {
        get().showToast('err', `Tersimpan, tapi daftar file terakhir gagal diperbarui: ${res.recentWarning}`)
      }
      await get().loadRecent()
      return true
    }

    // [B8] Batal itu normal dan diam; gagal itu harus terlihat
    if (res.canceled) return false
    get().showToast('err', `Gagal menyimpan: ${res.error ?? 'penyebab tidak diketahui'}`)
    return false
  },

  saveBlockedByFidelity: null,
  confirmLossySave: async () => {
    set({ saveBlockedByFidelity: null })
    await get().saveDoc({ force: true })
  },
  cancelLossySave: () => set({ saveBlockedByFidelity: null }),

  // ── Recent files ───────────────────────────────────────────────────────────
  recentFiles: [],

  loadRecent: async () => {
    const recentFiles = await window.api.recent.getAll()
    set({ recentFiles })
  },

  openRecent: async (filePath, _title) => {
    if (!guard({ kind: 'openPath', filePath })) return
    await loadFileByPath(filePath)
  },

  removeRecent: async (filePath) => {
    const res = await window.api.recent.remove(filePath)
    if (!res.ok) {
      get().showToast('err', `Gagal memperbarui daftar file: ${res.error}`)
      return
    }
    await get().loadRecent()
  },

  // ── Guard perubahan belum disimpan ────────────────────────────────────────
  pendingNav: null,

  openExternalFile: async (filePath) => {
    if (!guard({ kind: 'openPath', filePath })) return
    await loadFileByPath(filePath)
  },

  requestClose: () => {
    if (!guard({ kind: 'close' })) return
    window.api.app.forceClose()
  },

  discardAndContinue: async () => {
    const nav = get().pendingNav
    if (!nav) return
    set({ pendingNav: null })
    await runNav(nav)
  },

  saveAndContinue: async () => {
    const nav = get().pendingNav
    if (!nav) return
    const saved = await get().saveDoc()
    // Gagal / dibatalkan → dialog tetap terbuka, user belum kehilangan apa pun
    if (!saved) return
    set({ pendingNav: null })
    await runNav(nav)
  },

  cancelPendingNav: () => set({ pendingNav: null }),

  // ── Toast global ──────────────────────────────────────────────────────────
  toast: null,
  toastLeaving: false,
  _toastTimeoutId: null,
  _toastExitId: null,

  // Pembuangan dua fase: tandai `leaving` dulu supaya animasi keluar sempat
  // berjalan, baru unmount. Sebelumnya toast punya animasi masuk tanpa keluar.
  showToast: (kind, msg) => {
    const { _toastTimeoutId, _toastExitId } = get()
    if (_toastTimeoutId) clearTimeout(_toastTimeoutId)
    if (_toastExitId) clearTimeout(_toastExitId)
    const tid = setTimeout(() => get().dismissToast(), kind === 'err' ? 6000 : 2500)
    set({ toast: { kind, msg }, toastLeaving: false, _toastTimeoutId: tid, _toastExitId: null })
  },

  dismissToast: () => {
    const { toast, _toastTimeoutId, _toastExitId } = get()
    if (_toastTimeoutId) clearTimeout(_toastTimeoutId)
    // [Bug #19] Timer sudah di-clear di atas tapi id-nya sendiri belum ditulis
    // ke state sebelum early-return — state jadi berbohong (menyimpan id timer
    // yang sudah mati). Tidak berbahaya (clearTimeout atas id mati adalah
    // no-op) tapi tetap salah untuk dibaca ulang nanti.
    if (!toast || _toastExitId) { set({ _toastTimeoutId: null }); return }
    const eid = setTimeout(
      () => set({ toast: null, toastLeaving: false, _toastExitId: null }),
      TOAST_EXIT_MS,
    )
    set({ toastLeaving: true, _toastTimeoutId: null, _toastExitId: eid })
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  settings: null,

  loadSettings: async () => {
    const settings = await window.api.settings.getAll()
    set({ settings, sidebarCollapsed: settings.sidebar_collapsed === '1' })
    // [Celah 3] Hangatkan providerModels di awal supaya peringatan "model aktif
    // hilang" bisa muncul di Chat tanpa user harus membuka Pengaturan dulu.
    // Main process sudah menghangatkan cache-nya sendiri saat startup
    // (warmVerifiedLimits), jadi ini biasanya langsung dari cache, bukan fetch baru.
    if (settings.has_gemini_key) void get().loadProviderModels('gemini')
    if (settings.has_openai_key) void get().loadProviderModels('openai')
  },

  // [B8] Kegagalan tulis settings dulu lolos sebagai unhandled rejection dan
  // menghentikan savePersona di tengah jalan tanpa pesan apa pun.
  updateSetting: async (key, value) => {
    const isSecret = SECRET_SETTING_KEYS.has(key)
    const prevSettings = get().settings

    // [Bug #4] Nilai rahasia TIDAK PERNAH masuk ke store renderer, bahkan
    // sementara — sebelumnya `{...state.settings, [key]: value}` menaruh API
    // key mentah di zustand (terlihat lewat DevTools) sampai request tulis
    // selesai. `Settings` bahkan tidak mendeklarasikan field ini (lihat [S2]),
    // jadi update optimistis untuk key rahasia dilewati sepenuhnya.
    if (!isSecret) {
      set(state => ({
        settings: state.settings ? { ...state.settings, [key]: value } : state.settings,
      }))
    }

    try {
      const res = await window.api.settings.set(key, value)
      if (!res.ok) {
        // [Bug #10] Rollback HANYA field ini, bukan seluruh objek settings.
        // Sebelumnya `set({ settings: prev })` membuang perubahan field LAIN
        // yang sudah lebih dulu berhasil ditulis ke disk di request sebelumnya
        // (mis. savePersona menulis 3 field berurutan — kegagalan yang ketiga
        // dulu ikut membatalkan tampilan dua yang sudah tersimpan).
        if (!isSecret && prevSettings) {
          set(state => ({
            settings: state.settings
              ? { ...state.settings, [key]: (prevSettings as unknown as Record<string, unknown>)[key] }
              : state.settings,
          }))
        }
        get().showToast('err', `Gagal menyimpan pengaturan "${key}": ${res.error}`)
        return false
      }
      // [Bug #3] Baca ulang dari main — sumber kebenaran untuk has_*_key (dan
      // turunan lain yang main hitung, mis. encryption_available). Sebelumnya
      // has_gemini_key/has_openai_key HANYA pernah ditulis oleh loadSettings(),
      // yang cuma dipanggil sekali di mount App — jadi setelah "Validasi &
      // Simpan Key" berhasil, chat tetap menolak kirim dengan "API key belum
      // dikonfigurasi" sampai app di-restart, walau key-nya sudah tersimpan.
      set({ settings: await window.api.settings.getAll() })
      return true
    } catch (e) {
      if (!isSecret && prevSettings) {
        set(state => ({
          settings: state.settings
            ? { ...state.settings, [key]: (prevSettings as unknown as Record<string, unknown>)[key] }
            : state.settings,
        }))
      }
      get().showToast('err', `Gagal menyimpan pengaturan "${key}": ${String(e)}`)
      return false
    }
  },

  // ── Chat (in-memory) ───────────────────────────────────────────────────────
  messages: [],

  clearMessages: () => {
    const { _errorTimeoutId, activeRequestId } = get()
    if (_errorTimeoutId) clearTimeout(_errorTimeoutId)
    // [Bug #5] Kalau masih ada request yang streaming, batalkan juga di main.
    // Sebelumnya activeRequestId tidak direset di sini, jadi handler chunk yang
    // sudah terdaftar di sendMessage tetap lolos guard identitasnya dan
    // menambahkan balasan AI ke messages yang baru saja dikosongkan — plus main
    // process terus menghabiskan kuota provider untuk request yang sudah
    // ditinggalkan.
    if (activeRequestId) window.api.ai.cancel(activeRequestId)
    // [M1] `lastAttempt`/`lastErrorKind` sebelumnya tidak direset di sini —
    // setelah error lalu "Bersihkan", tombol "Coba lagi" tetap tampil di chat
    // yang sudah kosong, dan menekannya mengirim ulang prompt yang sudah tidak
    // terlihat user sama sekali.
    set({
      messages: [], streamingText: '', aiStatus: 'idle', aiStatusDetail: '',
      activeRequestId: null, _errorTimeoutId: null,
      lastAttempt: null, lastErrorKind: null,
    })
  },

  sendMessage: async (userText, useContext, _useWebSearch = false, fileContext = null) => {
    const { settings, doc, messages } = get()
    if (!settings || !userText.trim()) return false

    // [B5] Timer error dari request sebelumnya WAJIB dimatikan di sini. Kalau tidak,
    // dia fires di tengah request baru, memaksa aiStatus jadi 'idle' — tombol Stop
    // hilang, textarea aktif lagi, dan guard concurrency di bawah jadi tidak berguna.
    const staleTimer = get()._errorTimeoutId
    if (staleTimer) clearTimeout(staleTimer)

    const model = settings.active_model || 'gemini-2.0-flash'
    // [S2] Renderer hanya tahu ADA/TIDAK key-nya — nilainya ada di main process
    // [Celah 1b] Dulu dicek dengan `startsWith('gpt')` sendiri di sini, terpisah
    // dari `providerOf` di main — model o-series (o1/o3/o4-mini) yang dipilih
    // dari dropdown OpenAI selalu dilaporkan "API key belum dikonfigurasi"
    // meski key-nya ada, karena tidak dikenali sebagai OpenAI di sini.
    const provider = providerOf(model)
    const hasKey = provider === 'gemini' ? settings.has_gemini_key
                 : provider === 'openai' ? settings.has_openai_key
                 : false

    // [C4] Dicek SEBELUM guard concurrency dan sebelum status berpindah ke
    // 'sending'. Sebelumnya pemeriksaan ini baru terjadi setelah itu, padahal
    // Chat.tsx sudah mengosongkan textarea SEBELUM menunggu hasil sendMessage —
    // kalau key belum ada, teks yang diketik user lenyap tanpa jejak, tanpa
    // masuk transkrip. Fungsi ini sekarang mengembalikan `false` secepat
    // mungkin (tanpa network call apa pun) supaya Chat.tsx bisa mengembalikan
    // teks ke textarea.
    if (!hasKey) {
      const tid = setTimeout(() => {
        if (get()._errorTimeoutId !== tid) return
        set({ aiStatus: 'idle', aiStatusDetail: '', _errorTimeoutId: null })
      }, 5000)
      set({ aiStatus: 'error', aiStatusDetail: 'API key belum dikonfigurasi. Buka Pengaturan.', _errorTimeoutId: tid })
      return false
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    // Atomic check-and-set to prevent race condition on double-click
    let wasGuarded = false
    set(state => {
      if (state.aiStatus === 'streaming' || state.aiStatus === 'sending') {
        wasGuarded = true
        return {}
      }
      return {
        aiStatus:        'sending' as const,
        aiStatusDetail:  'Mempersiapkan...',
        streamingText:   '',
        activeRequestId: requestId,
        _errorTimeoutId: null,
        lastErrorKind:   null,
        lastAttempt:     { userText, useContext, fileContext },
      }
    })
    if (wasGuarded) return false

    // Status error yang otomatis hilang, tapi hanya kalau request ini masih yang aktif
    const failWith = (msg: string) => {
      // [Bug #18] Guard sebelumnya (`activeRequestId !== requestId && aiStatus
      // === 'streaming'`) salah arah: request basi yang statusnya BUKAN
      // 'streaming' malah LOLOS dan bisa menimpa aiStatus/activeRequestId milik
      // request yang sekarang aktif. Identitas request saja sudah cukup — kalau
      // requestId ini bukan yang aktif, tidak ada urusannya mengubah state apa pun.
      if (get().activeRequestId !== requestId) return
      const tid = setTimeout(() => {
        if (get()._errorTimeoutId !== tid) return
        set({ aiStatus: 'idle', aiStatusDetail: '', _errorTimeoutId: null })
      }, 5000)
      set({ aiStatus: 'error', aiStatusDetail: msg, _errorTimeoutId: tid, activeRequestId: null })
    }

    {
      const maxTokens    = parseInt(settings.max_tokens ?? '2048') || 2048
      // [L3] Fallback ini dulu punya teksnya sendiri, berbeda dari default
      // yang benar-benar ditulis ke settings.json baru (electron/main.ts) DAN
      // dari tombol "Reset Default" di Settings.tsx. Sekarang ketiganya
      // memakai satu konstanta yang sama dari lib/personaDefaults.
      const personaPrompt = settings.persona_prompt?.trim() || DEFAULT_PERSONA_PROMPT
      const personaLimit  = settings.persona_limit?.trim() || DEFAULT_PERSONA_LIMIT
      let systemPrompt   = `${personaPrompt}\n\n${personaLimit}`
      let chunkInfo      = ''

      // [C2] Jangan kunci ke 3 chunk tetap — hitung dari anggaran token model
      // aktif supaya model berkonteks besar (mis. Gemini dengan jutaan token)
      // tidak dibatasi seketat model kecil. Dijaga di [3, 8] supaya tetap masuk
      // akal untuk model kecil maupun tidak memborong seluruh anggaran hanya
      // untuk konteks dokumen.
      const inputLimit = resolveInputLimit(model, get().verifiedLimits)
      const dynamicMaxChunks = Math.max(3, Math.min(8, Math.floor((inputLimit * 0.4) / MAX_TOKENS_PER_CHUNK)))

      // [C2b] Jaring pengaman terakhir kalau pemilihan chunk tetap meleset:
      // AI diminta mengaku kalau jawabannya tidak ada di potongan yang diterima,
      // bukan mengarang dari luar konteks yang disuntikkan.
      const partialContextNotice =
        '\n\nPENTING: Konteks di atas hanya SEBAGIAN dari dokumen. Kalau informasi ' +
        'yang ditanyakan tidak ada di potongan yang kamu terima, katakan terus ' +
        'terang bahwa bagian itu tidak termasuk dalam konteks yang diberikan — ' +
        'jangan mengarang atau menebak isi bagian yang tidak kamu lihat.'

      // Konteks dari dokumen aktif di editor
      if (useContext && doc?.content) {
        set({ aiStatus: 'chunking', aiStatusDetail: 'Memecah dokumen...' })
        await yieldToRender()
        const allChunks   = chunkText(doc.content)
        const totalChunks = allChunks.length
        if (totalChunks > 1) {
          set({ aiStatus: 'selecting', aiStatusDetail: `Memilih bagian relevan dari ${totalChunks} segmen...` })
          await yieldToRender()
          const relevant   = selectRelevantChunks(allChunks, userText, dynamicMaxChunks)
          const contextText = formatChunksAsContext(relevant, totalChunks)
          chunkInfo = `(${relevant.length}/${totalChunks} segmen)`
          systemPrompt += `\n\nKonteks dari "${doc.title}" ${chunkInfo}:\n---\n${contextText}\n---`
          systemPrompt += partialContextNotice
        } else if (totalChunks === 1) {
          systemPrompt += `\n\nKonteks dari "${doc.title}":\n---\n${allChunks[0].text}\n---`
        }
      }

      // Konteks dari file eksternal (free chat picker)
      if (useContext && fileContext?.content) {
        set({ aiStatus: 'chunking', aiStatusDetail: 'Memecah file konteks...' })
        await yieldToRender()
        const allChunks   = chunkText(fileContext.content)
        const totalChunks = allChunks.length
        if (totalChunks > 1) {
          set({ aiStatus: 'selecting', aiStatusDetail: `Memilih dari ${totalChunks} segmen...` })
          await yieldToRender()
          const relevant   = selectRelevantChunks(allChunks, userText, dynamicMaxChunks)
          const contextText = formatChunksAsContext(relevant, totalChunks)
          chunkInfo = `(${relevant.length}/${totalChunks} segmen)`
          systemPrompt += `\n\nKonteks dari file "${fileContext.title}" ${chunkInfo}:\n---\n${contextText}\n---`
          systemPrompt += partialContextNotice
        } else if (totalChunks === 1) {
          systemPrompt += `\n\nKonteks dari file "${fileContext.title}":\n---\n${allChunks[0].text}\n---`
        }
      }

      const userMsg: ChatMessage = { role: 'user', content: userText }
      set(state => ({ messages: [...state.messages, userMsg] }))

      const history = toAlternating([
        ...messages.map(m => ({ role: m.role as string, content: m.content })),
        { role: 'user', content: userText },
      ])

      // [B11] Batas input terverifikasi dari provider lebih diutamakan daripada
      // tabel hardcode — model baru tidak lagi dianggap cuma 32k token.
      const { safeMessages, trimmedCount, estimatedInputTokens } = buildSafeMessages(
        history, systemPrompt, maxTokens, model, get().verifiedLimits
      )

      const tokenInfo = trimmedCount > 0
        ? `~${estimatedInputTokens.toLocaleString()} token · ${trimmedCount} pesan dipangkas`
        : `~${estimatedInputTokens.toLocaleString()} token`

      set({ aiStatus: 'sending', aiStatusDetail: chunkInfo ? `${chunkInfo} · ${tokenInfo}` : tokenInfo })

      ensureChunkListener()
      let accumulated = ''

      await new Promise<void>((resolve) => {
        let settled = false
        // [L5] Handle timer jaring-pengaman di bawah disimpan di sini supaya
        // bisa dibersihkan begitu `finish()` dipanggil lebih awal (kasus
        // normal — `done` datang sebelum 2 detik). Sebelumnya timer ini
        // selalu jalan penuh sampai habis tanpa pernah di-clear, walau
        // `settled` sudah mencegahnya berefek apa pun — bocor satu timer
        // per pesan terkirim.
        let safetyTimer: ReturnType<typeof setTimeout> | null = null
        const finish = () => {
          if (settled) return
          settled = true
          if (safetyTimer) clearTimeout(safetyTimer)
          chunkHandlers.delete(requestId)
          resolve()
        }

        chunkHandlers.set(requestId, ({ text, done, error, errorKind }) => {
          // [B4] Request ini sudah dibatalkan atau digantikan — jangan sentuh
          // state milik request yang sekarang aktif.
          if (get().activeRequestId !== requestId) { finish(); return }

          if (error) {
            // [B6] Teks yang sudah tampil TIDAK dibuang dan TIDAK dipindah ke bawah
            // bubble error. Ditandai di tempatnya sesuai api-integration.md aturan 6.
            set(state => ({
              messages: [
                ...state.messages,
                accumulated
                  ? { role: 'assistant' as const, content: `${accumulated}\n\n---\n_⚠ Terputus: ${error}_` }
                  : { role: 'assistant' as const, content: `❌ **Error:** ${error}` },
              ],
              streamingText: '',
              lastErrorKind: errorKind ?? 'other',
            }))
            failWith(error)
            finish()
            return
          }

          if (!done) {
            accumulated += text
            set({ streamingText: accumulated, aiStatus: 'streaming' })
            return
          }

          // [C3] Jaring pengaman terakhir di renderer — kalau `done` entah
          // kenapa sampai tanpa teks maupun error (provider seharusnya sudah
          // menolak kasus ini di main, tapi jangan diam-diam kalau lolos),
          // jangan biarkan pesan user berdiri sendiri tanpa balasan apa pun.
          set(state => ({
            messages: accumulated
              ? [...state.messages, { role: 'assistant' as const, content: accumulated }]
              : [...state.messages, {
                  role: 'assistant' as const,
                  content: '⚠️ Provider tidak mengembalikan jawaban apa pun untuk pesan ini. Coba kirim ulang.',
                }],
            streamingText:   '',
            aiStatus:        'idle' as const,
            aiStatusDetail:  '',
            activeRequestId: null,
          }))
          finish()
        })

        window.api.ai
          .stream({ requestId, model, messages: safeMessages, systemPrompt, maxOutputTokens: maxTokens })
          .then(() => {
            // Jaring pengaman: kalau chunk `done` entah kenapa tidak pernah sampai,
            // jangan biarkan promise ini menggantung selamanya.
            safetyTimer = setTimeout(finish, 2000)
          })
          .catch((e) => {
            if (get().activeRequestId === requestId) {
              set(state => ({
                messages: [...state.messages, { role: 'assistant' as const, content: `❌ **Error:** ${String(e)}` }],
                streamingText: '',
              }))
              failWith(String(e))
            }
            finish()
          })
      })
    }
    return true
  },

  // ── Streaming ──────────────────────────────────────────────────────────────
  streamingText:   '',
  aiStatus:        'idle',
  aiStatusDetail:  '',
  activeRequestId: null,
  _errorTimeoutId: null,

  // ── Kepatuhan api-integration ─────────────────────────────────────────────
  verifiedLimits: {},
  lastErrorKind:  null,
  lastAttempt:    null,

  loadVerifiedLimits: async () => {
    try {
      set({ verifiedLimits: await window.api.ai.getVerifiedLimits() })
    } catch {
      // Bukan kondisi fatal — perhitungan token jatuh ke tabel cadangan
    }
  },

  // [Aturan 7] Tidak ada auto-retry. Ini hanya dipanggil kalau user menekan tombol.
  retryLast: async () => {
    const attempt = get().lastAttempt
    if (!attempt) return
    // Buang bubble error terakhir + pesan user yang gagal, supaya tidak dobel
    set(state => {
      const msgs = [...state.messages]
      if (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop()
      if (msgs.length && msgs[msgs.length - 1].role === 'user')      msgs.pop()
      return { messages: msgs, lastErrorKind: null }
    })
    await get().sendMessage(attempt.userText, attempt.useContext, false, attempt.fileContext)
  },

  // ── Celah 2/5: daftar model terverifikasi per provider ────────────────────
  providerModels: {
    gemini: { models: [], error: null, loading: false },
    openai: { models: [], error: null, loading: false },
  },

  loadProviderModels: async (provider, force = false) => {
    set(state => ({
      providerModels: {
        ...state.providerModels,
        [provider]: { ...state.providerModels[provider], loading: true },
      },
    }))
    try {
      const res = await window.api.ai.getModels(provider, { force })
      if (res.valid) {
        set(state => ({
          providerModels: {
            ...state.providerModels,
            [provider]: { models: res.models, error: null, loading: false },
          },
          // Batas input terverifikasi ikut numpang lewat respons yang sama —
          // hemat satu IPC round-trip dibanding memanggil loadVerifiedLimits().
          verifiedLimits: Object.keys(res.limits).length > 0
            ? { ...state.verifiedLimits, ...res.limits }
            : state.verifiedLimits,
        }))
      } else {
        // [Aturan 3] Kegagalan tetap terlihat — daftar lama (kalau ada) TIDAK
        // dibuang diam-diam, tapi juga tidak dianggap "masih benar" tanpa error.
        set(state => ({
          providerModels: {
            ...state.providerModels,
            [provider]: { ...state.providerModels[provider], error: res.error, loading: false },
          },
        }))
      }
    } catch (e) {
      set(state => ({
        providerModels: {
          ...state.providerModels,
          [provider]: { ...state.providerModels[provider], error: String(e), loading: false },
        },
      }))
    }
  },

  cancelStream: () => {
    const { activeRequestId, _errorTimeoutId, streamingText, messages } = get()
    if (_errorTimeoutId) clearTimeout(_errorTimeoutId)
    if (activeRequestId) window.api.ai.cancel(activeRequestId)
    // [C5] Kalau dibatalkan SEBELUM token pertama datang, `streamingText` kosong
    // dan `messages` berakhir di giliran 'user' tanpa balasan apa pun. Tanpa
    // penanda di sini, pertanyaan berikutnya digabung oleh `toAlternating` ke
    // pertanyaan yang baru saja dibatalkan — dua bubble user terlihat terpisah
    // di UI, tapi provider menerimanya sebagai SATU giliran yang bercampur.
    const lastIsOrphanedUser = messages.length > 0 && messages[messages.length - 1].role === 'user'
    // Teks yang sudah tampil tetap disimpan — user menghentikan, bukan membatalkan
    set(state => ({
      messages: streamingText
        ? [...state.messages, { role: 'assistant' as const, content: `${streamingText}\n\n---\n_⏹ Dihentikan_` }]
        : lastIsOrphanedUser
          ? [...state.messages, { role: 'assistant' as const, content: '_⏹ Dihentikan sebelum ada respons_' }]
          : state.messages,
      activeRequestId: null,
      aiStatus:        'idle',
      aiStatusDetail:  '',
      streamingText:   '',
      _errorTimeoutId: null,
    }))
  },
  }
})

// [Aturan 5][Celah 3] True hanya kalau daftar terverifikasi UNTUK PROVIDER model
// aktif sudah pernah berhasil dimuat (`models.length > 0`) DAN tidak memuat model
// itu. Kalau daftar belum pernah dimuat sama sekali, jangan tebak-tebak — itu
// sama saja dengan asumsi ketersediaan model yang dilarang aturan 5.
export function selectActiveModelMissing(state: StoreState): boolean {
  const model = state.settings?.active_model
  if (!model) return false
  const provider = providerOf(model)
  if (provider !== 'gemini' && provider !== 'openai') return false
  const list = state.providerModels[provider].models
  if (list.length === 0) return false
  return !list.includes(model)
}
