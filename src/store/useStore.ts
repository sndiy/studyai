import { create } from 'zustand'
import type { Document, RecentFile, Settings, ChatMessage, View } from '../types'
import { chunkText, selectRelevantChunks, formatChunksAsContext } from '../lib/chunker'
import { streamAI, buildSafeMessages, type ProgressStatus } from '../lib/aiStream'

export type AIStatus = 'idle' | 'chunking' | 'selecting' | 'sending' | 'streaming' | 'error'

interface StoreState {
  // ── View ──────────────────────────────────────────────────────────────────
  currentView: View
  setView: (v: View) => void

  // ── Document (file aktif di editor) ───────────────────────────────────────
  doc: Document | null
  setDoc: (doc: Document | null) => void
  updateContent: (content: string) => void
  updateTitle: (title: string) => void
  markDirty: () => void

  // Buka file via dialog
  openFile: () => Promise<void>
  // New document kosong
  newDoc: () => void
  // Simpan — Ctrl+S: overwrite kalau ada path, Save As kalau belum
  saveDoc: () => Promise<void>

  // ── Recent files ──────────────────────────────────────────────────────────
  recentFiles: RecentFile[]
  loadRecent: () => Promise<void>
  openRecent: (filePath: string, title: string) => Promise<void>
  removeRecent: (filePath: string) => Promise<void>

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: Settings | null
  loadSettings: () => Promise<void>
  updateSetting: (key: string, value: string) => Promise<void>

  // ── Chat (in-memory, tidak disimpan ke file/DB) ───────────────────────────
  messages: ChatMessage[]
  sendMessage: (
    userText: string,
    useContext: boolean,
    useWebSearch?: boolean,
    fileContext?: { title: string; content: string } | null
  ) => Promise<void>
  clearMessages: () => void

  streamingText:  string
  aiStatus:       AIStatus
  aiStatusDetail: string
  abortController: AbortController | null
  _errorTimeoutId: ReturnType<typeof setTimeout> | null
  cancelStream: () => void
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

export const useStore = create<StoreState>((set, get) => ({

  // ── View ───────────────────────────────────────────────────────────────────
  currentView: 'editor',
  setView: (v) => set({ currentView: v }),

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

  openFile: async () => {
    const result = await window.api.file.open()
    if (!result) return
    set({
      doc: { title: result.title, content: result.content, filePath: result.filePath, isDirty: false },
      currentView: 'editor',
    })
    await get().loadRecent()
  },

  newDoc: () => set({
    doc: { title: 'Tanpa Judul', content: '', filePath: null, isDirty: false },
    currentView: 'editor',
  }),

  saveDoc: async () => {
    const { doc } = get()
    if (!doc) return

    const res = await window.api.file.save({
      title:    doc.title,
      content:  doc.content,
      filePath: doc.filePath,
    })

    if (res.ok && res.filePath) {
      set({ doc: { ...doc, filePath: res.filePath, isDirty: false } })
      await get().loadRecent()
    }
  },

  // ── Recent files ───────────────────────────────────────────────────────────
  recentFiles: [],

  loadRecent: async () => {
    const recentFiles = await window.api.recent.getAll()
    set({ recentFiles })
  },

  openRecent: async (filePath, _title) => {
    const result = await window.api.file.readDirect(filePath)
    if (!result) {
      // File mungkin sudah dihapus — hapus dari recent
      await window.api.recent.remove(filePath)
      await get().loadRecent()
      return
    }
    set({
      doc: { title: result.title, content: result.content, filePath: result.filePath, isDirty: false },
      currentView: 'editor',
    })
    await get().loadRecent()
  },

  removeRecent: async (filePath) => {
    await window.api.recent.remove(filePath)
    await get().loadRecent()
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
      settings: state.settings ? { ...state.settings, [key]: value } : state.settings,
    }))
  },

  // ── Chat (in-memory) ───────────────────────────────────────────────────────
  messages: [],

  clearMessages: () => {
    const tid = get()._errorTimeoutId
    if (tid) clearTimeout(tid)
    set({ messages: [], streamingText: '', aiStatus: 'idle', aiStatusDetail: '', _errorTimeoutId: null })
  },

  sendMessage: async (userText, useContext, useWebSearch = false, fileContext = null) => {
    const { settings, doc, messages } = get()
    if (!settings || !userText.trim()) return

    // Atomic check-and-set to prevent race condition on double-click
    let wasGuarded = false
    set(state => {
      if (state.aiStatus === 'streaming' || state.aiStatus === 'sending') {
        wasGuarded = true
        return state
      }
      return { ...state, aiStatus: 'sending' as const, aiStatusDetail: 'Mempersiapkan...', streamingText: '' }
    })
    if (wasGuarded) return

    try {
      const model  = settings.active_model ?? 'gemini-1.5-flash'
      const apiKey = model.startsWith('gemini') ? settings.gemini_api_key
                   : model.startsWith('gpt')    ? settings.openai_api_key
                   : ''

      if (!apiKey) {
        const prev1 = get()._errorTimeoutId
        if (prev1) clearTimeout(prev1)
        const tid1 = setTimeout(() => set({ aiStatus: 'idle', aiStatusDetail: '', _errorTimeoutId: null }), 4000)
        set({ aiStatus: 'error', aiStatusDetail: 'API key belum dikonfigurasi. Buka Pengaturan.', _errorTimeoutId: tid1 })
        return
      }

      const maxTokens    = parseInt(settings.max_tokens ?? '2048') || 2048
      const personaPrompt = settings.persona_prompt?.trim() || 'Kamu adalah Mai, asisten belajar yang cerdas dan supportif.'
      const personaLimit  = settings.persona_limit?.trim() || 'Jawab dengan jelas dan ringkas.'
      let systemPrompt   = `${personaPrompt}\n\n${personaLimit}`
      let chunkInfo      = ''

      // Konteks dari dokumen aktif di editor
      if (useContext && doc?.content) {
        set({ aiStatus: 'chunking', aiStatusDetail: 'Memecah dokumen...' })
        const allChunks   = chunkText(doc.content)
        const totalChunks = allChunks.length
        if (totalChunks > 1) {
          set({ aiStatus: 'selecting', aiStatusDetail: `Memilih bagian relevan dari ${totalChunks} segmen...` })
          const relevant   = selectRelevantChunks(allChunks, userText, 3)
          const contextText = formatChunksAsContext(relevant, totalChunks)
          chunkInfo = `(${relevant.length}/${totalChunks} segmen)`
          systemPrompt += `\n\nKonteks dari "${doc.title}" ${chunkInfo}:\n---\n${contextText}\n---`
        } else if (totalChunks === 1) {
          systemPrompt += `\n\nKonteks dari "${doc.title}":\n---\n${allChunks[0].text}\n---`
        }
      }

      // Konteks dari file eksternal (free chat picker)
      if (useContext && fileContext?.content) {
        set({ aiStatus: 'chunking', aiStatusDetail: 'Memecah file konteks...' })
        const allChunks   = chunkText(fileContext.content)
        const totalChunks = allChunks.length
        if (totalChunks > 1) {
          set({ aiStatus: 'selecting', aiStatusDetail: `Memilih dari ${totalChunks} segmen...` })
          const relevant   = selectRelevantChunks(allChunks, userText, 3)
          const contextText = formatChunksAsContext(relevant, totalChunks)
          chunkInfo = `(${relevant.length}/${totalChunks} segmen)`
          systemPrompt += `\n\nKonteks dari file "${fileContext.title}" ${chunkInfo}:\n---\n${contextText}\n---`
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

      const { safeMessages, trimmedCount, estimatedInputTokens } = buildSafeMessages(
        history, systemPrompt, maxTokens, model
      )

      const tokenInfo = trimmedCount > 0
        ? `~${estimatedInputTokens.toLocaleString()} token · ${trimmedCount} pesan dipangkas`
        : `~${estimatedInputTokens.toLocaleString()} token`

      const abortController = new AbortController()
      set({ abortController, aiStatus: 'sending', aiStatusDetail: chunkInfo ? `${chunkInfo} · ${tokenInfo}` : tokenInfo })

      let accumulated = ''

      const onProgress = (status: ProgressStatus, detail?: string) => {
        const map: Record<ProgressStatus, AIStatus> = {
          chunking: 'chunking', selecting: 'selecting', sending: 'sending',
          streaming: 'streaming', done: 'idle', error: 'error',
        }
        set({ aiStatus: map[status], aiStatusDetail: detail ?? '' })
      }

      const onChunk = ({ text, done, error }: { text: string; done: boolean; error?: string }) => {
        if (error) {
          const errMsg: ChatMessage = { role: 'assistant', content: `❌ **Error:** ${error}` }
          const prev2 = get()._errorTimeoutId
          if (prev2) clearTimeout(prev2)
          const tid2 = setTimeout(() => set({ aiStatus: 'idle', aiStatusDetail: '', _errorTimeoutId: null }), 5000)
          set(state => ({ messages: [...state.messages, errMsg], streamingText: '', aiStatus: 'error', aiStatusDetail: error, _errorTimeoutId: tid2 }))
          return
        }
        if (!done) {
          accumulated += text
          set({ streamingText: accumulated, aiStatus: 'streaming' })
        } else {
          if (accumulated) {
            set(state => ({
              messages: [...state.messages, { role: 'assistant', content: accumulated }],
              streamingText: '', aiStatus: 'idle', aiStatusDetail: '',
            }))
          } else {
            set({ streamingText: '', aiStatus: 'idle', aiStatusDetail: '' })
          }
        }
      }

      await streamAI({ apiKey, model, messages: safeMessages, systemPrompt, onChunk, onProgress, abortSignal: abortController.signal, maxOutputTokens: maxTokens })

    } finally {
      // Always cleanup abortController to prevent memory leak
      const currentStatus = get().aiStatus
      if (currentStatus === 'error') {
        set({ abortController: null })
      } else if (currentStatus !== 'idle') {
        set({ aiStatus: 'idle', aiStatusDetail: '', streamingText: '', abortController: null })
      } else {
        set({ abortController: null })
      }
    }
  },

  // ── Streaming ──────────────────────────────────────────────────────────────
  streamingText:   '',
  aiStatus:        'idle',
  aiStatusDetail:  '',
  abortController: null,
  _errorTimeoutId: null,

  cancelStream: () => {
    const { abortController, _errorTimeoutId } = get()
    if (_errorTimeoutId) clearTimeout(_errorTimeoutId)
    if (abortController) abortController.abort()
    set({ abortController: null, aiStatus: 'idle', aiStatusDetail: '', streamingText: '', _errorTimeoutId: null })
  },
}))
