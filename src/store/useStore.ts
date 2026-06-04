import { create } from 'zustand'
import type { Note, Settings, ChatMessage, Stats, View } from '../types'
import { chunkText, selectRelevantChunks, formatChunksAsContext } from '../lib/chunker'
import { streamAI, buildSafeMessages, type ProgressStatus } from '../lib/aiStream'

export type AIStatus = 'idle' | 'chunking' | 'selecting' | 'sending' | 'streaming' | 'error'
export type ImportProgress = 'idle' | 'reading' | 'saving' | 'error'

interface StoreState {
  currentView: View
  setView: (v: View) => void

  notes: Note[]
  selectedNote: Note | null
  lastOpenedNote: Note | null
  loadNotes: () => Promise<void>
  selectNote: (note: Note | null) => void
  createNote: (data?: { title?: string; category?: string }) => Promise<void>
  saveNote: (id: string, title: string, content: string, category: string) => Promise<void>
  saveNoteAs: (title: string, content: string, category: string, id: number) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  importNote: () => Promise<void>
  importProgress: ImportProgress
  importProgressDetail: string

  settings: Settings | null
  loadSettings: () => Promise<void>
  updateSetting: (key: string, value: string) => Promise<void>

  messages: ChatMessage[]
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
}

function toStrictlyAlternating(
  msgs: { role: string; content: string }[]
): { role: string; content: string }[] {
  let start = 0
  while (start < msgs.length && msgs[start].role !== 'user') start++
  const trimmed = msgs.slice(start)
  if (trimmed.length === 0) return []
  const result: { role: string; content: string }[] = []
  for (const msg of trimmed) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      result[result.length - 1] = { role: last.role, content: last.content + '\n\n' + msg.content }
    } else {
      result.push({ role: msg.role, content: msg.content })
    }
  }
  let end = result.length
  while (end > 0 && result[end - 1].role !== 'user') end--
  return result.slice(0, end)
}

export const useStore = create<StoreState>((set, get) => ({

  // ── View ───────────────────────────────────────────────────────────────────
  currentView: 'notes',
  setView: (v) => set({ currentView: v }),

  // ── Notes ──────────────────────────────────────────────────────────────────
  notes: [],
  selectedNote: null,
  lastOpenedNote: null,
  openFilePaths: {} as Record<number, string>,
  registerOpenPath: (noteId: number, filePath: string) => set(state => ({
    openFilePaths: { ...state.openFilePaths, [noteId]: filePath }
  })),

  loadNotes: async () => {
    const notes = await window.api.notes.getAll()
    set({ notes })
  },

  selectNote: (note) => set({
    selectedNote: note,
    ...(note ? { lastOpenedNote: note } : {})
  }),

  createNote: async (data = {}) => {
    const note = await window.api.notes.create(data)
    await get().loadNotes()
    set({ selectedNote: note, lastOpenedNote: note })
  },

  saveNote: async (id, title, content, category) => {
    const numId = Number(id)
    const res = await window.api.notes.save({ id: numId, title, content, category })
    const updatedAt: string = (res as any)?.updated_at ?? new Date().toLocaleString('id-ID')
    set(state => {
      const updatedNotes = state.notes
        .map(n => Number(n.id) === numId
          ? { ...n, title, content, category, updated_at: updatedAt }
          : n
        )
        .sort((a, b) =>
          new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
        )
      const updatedSelected = Number(state.selectedNote?.id) === numId
        ? { ...state.selectedNote!, title, content, category, updated_at: updatedAt }
        : state.selectedNote
      return {
        notes: updatedNotes,
        selectedNote: updatedSelected,
        lastOpenedNote: Number(state.lastOpenedNote?.id) === numId
          ? { ...state.lastOpenedNote!, title, content, category, updated_at: updatedAt }
          : state.lastOpenedNote
      }
    })
  },

  saveNoteAs: async (title, content, category, id) => {
    const { openFilePaths } = get()
    const existingPath = openFilePaths[id]
    if (existingPath) {
      // Ada path → langsung save ke file tanpa dialog
      const res = await window.api.file.save({ id, title, content, category })
      if (res?.noPath) {
        // Main process restart → path hilang, fallback ke dialog
        await window.api.file.saveAs({ title, content, category, id })
      }
    } else {
      // Belum ada path → buka dialog Save As
      const res = await window.api.file.saveAs({ title, content, category, id })
      // Kalau user pilih lokasi, register path-nya untuk save berikutnya
      if (res?.ok && res.filePath) {
        get().registerOpenPath(id, res.filePath)
      }
    }
  },

  deleteNote: async (id) => {
    await window.api.notes.delete(Number(id))
    const notes = await window.api.notes.getAll()
    const next = notes[0] ?? null
    set({ notes, selectedNote: next, lastOpenedNote: next })
  },

  importProgress: 'idle',
  importProgressDetail: '',

  importNote: async () => {
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
        id: note.id, title: result.title, content: result.content, category: 'Import'
      })
      await get().loadNotes()
      const updated = await window.api.notes.get(note.id)
      // Register path agar Simpan File langsung tulis ke file yang sama
      if (result.filePath) {
        get().registerOpenPath(updated.id, result.filePath)
        await window.api.file.registerPath(updated.id, result.filePath)
      }
      set({ selectedNote: updated, lastOpenedNote: updated, importProgress: 'idle', importProgressDetail: '' })
    } catch (e) {
      set({ importProgress: 'error', importProgressDetail: String(e) })
      setTimeout(() => set({ importProgress: 'idle', importProgressDetail: '' }), 3000)
    }
  },

  // ── Settings ───────────────────────────────────────────────────────────────
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

  // ── Chat ───────────────────────────────────────────────────────────────────
  messages: [],

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

  sendMessage: async (userText, noteId, useContext, useWebSearch = false, sessionId = null) => {
    const { settings, selectedNote, notes } = get()
    if (!settings || !userText.trim()) return

    const currentStatus = get().aiStatus
    if (currentStatus === 'streaming' || currentStatus === 'sending') return
    set({ aiStatus: 'sending', aiStatusDetail: 'Mempersiapkan...', streamingText: '' })

    try {
      const contextNote = noteId
        ? (notes.find(n => String(n.id) === noteId) ?? selectedNote)
        : selectedNote

      const model = settings.active_model ?? 'gemini-2.5-flash'

      if (model.startsWith('claude')) {
        set({ aiStatus: 'error', aiStatusDetail: 'Claude API belum diimplementasikan. Ganti model ke Gemini atau GPT.' })
        setTimeout(() => set({ aiStatus: 'idle', aiStatusDetail: '' }), 5000)
        return
      }

      const apiKey = model.startsWith('gemini')
        ? settings.gemini_api_key
        : model.startsWith('gpt')
          ? settings.openai_api_key
          : ''

      if (!apiKey) {
        set({ aiStatus: 'error', aiStatusDetail: 'API key belum dikonfigurasi. Pergi ke Pengaturan.' })
        setTimeout(() => set({ aiStatus: 'idle', aiStatusDetail: '' }), 4000)
        return
      }

      const historySnapshot = get().messages.map(m => ({ role: m.role as string, content: m.content }))

      window.api.chat.save({ note_id: noteId || null, role: 'user', content: userText, session_id: sessionId })

      const userMsg: ChatMessage = { role: 'user', content: userText }
      set(state => ({ messages: [...state.messages, userMsg] }))

      window.api.stats.increment('chat_count')

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
      set({ abortController, aiStatus: 'sending', aiStatusDetail: chunkInfo ? `${chunkInfo} · ${tokenInfo}` : tokenInfo })

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
          window.api.chat.save({ note_id: noteId || null, role: 'assistant', content: errMsg.content, session_id: sessionId })
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
            window.api.chat.save({ note_id: noteId || null, role: 'assistant', content: accumulated, session_id: sessionId })
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
      const current = get().aiStatus
      if (current !== 'idle') {
        set({ aiStatus: 'idle', aiStatusDetail: '', streamingText: '', abortController: null })
      }
    }
  },

  clearHistory: async (noteId, sessionId = null) => {
    try {
      await window.api.chat.clearByNote(noteId ? String(noteId) : null as any, sessionId)
    } catch (e) {
      console.error('clearHistory error:', e)
    }
    const { abortController } = get()
    if (abortController) abortController.abort()
    set({ messages: [], streamingText: '', aiStatus: 'idle', aiStatusDetail: '', abortController: null })
  },

  // ── Streaming ──────────────────────────────────────────────────────────────
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
      const [statsData, notes, streakData] = await Promise.all([
        window.api.stats.get().catch(() => null),
        window.api.notes.getAll(),
        window.api.streak.get().catch(() => ({ count: 0 }))
      ])
      const catMap: Record<string, number> = {}
      notes.forEach((n: Note) => { const c = n.category || 'Umum'; catMap[c] = (catMap[c] || 0) + 1 })
      const categories = Object.entries(catMap).map(([category, c]) => ({ category, c })).sort((a, b) => b.c - a.c)
      set({
        stats: { totalNotes: notes.length, todayChats: (statsData as any)?.todayChats ?? 0, categories, recentNotes: notes.slice(0, 5) },
        streak: (streakData as any)?.count ?? 0
      })
    } catch (e) {
      set({ stats: { totalNotes: 0, todayChats: 0, categories: [], recentNotes: [] }, streak: 0 })
    }
  },
}))
