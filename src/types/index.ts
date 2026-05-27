export interface Note {
  id: number
  title: string
  content: string
  category: string
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id?: number
  note_id?: number | null
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at?: string
  streaming?: boolean
}

export interface Settings {
  gemini_api_key: string
  active_model: string
  persona_name: string
  persona_prompt: string
  persona_limit: string
  openai_api_key: string
  claude_api_key: string
  streak_count: string
  streak_last_date: string
  max_tokens: string
  web_search_enabled: string
}

export interface Stats {
  totalNotes: number
  todayChats: number
  categories: { category: string; c: number }[]
  recentNotes: Note[]
}

export type Tab = 'editor' | 'chat' | 'providers' | 'stats'
export type View = 'notes' | 'ai' | 'stats' | 'settings'

declare global {
  interface Window {
    api: {
      window: {
        minimize: () => void
        maximize: () => void
        close:    () => void
      }
      notes: {
        getAll:  () => Promise<Note[]>
        get:     (id: string) => Promise<Note>
        create:  (data: {title?: string; category?: string}) => Promise<Note>
        save:    (note: any) => Promise<{success: boolean}>
        delete:  (id: string) => Promise<{success: boolean}>
        search:  (q: string) => Promise<Note[]>
      }
      settings: {
        getAll: () => Promise<Settings>
        set:    (key: string, value: string) => Promise<{success: boolean}>
      }
      chat: {
        getByNote:   (noteId: string) => Promise<ChatMessage[]>
        getGlobal:   () => Promise<ChatMessage[]>
        save:        (msg: any) => Promise<{success: boolean}>
        clearByNote: (noteId: string) => Promise<{success: boolean}>
      }
      categories: {
        getAll: () => Promise<any[]>
        save:   (cat: any) => Promise<{success: boolean}>
        delete: (id: string) => Promise<{success: boolean}>
      }
      stats: {
        today:     () => Promise<any>
        increment: (field: 'chat_count' | 'study_minutes') => Promise<{success: boolean}>
        getRange:  (days: number) => Promise<any[]>
      }
      file: {
        import:    () => Promise<{title: string; content: string; source_file?: string; word_count?: number; error?: string} | null>
        exportTxt: (note: any) => Promise<{success: boolean} | null>
        exportMd:  (note: any) => Promise<{success: boolean} | null>
        exportJson:      (notes: any[], version: string) => Promise<{success: boolean} | null>
        exportMdSingle:  (notes: any[]) => Promise<{success: boolean} | null>
        exportMdFolder:  (notes: any[]) => Promise<{success: boolean} | null>
        exportTxtBulk:   (notes: any[]) => Promise<{success: boolean} | null>
        importJson:      () => Promise<{notes: any[]} | null>
        importMdFiles:   () => Promise<{notes: any[]} | null>
        importTxtFiles:  () => Promise<{notes: any[]} | null>
      }
      ai: {
        validateKey: (provider: string, key: string) => Promise<{valid: boolean; models?: string[]; error?: string}>
      }
      openExternal: (url: string) => void
    }
  }
}
