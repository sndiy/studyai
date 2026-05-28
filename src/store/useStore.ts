// src/store/useStore.ts — FASE 3 PATCH
// [Bug #2]  doImport: hapus ketergantungan (getAll)[0], gunakan return value create langsung
// [Bug #4]  sendMessage: filter array history agar strictly alternating sebelum buildSafeMessages
// [Bug #7]  saveNote: update updated_at di state lokal dari return value notes:save
// [Bug #13] sendMessage: set aiStatus='sending' SEBELUM operasi async pertama (mutex guard)
// [Bug #14] importNote: state importProgress terpisah dari aiStatus

import { create } from 'zustand'
import type { Note, Settings, ChatMessage, Stats, View } from '../types'
import { chunkText, selectRelevantChunks, formatChunksAsContext } from '../lib/chunker'
import { streamAI, buildSafeMessages, type ProgressStatus } from '../lib/aiStream'

export type AIStatus = 'idle' | 'chunking' | 'selecting' | 'sending' | 'streaming' | 'error'
// [Bug #14] Status import terpisah agar tidak tumpuk dengan aiStatus streaming
export type ImportProgress = 'idle' | 'reading' | 'saving' | 'error'

interface StoreState {
  currentView: View
  setView: (v: View) => void

  notes: Note[]
  selectedNote: Note | null
  loadNotes: () => Promise<void>
  selectNote: (note: Note | null) => void
  createNote: (data?: { title?: string; category?: string }) => Promise<void>
  saveNote: (id: string, title: string, content: string, category: string) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  importNote: () => Promise<void>
  exportNote: (title: string, content: string) => Promise<void>

  // [Bug #14] State import terpisah
  importProgress: ImportProgress
  importProgressDetail: string

  // Bulk export/import
  exportAllNotes: (format: 'json' | 'md_single' | 'md_folder' | 'txt') => Promise<void>
  importBulkNotes: (format: 'json' | 'md' | 'txt') => Promise<void>
  importPreview: Note[]
  importMergeStrategy: 'skip' | 'overwrite' | 'keep_both'
  setImportPreview: (notes: Note[]) => void
  setImportMergeStrategy: (s: 'skip' | 'overwrite' | 'keep_both') => void
  doImport: () => Promise<{ added: number; skipped: number; overwritten: number }>

  settings: Settings | null
  loadSettings: () => Promise<void>
  updateSetting: (key: string, value: string) => Promise<void>

  messages: ChatMessage[]
  // [Bug #5 contract] loadHistory sekarang terima sessionId opsional untuk chat bebas
  loadHistory: (noteId: string | null, sessionId?: string | null) => Promise<void>
  sendMessage: (
    userText: string,
    noteId: string | null,
    useContext: boolean,
    useWebSearch?: boolean,
    sessionId?: string | null
  ) => Promise<void>
  clearHistory: (noteId: string | null, sessionId?: string | null) => Promise<void>

  streamingText: string
  aiStatus: AIStatus
  aiStatusDetail: string
  abortController: AbortController | null
  cancelStream: () => void

  stats: Stats | null
  streak: number
  loadStats: () => Promise<void>

  searchQuery: string
  setSearchQuery: (q: string) => void

  exportStatus: string
  importStatus: string
}

// ── Helper: pastikan array messages strictly alternating user/assistant ────────
// Tidak destruktif — menghasilkan array baru, tidak mengubah input.
// Aturan: harus dimulai dengan 'user', tidak boleh ada dua role sama berturut-turut.
// Jika ada consecutive role sama → merge contentnya.
// Jika dimulai dengan 'assistant' → drop sampai ketemu 'user' pertama.
function toStrictlyAlternating(
  msgs: { role: string; content: string }[]
): { role: string; content: string }[] {
  // Drop pesan awal yang bukan 'user'
  let start = 0
  while (start < msgs.length && msgs[start].role !== 'user') start++
  const trimmed = msgs.slice(start)

  if (trimmed.length === 0) return []

  const result: { role: string; content: string }[] = []
  for (const msg of trimmed) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      // Merge: role sama berturut-turut → gabung content
      result[result.length - 1] = {
        role: last.role,
        content: last.content + '\n\n' + msg.content
      }
    } else {
      result.push({ role: msg.role, content: msg.content })
    }
  }

  // Pastikan diakhiri dengan 'user' — jika tidak, trim dari belakang
  // (ini terjadi jika history sudah ada assistant reply, lalu user mengirim baru)
  // Dalam konteks sendMessage, pesan terakhir PASTI 'user', tapi kita pastikan
  // agar tidak ada asumsi tersirat.
  // CATATAN: jangan .pop() — gunakan slice agar tidak destruktif
  let end = result.length
  while (end > 0 && result[end - 1].role !== 'user') end--

  return result.slice(0, end)
}

export const useStore = create<StoreState>((set, get) => ({

  // ── View ──────────────────────────────────────────────────────────────────
  currentView: 'notes',
  setView: (v) => set({ currentView: v }),

  // ── Notes ─────────────────────────────────────────────────────────────────
  notes: [],
  selectedNote: null,

  loadNotes: async () => {
    const notes = await window.api.notes.getAll()
    set({ notes })
  },

  selectNote: (note) => set({ selectedNote: note }),

  createNote: async (data = {}) => {
    const note = await window.api.notes.create(data)
    await get().loadNotes()
    set({ selectedNote: note })
  },

  // [Bug #7] Gunakan updated_at dari return value notes:save untuk update state lokal
  // Sehingga list sidebar langsung resort berdasarkan waktu edit terbaru tanpa reload penuh
  saveNote: async (id, title, content, category) => {
    const numId = Number(id)
    const res = await window.api.notes.save({ id: numId, title, content, category })
    // res.updated_at tersedia dari Fase 1 patch (notes:save return { ok, updated_at })
    const updatedAt: string = res?.updated_at ?? new Date().toISOString()

    set(state => {
      const updatedNotes = state.notes
        .map(n =>
          Number(n.id) === numId
            ? { ...n, title, content, category, updated_at: updatedAt }
            : n
        )
        // Re-sort berdasarkan updated_at descending agar sidebar langsung benar
        .sort((a, b) =>
          new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
        )

      return {
        notes: updatedNotes,
        selectedNote: Number(state.selectedNote?.id) === numId
          ? { ...state.selectedNote!, title, content, category, updated_at: updatedAt }
          : state.selectedNote
      }
    })
  },

  deleteNote: async (id) => {
    await window.api.notes.delete(id)
    const notes = await window.api.notes.getAll()
    set({ notes, selectedNote: notes[0] ?? null })
  },

  // [Bug #14] importNote — gunakan importProgress, bukan aiStatus
  importProgress: 'idle',
  importProgressDetail: '',

  importNote: async () => {
    // Gunakan importProgress — tidak menyentuh aiStatus sama sekali
    set({ importProgress: 'reading', importProgressDetail: 'Membaca file...' })
    try {
      const result = await window.api.file.import()
      if (!result || (result as any).error) {
        set({ importProgress: 'idle', importProgressDetail: '' })
        return
      }
      set({ importProgress: 'saving', importProgressDetail: 'Menyimpan ke database...' })
      const note = await window.api.notes.create({ title: result.title, category: 'Import' })
      await window.api.notes.save({
        id: note.id,
        title: result.title,
        content: result.content,
        category: 'Import'
      })
      await get().loadNotes()
      const updated = await window.api.notes.get(note.id)
      set({ selectedNote: updated, importProgress: 'idle', importProgressDetail: '' })
    } catch (e) {
      set({ importProgress: 'error', importProgressDetail: String(e) })
      setTimeout(() => set({ importProgress: 'idle', importProgressDetail: '' }), 3000)
    }
  },

  exportNote: async (title, content) => {
    await window.api.file.exportMd({ title, content })
  },

  // ── Bulk Export ────────────────────────────────────────────────────────────
  exportStatus: '',
  exportAllNotes: async (format) => {
    const notes = get().notes
    if (notes.length === 0) { set({ exportStatus: 'Tidak ada rangkuman untuk di-export.' }); return }
    set({ exportStatus: 'Mengekspor...' })
    try {
      let res: any
      const version = '2.0'
      if (format === 'json')           res = await window.api.file.exportJson(notes, version)
      else if (format === 'md_single') res = await window.api.file.exportMdSingle(notes)
      else if (format === 'md_folder') res = await window.api.file.exportMdFolder(notes)
      else if (format === 'txt')       res = await window.api.file.exportTxtBulk(notes)
      if (res?.success) {
        const msg = res.folder
          ? `✓ ${res.count} file .md tersimpan di folder`
          : `✓ ${res.count ?? notes.length} rangkuman berhasil di-export`
        set({ exportStatus: msg })
      } else {
        set({ exportStatus: '✗ Export gagal' })
      }
    } catch (e) { set({ exportStatus: `✗ Error: ${e}` }) }
    setTimeout(() => set({ exportStatus: '' }), 4000)
  },

  // ── Bulk Import ────────────────────────────────────────────────────────────
  importPreview: [],
  importMergeStrategy: 'skip',
  importStatus: '',

  setImportPreview: (notes) => set({ importPreview: notes }),
  setImportMergeStrategy: (s) => set({ importMergeStrategy: s }),

  importBulkNotes: async (format) => {
    set({ importStatus: 'Membaca file...', importPreview: [] })
    try {
      let res: any
      if (format === 'json')     res = await window.api.file.importJson()
      else if (format === 'md')  res = await window.api.file.importMdFiles()
      else if (format === 'txt') res = await window.api.file.importTxtFiles()
      if (res?.notes?.length > 0) {
        set({ importPreview: res.notes, importStatus: `${res.notes.length} rangkuman siap di-import` })
      } else if (res?.error) {
        set({ importStatus: `✗ ${res.error}` })
      } else {
        set({ importStatus: 'Tidak ada rangkuman ditemukan.' })
      }
    } catch (e) { set({ importStatus: `✗ Error: ${e}` }) }
  },

  // [Bug #2] doImport — hapus (getAll)[0], gunakan return value notes.create langsung
  doImport: async () => {
    const { importPreview, importMergeStrategy, notes } = get()
    const existingTitles: Record<string, number> = {}
    notes.forEach((n, i) => { existingTitles[n.title] = i })

    let added = 0, skipped = 0, overwritten = 0

    for (const n of importPreview) {
      const title = n.title
      if (existingTitles[title] !== undefined) {
        if (importMergeStrategy === 'skip') {
          skipped++
          continue
        }
        if (importMergeStrategy === 'overwrite') {
          const existing = notes[existingTitles[title]]
          await window.api.notes.save({
            id: existing.id,
            title: n.title,
            content: n.content,
            category: n.category
          })
          overwritten++
        } else {
          // keep_both — [Bug #2] gunakan return value create, bukan (getAll)[0]
          const created = await window.api.notes.create({
            title: `${title} (import)`,
            category: n.category
          })
          // created adalah objek Note lengkap dari DB (Fase 1: notes:create return SELECT)
          await window.api.notes.save({
            id: created.id,
            title: `${title} (import)`,
            content: n.content,
            category: n.category
          })
          added++
        }
      } else {
        // [Bug #2] path normal — sudah benar di kode lama, tapi tetap eksplisit
        const created = await window.api.notes.create({
          title: n.title,
          category: n.category
        })
        await window.api.notes.save({
          id: created.id,
          title: n.title,
          content: n.content,
          category: n.category
        })
        added++
      }
    }

    await get().loadNotes()
    set({ importPreview: [], importStatus: '' })
    return { added, skipped, overwritten }
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: null,

  loadSettings: async () => {
    const settings = await window.api.settings.getAll()
    set({ settings })
  },

  updateSetting: async (key, value) => {
    await window.api.settings.set(key, value)
    set(state => ({
      settings: state.settings ? { ...state.settings, [key]: value } : state.settings
    }))
  },

  // ── Chat ──────────────────────────────────────────────────────────────────
  messages: [],

  // [Bug #5 contract] loadHistory terima sessionId opsional
  loadHistory: async (noteId, sessionId = null) => {
    try {
      let raw: any[]
      if (noteId) {
        raw = await window.api.chat.getByNote(String(noteId))
      } else if (sessionId) {
        raw = await (window.api.chat as any).getBySession(sessionId)
      } else {
        raw = await window.api.chat.getGlobal()
      }
      const messages: ChatMessage[] = (raw || [])
        .filter((r: any) => r.role === 'user' || r.role === 'assistant')
        .map((r: any) => ({ role: r.role as 'user' | 'assistant', content: r.content }))
      set({ messages })
    } catch (e) {
      console.error('loadHistory error:', e)
      set({ messages: [] })
    }
  },

  // [Bug #13] sendMessage — mutex guard: set aiStatus='sending' SEBELUM operasi async pertama
  // [Bug #4]  toStrictlyAlternating dipanggil sebelum buildSafeMessages
  sendMessage: async (userText, noteId, useContext, useWebSearch = false, sessionId = null) => {
    const { settings, selectedNote, notes } = get()
    if (!settings || !userText.trim()) return

    // [Bug #13] MUTEX: set status SEBELUM await apapun
    // Cek dan set dalam satu operasi sinkron — tidak ada jendela race
    const currentStatus = get().aiStatus
    if (currentStatus === 'streaming' || currentStatus === 'sending') return
    // Set 'sending' SEGERA — sebelum operasi async pertama apapun
    set({ aiStatus: 'sending', aiStatusDetail: 'Mempersiapkan...', streamingText: '' })

    try {
      const contextNote = noteId
        ? (notes.find(n => String(n.id) === noteId) ?? selectedNote)
        : selectedNote

      const model = settings.active_model ?? 'gemini-2.5-flash'

      // [Bug #12 - preview] Deteksi Claude di sini, error langsung sebelum lanjut
      // (implementasi penuh di Fase 4, tapi guard awal ada di sini)
      if (model.startsWith('claude')) {
        set({
          aiStatus: 'error',
          aiStatusDetail: 'Claude API streaming belum diimplementasikan. Ganti model ke Gemini atau GPT.'
        })
        setTimeout(() => set({ aiStatus: 'idle', aiStatusDetail: '' }), 5000)
        return
      }

      const apiKey = model.startsWith('gemini')
        ? settings.gemini_api_key
        : model.startsWith('gpt')
          ? settings.openai_api_key
          : ''

      if (!apiKey) {
        set({
          aiStatus: 'error',
          aiStatusDetail: 'API key belum dikonfigurasi. Pergi ke Pengaturan → Providers.'
        })
        setTimeout(() => set({ aiStatus: 'idle', aiStatusDetail: '' }), 4000)
        return
      }

      // Snapshot history SEBELUM menambahkan pesan user baru ke state
      const historySnapshot = get().messages.map(m => ({
        role: m.role as string,
        content: m.content
      }))

      // Simpan pesan user ke DB (fire-and-forget, tidak tunggu)
      window.api.chat.save({
        note_id: noteId || null,
        role: 'user',
        content: userText,
        session_id: sessionId
      })

      // Tambahkan pesan user ke UI state
      const userMsg: ChatMessage = { role: 'user', content: userText }
      set(state => ({ messages: [...state.messages, userMsg] }))

      // Increment stats — handler nyata dari Fase 1+2
      window.api.stats.increment('chat_count')

      // Build system prompt
      const maxTokens = parseInt(settings.max_tokens ?? '2048') || 2048
      const personaPrompt = settings.persona_prompt?.trim() ||
        'Kamu adalah Mai, asisten belajar yang cerdas dan supportif. Berbicara bahasa Indonesia dengan hangat dan fokus pada materi.'
      const personaLimit = settings.persona_limit?.trim() ||
        'Jawab dengan jelas dan ringkas. Sertakan contoh kode untuk topik programming.'
      let systemPrompt = `${personaPrompt}\n\n${personaLimit}`
      let chunkInfo = ''

      if (useContext && contextNote?.content) {
        set({ aiStatus: 'chunking', aiStatusDetail: 'Memecah dokumen...' })
        const allChunks = chunkText(contextNote.content)
        const totalChunks = allChunks.length
        if (totalChunks > 1) {
          set({ aiStatus: 'selecting', aiStatusDetail: `Memilih bagian relevan dari ${totalChunks} segmen...` })
          const relevant = selectRelevantChunks(allChunks, userText, 3)
          const contextText = formatChunksAsContext(relevant, totalChunks)
          chunkInfo = `(${relevant.length}/${totalChunks} segmen digunakan)`
          systemPrompt += `\n\nKonteks dari dokumen "${contextNote.title}" ${chunkInfo}:\n---\n${contextText}\n---`
        } else if (totalChunks === 1) {
          systemPrompt += `\n\nKonteks materi dari "${contextNote.title}":\n---\n${allChunks[0].text}\n---`
        }
      }

      if (useWebSearch) {
        systemPrompt += '\n\nJika informasi di rangkuman TIDAK LENGKAP atau TIDAK ADA, gunakan pengetahuan terbaikmu berdasarkan data training. Selalu prioritaskan isi rangkuman pengguna sebagai sumber utama.'
      }

      // [Bug #4] Bangun rawHistory dari snapshot + pesan user baru,
      // lalu enforce strictly alternating SEBELUM buildSafeMessages
      const rawHistory: { role: string; content: string }[] = [
        ...historySnapshot,
        { role: 'user', content: userText }
      ]
      const alternatingHistory = toStrictlyAlternating(rawHistory)

      const { safeMessages, trimmedCount, estimatedInputTokens } = buildSafeMessages(
        alternatingHistory, systemPrompt, maxTokens, model
      )

      const tokenInfo = trimmedCount > 0
        ? `~${estimatedInputTokens.toLocaleString()} token · ${trimmedCount} pesan lama dipangkas`
        : `~${estimatedInputTokens.toLocaleString()} token`

      const abortController = new AbortController()
      set({
        abortController,
        aiStatus: 'sending',
        aiStatusDetail: chunkInfo ? `${chunkInfo} · ${tokenInfo}` : tokenInfo,
      })

      let accumulated = ''

      const onProgress = (status: ProgressStatus, detail?: string) => {
        const statusMap: Record<ProgressStatus, AIStatus> = {
          chunking: 'chunking', selecting: 'selecting', sending: 'sending',
          streaming: 'streaming', done: 'idle', error: 'error'
        }
        set({ aiStatus: statusMap[status], aiStatusDetail: detail ?? '' })
      }

      const onChunk = ({ text, done, error }: { text: string; done: boolean; error?: string }) => {
        if (error) {
          set({ aiStatus: 'error', aiStatusDetail: error, streamingText: '' })
          const errMsg: ChatMessage = {
            role: 'assistant',
            content: `❌ **Error:** ${error}\n\nPastikan API key valid dan coba lagi.`
          }
          set(state => ({ messages: [...state.messages, errMsg] }))
          window.api.chat.save({
            note_id: noteId || null,
            role: 'assistant',
            content: errMsg.content,
            session_id: sessionId
          })
          setTimeout(() => set({ aiStatus: 'idle', aiStatusDetail: '' }), 5000)
          return
        }
        if (!done) {
          accumulated += text
          set({ streamingText: accumulated, aiStatus: 'streaming' })
        } else {
          if (accumulated) {
            const assistantMsg: ChatMessage = { role: 'assistant', content: accumulated }
            set(state => ({
              messages: [...state.messages, assistantMsg],
              streamingText: '',
              aiStatus: 'idle',
              aiStatusDetail: ''
            }))
            window.api.chat.save({
              note_id: noteId || null,
              role: 'assistant',
              content: accumulated,
              session_id: sessionId
            })
          } else {
            set({ streamingText: '', aiStatus: 'idle', aiStatusDetail: '' })
          }
        }
      }

      await streamAI({
        apiKey, model,
        messages: safeMessages,
        systemPrompt,
        onChunk, onProgress,
        abortSignal: abortController.signal,
        maxOutputTokens: maxTokens
      })

    } finally {
      // Pastikan status kembali idle jika ada yang terlewat
      const current = get().aiStatus
      if (current !== 'idle') {
        set({ aiStatus: 'idle', aiStatusDetail: '', streamingText: '', abortController: null })
      }
    }
  },

  // [Bug #3 contract] clearHistory teruskan sessionId ke preload
  clearHistory: async (noteId, sessionId = null) => {
    try {
      const id = noteId ? String(noteId) : null
      await window.api.chat.clearByNote(id, sessionId)
    } catch (e) {
      console.error('clearHistory error:', e)
    }
    const { abortController } = get()
    if (abortController) abortController.abort()
    set({
      messages: [],
      streamingText: '',
      aiStatus: 'idle',
      aiStatusDetail: '',
      abortController: null
    })
  },

  // ── Streaming state ────────────────────────────────────────────────────────
  streamingText: '',
  aiStatus: 'idle',
  aiStatusDetail: '',
  abortController: null,

  cancelStream: () => {
    const { abortController } = get()
    if (abortController) {
      abortController.abort()
      set({ abortController: null, aiStatus: 'idle', aiStatusDetail: '', streamingText: '' })
    }
  },

  // ── Stats ──────────────────────────────────────────────────────────────────
  stats: null,
  streak: 0,

  // [Bug #9] loadStats — gunakan streak:get handler langsung, bukan settings.streak_count
  loadStats: async () => {
    try {
      const [statsData, notes, streakData] = await Promise.all([
        window.api.stats.get().catch(() => null),
        window.api.notes.getAll(),
        window.api.streak.get().catch(() => ({ count: 0 }))
      ])

      const catMap: Record<string, number> = {}
      notes.forEach((n: Note) => {
        const c = n.category || 'Umum'
        catMap[c] = (catMap[c] || 0) + 1
      })
      const categories = Object.entries(catMap)
        .map(([category, c]) => ({ category, c }))
        .sort((a, b) => b.c - a.c)

      const stats: Stats = {
        totalNotes: notes.length,
        todayChats: statsData?.todayChats ?? statsData?.chat_count ?? 0,
        categories,
        recentNotes: notes.slice(0, 5)
      }

      set({ stats, streak: streakData?.count ?? 0 })
    } catch (e) {
      console.error('loadStats error:', e)
      set({
        stats: { totalNotes: 0, todayChats: 0, categories: [], recentNotes: [] },
        streak: 0
      })
    }
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
}))