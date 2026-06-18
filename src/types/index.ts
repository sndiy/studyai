// Dokumen yang sedang dibuka di editor
export interface Document {
  title:    string
  content:  string
  filePath: string | null   // null = belum disimpan / new file
  isDirty:  boolean         // ada perubahan belum disimpan
}

// Entry di daftar recent files
export interface RecentFile {
  path:      string
  title:     string
  updatedAt: string
}

export interface Settings {
  gemini_api_key: string
  openai_api_key: string
  active_model:   string
  persona_name:   string
  persona_prompt: string
  persona_limit:  string
  max_tokens:     string
  theme?:         'light' | 'dark'
  openai_api_key_unused?: string  // Claude key (stored for future use)
}

export interface ChatMessage {
  role:    'user' | 'assistant'
  content: string
}

export type View = 'editor' | 'ai' | 'settings'

declare global {
  interface Window {
    api: {
      window: {
        minimize: () => void
        maximize: () => void
        close:    () => void
      }
      settings: {
        getAll: () => Promise<Settings>
        set:    (key: string, value: string) => Promise<{ ok: boolean }>
      }
      recent: {
        getAll: () => Promise<RecentFile[]>
        remove: (path: string) => Promise<{ ok: boolean }>
      }
      file: {
        open:          () => Promise<{ title: string; content: string; filePath: string } | null>
        save:          (note: { title: string; content: string; filePath?: string | null }) => Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }>
        openAsContext: () => Promise<{ title: string; content: string; filePath: string } | null>
        readDirect:    (path: string) => Promise<{ title: string; content: string; filePath: string } | null>
      }
      ai: {
        validateKey: (provider: string, key: string) => Promise<{ valid: boolean; models?: string[]; error?: string }>
      }
      openExternal: (url: string) => void
    }
  }
}
