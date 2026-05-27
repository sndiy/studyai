import { create } from 'zustand'
import { Note, Category, ChatMessage, AppSettings, Tab } from '../types'

interface AppStore {
  // Notes
  notes: Note[]
  activeNoteId: string | null
  searchQuery: string
  setNotes: (notes: Note[]) => void
  setActiveNoteId: (id: string | null) => void
  setSearchQuery: (q: string) => void
  updateNote: (note: Note) => void
  addNote: (note: Note) => void
  removeNote: (id: string) => void

  // Categories
  categories: Category[]
  setCategories: (cats: Category[]) => void

  // Chat
  chatMessages: ChatMessage[]
  setChatMessages: (msgs: ChatMessage[]) => void
  addChatMessage: (msg: ChatMessage) => void
  clearChat: () => void
  isAIStreaming: boolean
  setIsAIStreaming: (v: boolean) => void
  streamingContent: string
  setStreamingContent: (v: string) => void

  // Settings
  settings: AppSettings | null
  setSettings: (s: AppSettings) => void
  updateSetting: (key: keyof AppSettings, value: string) => void

  // UI
  activeTab: Tab
  setActiveTab: (t: Tab) => void
  isSidebarCollapsed: boolean
  toggleSidebar: () => void

  // Stats
  todayStats: { chat_count: number; study_minutes: number } | null
  setTodayStats: (s: any) => void
}

export const useStore = create<AppStore>((set, get) => ({
  // Notes
  notes: [],
  activeNoteId: null,
  searchQuery: '',
  setNotes: (notes) => set({ notes }),
  setActiveNoteId: (id) => set({ activeNoteId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  updateNote: (note) => set((s) => ({
    notes: s.notes.map(n => n.id === note.id ? note : n)
  })),
  addNote: (note) => set((s) => ({ notes: [note, ...s.notes] })),
  removeNote: (id) => set((s) => ({ notes: s.notes.filter(n => n.id !== id) })),

  // Categories
  categories: [],
  setCategories: (cats) => set({ categories: cats }),

  // Chat
  chatMessages: [],
  setChatMessages: (msgs) => set({ chatMessages: msgs }),
  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  clearChat: () => set({ chatMessages: [] }),
  isAIStreaming: false,
  setIsAIStreaming: (v) => set({ isAIStreaming: v }),
  streamingContent: '',
  setStreamingContent: (v) => set({ streamingContent: v }),

  // Settings
  settings: null,
  setSettings: (s) => set({ settings: s }),
  updateSetting: (key, value) => set((s) => ({
    settings: s.settings ? { ...s.settings, [key]: value } : null
  })),

  // UI
  activeTab: 'editor',
  setActiveTab: (t) => set({ activeTab: t }),
  isSidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),

  // Stats
  todayStats: null,
  setTodayStats: (s) => set({ todayStats: s })
}))
