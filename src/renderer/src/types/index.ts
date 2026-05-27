export interface Note {
  id: string
  title: string
  content: string
  category: string
  created_at: number
  updated_at: number
  word_count: number
  source_file?: string
}

export interface Category {
  id: string
  name: string
  color: string
  created_at: number
}

export interface ChatMessage {
  id: string
  note_id: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: number
  provider: string
  model: string
}

export interface AppSettings {
  active_provider: string
  active_model: string
  gemini_api_key: string
  claude_api_key: string
  openai_api_key: string
  grok_api_key: string
  persona_name: string
  persona_prompt: string
  persona_limit: string
  daily_quota: string
  streak: string
  best_streak: string
  last_active_date: string
}

export interface DayStats {
  id: string
  date: string
  chat_count: number
  study_minutes: number
  created_at: number
}

export type Tab = 'editor' | 'chat' | 'providers' | 'stats'
export type SidebarView = 'notes' | 'settings'

export interface AIProvider {
  id: string
  name: string
  label: string
  color: string
  models: string[]
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    label: 'G',
    color: '#7c6af7',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    label: 'C',
    color: '#e0956a',
    models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022', 'claude-opus-4-5']
  },
  {
    id: 'openai',
    name: 'OpenAI ChatGPT',
    label: 'O',
    color: '#48c896',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo']
  },
  {
    id: 'grok',
    name: 'xAI Grok',
    label: 'X',
    color: '#aaaaaa',
    models: ['grok-beta', 'grok-2']
  }
]
