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
        get:     (id: number) => Promise<Note>
        create:  (data: { title?: string; category?: string }) => Promise<Note>
        save:    (note: any) => Promise<{ ok: boolean; updated_at?: string }>
        delete:  (id: number) => Promise<{ ok: boolean }>
      }
      settings: {
        getAll: () => Promise<Settings>
        set:    (key: string, value: string) => Promise<{ ok: boolean }>
      }
      chat: {
        getByNote:   (noteId: string) => Promise<ChatMessage[]>
        getGlobal:   () => Promise<ChatMessage[]>
        save:        (msg: any) => Promise<{ ok: boolean }>
        clearByNote: (noteId: string) => Promise<{ ok: boolean }>
      }
      stats: {
        get:       () => Promise<any>
        today:     () => Promise<any>
        getRange:  (days: number) => Promise<any[]>
        increment: (field: string) => Promise<{ ok: boolean }>
      }
      streak: {
        get: () => Promise<{ count: number }>
      }
      file: {
        import:        () => Promise<{ title: string; content: string; filePath?: string } | null>
        save:          (note: { id: number; title: string; content: string; category?: string }) => Promise<{ ok: boolean; filePath?: string; noPath?: boolean } | null>
        saveAs:        (note: { title: string; content: string; category?: string; id?: number }) => Promise<{ ok: boolean; filePath?: string; canceled?: boolean } | null>
        registerPath:  (noteId: number, filePath: string) => Promise<{ ok: boolean } | null>
        openAsContext: () => Promise<{ title: string; content: string; filePath: string } | null>
      }
      ai: {
        validateKey: (provider: string, key: string) => Promise<{ valid: boolean; models?: string[]; error?: string }>
      }
      openExternal: (url: string) => void
    }
  }
}
