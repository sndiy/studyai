import { Note, Category, ChatMessage, AppSettings, DayStats } from './types'

interface WindowAPI {
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  notes: {
    getAll: () => Promise<Note[]>
    get: (id: string) => Promise<Note>
    save: (note: Partial<Note>) => Promise<{ success: boolean }>
    delete: (id: string) => Promise<{ success: boolean }>
    search: (q: string) => Promise<Note[]>
  }
  categories: {
    getAll: () => Promise<Category[]>
    save: (cat: Partial<Category>) => Promise<{ success: boolean }>
    delete: (id: string) => Promise<{ success: boolean }>
  }
  chat: {
    getByNote: (noteId: string) => Promise<ChatMessage[]>
    getGlobal: () => Promise<ChatMessage[]>
    save: (msg: Partial<ChatMessage>) => Promise<{ success: boolean }>
    clearByNote: (noteId: string) => Promise<{ success: boolean }>
  }
  settings: {
    getAll: () => Promise<AppSettings>
    set: (key: string, value: string) => Promise<{ success: boolean }>
  }
  stats: {
    today: () => Promise<DayStats | null>
    increment: (field: 'chat_count' | 'study_minutes') => Promise<{ success: boolean }>
    getRange: (days: number) => Promise<DayStats[]>
  }
  file: {
    import: () => Promise<{ title: string; content: string; source_file: string; word_count: number; error?: string } | null>
    exportTxt: (note: { title: string; content: string }) => Promise<{ success: boolean; path?: string; error?: string }>
    exportMd: (note: { title: string; content: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  }
  openExternal: (url: string) => void
}

declare global {
  interface Window {
    api: WindowAPI
  }
}
