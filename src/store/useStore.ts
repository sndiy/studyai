import { create } from 'zustand'
import type { Note, Settings, ChatMessage, Stats, View } from '../types'
import { chunkText, selectRelevantChunks, formatChunksAsContext } from '../lib/chunker'
import { streamAI, buildSafeMessages, type ProgressStatus } from '../lib/aiStream'

export type AIStatus = 'idle' | 'chunking' | 'selecting' | 'sending' | 'streaming' | 'error'

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
  loadHistory: (noteId: string | null) => Promise<void>
  sendMessage: (userText: string, noteId: string | null, useContext: boolean, useWebSearch?: boolean) => Promise<void>
  clearHistory: (noteId: string | null) => Promise<void>

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

  saveNote: async (id, title, content, category) => {
    const numId = Number(id)
    await window.api.notes.save({ id: numId, title, content, category })
    set(state => ({
      notes: state.notes.map(n => Number(n.id) === numId ? { ...n, title, content, category } : n),
      selectedNote: Number(state.selectedNote?.id) === numId
        ? { ...state.selectedNote!, title, content, category } as Note
        : state.selectedNote
    }))
  },

  deleteNote: async (id) => {
    await window.api.notes.delete(id)
    const notes = await window.api.notes.getAll()
    set({ notes, selectedNote: notes[0] ?? null })
  },

  importNote: async () => {
    set({ aiStatus: 'chunking', aiStatusDetail: 'Membaca file...' })
    try {
      const result = await window.api.file.import()
      if (!result || (result as any).error) { set({ aiStatus: 'idle', aiStatusDetail: '' }); return }
      set({ aiStatusDetail: 'Menyimpan ke database...' })
      const note = await window.api.notes.create({ title: result.title, category: 'Import' })
      await window.api.notes.save({ id: note.id, title: result.title, content: result.content, category: 'Import', source_file: (result as any).source_file })
      await get().loadNotes()
      const updated = await window.api.notes.get(String(note.id))
      set({ selectedNote: updated, aiStatus: 'idle', aiStatusDetail: '' })
    } catch (e) {
      set({ aiStatus: 'error', aiStatusDetail: String(e) })
      setTimeout(() => set({ aiStatus: 'idle' }), 3000)
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
      if (format === 'json')      res = await window.api.file.importJson()
      else if (format === 'md')   res = await window.api.file.importMdFiles()
      else if (format === 'txt')  res = await window.api.file.importTxtFiles()
      if (res?.notes?.length > 0) {
        set({ importPreview: res.notes, importStatus: `${res.notes.length} rangkuman siap di-import` })
      } else if (res?.error) {
        set({ importStatus: `✗ ${res.error}` })
      } else {
        set({ importStatus: 'Tidak ada rangkuman ditemukan.' })
      }
    } catch (e) { set({ importStatus: `✗ Error: ${e}` }) }
  },

  doImport: async () => {
    const { importPreview, importMergeStrategy, notes } = get()
    const existingTitles: Record<string, number> = {}
    notes.forEach((n, i) => { existingTitles[n.title] = i })

    let added = 0, skipped = 0, overwritten = 0
    for (const n of importPreview) {
      const title = n.title
      if (existingTitles[title] !== undefined) {
        if (importMergeStrategy === 'skip') { skipped++; continue }
        if (importMergeStrategy === 'overwrite') {
          const existing = notes[existingTitles[title]]
          await window.api.notes.save({ id: existing.id, title: n.title, content: n.content, category: n.category })
          overwritten++
        } else {
          // keep_both — buat baru dengan suffix
          await window.api.notes.create({ title: `${title} (import)`, category: n.category })
          const created = (await window.api.notes.getAll())[0]
          await window.api.notes.save({ id: created.id, title: `${title} (import)`, content: n.content, category: n.category })
          added++
        }
      } else {
        const created = await window.api.notes.create({ title: n.title, category: n.category })
        await window.api.notes.save({ id: created.id, title: n.title, content: n.content, category: n.category })
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

  loadHistory: async (noteId) => {
    try {
      let raw: any[]
      if (noteId) {
        raw = await window.api.chat.getByNote(String(noteId))
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

  sendMessage: async (userText, noteId, useContext, useWebSearch = false) => {
    const { settings, selectedNote, notes } = get()
    if (!settings || !userText.trim()) return

    // Tentukan catatan konteks: prioritaskan noteId (dari chat bebas dengan pilihan manual),
    // fallback ke selectedNote (dari chat yang dipasangkan dengan editor)
    const contextNote = noteId
      ? (notes.find(n => String(n.id) === noteId) ?? selectedNote)
      : selectedNote

    const currentStatus = get().aiStatus
    if (currentStatus === 'streaming' || currentStatus === 'sending') return

    const model = settings.active_model ?? 'gemini-2.5-flash'
    const apiKey = model.startsWith('gemini')
      ? settings.gemini_api_key
      : model.startsWith('gpt')
        ? settings.openai_api_key
        : ''

    if (!apiKey) {
      set({ aiStatus: 'error', aiStatusDetail: 'API key belum dikonfigurasi. Pergi ke Pengaturan → Providers.' })
      setTimeout(() => set({ aiStatus: 'idle', aiStatusDetail: '' }), 4000)
      return
    }

    // Ambil history SEBELUM menambahkan pesan user baru
    const historyBeforeUserMsg = get().messages.map(m => ({ role: m.role as string, content: m.content }))

    // Tambahkan pesan user ke UI dan DB
    const msgId = `msg_${Date.now()}`
    await window.api.chat.save({ id: msgId, note_id: noteId || null, role: 'user', content: userText })
    const userMsg: ChatMessage = { role: 'user', content: userText }
    set(state => ({ messages: [...state.messages, userMsg] }))

    // Increment stats
    try { window.api.stats?.increment?.('chat_count') } catch {}

    // Build system prompt
    const maxTokens = parseInt(settings.max_tokens || '2048') || 2048
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

    // Bangun history lengkap: history lama + pesan user baru
    const rawHistory = [
      ...historyBeforeUserMsg,
      { role: 'user', content: userText }
    ]

    // Trim history agar tidak melebihi token budget model
    const { safeMessages, trimmedCount, estimatedInputTokens } = buildSafeMessages(
      rawHistory, systemPrompt, maxTokens, model
    )

    const tokenInfo = trimmedCount > 0
      ? `~${estimatedInputTokens.toLocaleString()} token · ${trimmedCount} pesan lama dipangkas`
      : `~${estimatedInputTokens.toLocaleString()} token`

    const abortController = new AbortController()
    set({
      abortController,
      aiStatus: 'sending',
      aiStatusDetail: chunkInfo ? `${chunkInfo} · ${tokenInfo}` : tokenInfo,
      streamingText: ''
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
        const errMsg: ChatMessage = { role: 'assistant', content: `❌ **Error:** ${error}\n\nPastikan API key valid dan coba lagi.` }
        set(state => ({ messages: [...state.messages, errMsg] }))
        window.api.chat.save({ id: `err_${Date.now()}`, note_id: noteId || null, role: 'assistant', content: errMsg.content })
        setTimeout(() => set({ aiStatus: 'idle', aiStatusDetail: '' }), 5000)
        return
      }
      if (!done) {
        accumulated += text
        set({ streamingText: accumulated, aiStatus: 'streaming' })
      } else {
        if (accumulated) {
          const assistantMsg: ChatMessage = { role: 'assistant', content: accumulated }
          set(state => ({ messages: [...state.messages, assistantMsg], streamingText: '', aiStatus: 'idle', aiStatusDetail: '' }))
          window.api.chat.save({ id: `res_${Date.now()}`, note_id: noteId || null, role: 'assistant', content: accumulated })
        } else {
          set({ streamingText: '', aiStatus: 'idle', aiStatusDetail: '' })
        }
      }
    }

    try {
      await streamAI({
        apiKey, model,
        messages: safeMessages,
        systemPrompt,
        onChunk, onProgress, abortSignal: abortController.signal,
        maxOutputTokens: maxTokens
      })
    } finally {
      const current = get().aiStatus
      if (current !== 'idle') {
        set({ aiStatus: 'idle', aiStatusDetail: '', streamingText: '', abortController: null })
      }
    }
  },

  clearHistory: async (noteId) => {
    try {
      await window.api.chat.clearByNote(noteId ? String(noteId) : '')
    } catch (e) {
      console.error('clearHistory error:', e)
    }
    const { abortController } = get()
    if (abortController) abortController.abort()
    set({ messages: [], streamingText: '', aiStatus: 'idle', aiStatusDetail: '', abortController: null })
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

  loadStats: async () => {
    try {
      const [statsData, notes, settings] = await Promise.all([
        (window.api.stats.today ? window.api.stats.today() : window.api.stats.get()).catch(() => null),
        window.api.notes.getAll(),
        window.api.settings.getAll()
      ])
      const todayStats = statsData

      const catMap: Record<string, number> = {}
      notes.forEach((n: Note) => {
        const c = n.category || 'Umum'
        catMap[c] = (catMap[c] || 0) + 1
      })
      const categories = Object.entries(catMap).map(([category, c]) => ({ category, c })).sort((a, b) => b.c - a.c)

      const stats: Stats = {
        totalNotes: notes.length,
        todayChats: todayStats?.chat_count ?? 0,
        categories,
        recentNotes: notes.slice(0, 5)
      }

      const streakVal = parseInt(settings.streak_count || '0') || 0
      set({ stats, streak: streakVal })
    } catch (e) {
      console.error('loadStats error:', e)
      set({ stats: { totalNotes: 0, todayChats: 0, categories: [], recentNotes: [] }, streak: 0 })
    }
  },

  // ── Search ─────────────────────────────────────────────────────────────────
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
}))