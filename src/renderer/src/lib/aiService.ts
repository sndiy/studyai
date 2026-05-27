import { ChatMessage, AppSettings } from '../types'

export interface StreamOptions {
  settings: AppSettings
  messages: ChatMessage[]
  noteContent?: string
  onChunk: (chunk: string) => void
  onDone: () => void
  onError: (err: string) => void
}

function buildSystemPrompt(settings: AppSettings, noteContent?: string): string {
  const base = `${settings.persona_prompt}\n\n${settings.persona_limit}`
  if (noteContent?.trim()) {
    return `${base}\n\n--- KONTEKS RANGKUMAN AKTIF ---\n${noteContent.slice(0, 4000)}\n--- AKHIR KONTEKS ---`
  }
  return base
}

export async function streamAI(opts: StreamOptions): Promise<void> {
  const { settings, messages, noteContent, onChunk, onDone, onError } = opts
  const provider = settings.active_provider
  const model = settings.active_model
  const systemPrompt = buildSystemPrompt(settings, noteContent)

  // Build conversation history (last 20 messages)
  const history = messages.slice(-20).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  }))

  try {
    if (provider === 'gemini') {
      await streamGemini(settings.gemini_api_key, model, systemPrompt, history, onChunk, onDone, onError)
    } else if (provider === 'claude') {
      await streamClaude(settings.claude_api_key, model, systemPrompt, history, onChunk, onDone, onError)
    } else if (provider === 'openai') {
      await streamOpenAI(settings.openai_api_key, model, systemPrompt, history, onChunk, onDone, onError)
    } else if (provider === 'grok') {
      await streamGrok(settings.grok_api_key, model, systemPrompt, history, onChunk, onDone, onError)
    } else {
      onError('Provider tidak dikenal')
    }
  } catch (err: any) {
    onError(err.message || 'Terjadi kesalahan')
  }
}

// --- Gemini ---
async function streamGemini(
  apiKey: string, model: string, system: string,
  history: { role: string; content: string }[],
  onChunk: (c: string) => void, onDone: () => void, onError: (e: string) => void
) {
  if (!apiKey) return onError('API key Gemini belum diset. Buka Providers tab untuk mengatur.')

  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return onError(`Gemini error: ${err?.error?.message || res.statusText}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) onChunk(text)
        } catch {}
      }
    }
  }
  onDone()
}

// --- Claude ---
async function streamClaude(
  apiKey: string, model: string, system: string,
  history: { role: string; content: string }[],
  onChunk: (c: string) => void, onDone: () => void, onError: (e: string) => void
) {
  if (!apiKey) return onError('API key Claude belum diset. Buka Providers tab untuk mengatur.')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system,
      stream: true,
      messages: history
    })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return onError(`Claude error: ${err?.error?.message || res.statusText}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        try {
          const json = JSON.parse(data)
          if (json.type === 'content_block_delta') {
            onChunk(json.delta?.text || '')
          }
        } catch {}
      }
    }
  }
  onDone()
}

// --- OpenAI ---
async function streamOpenAI(
  apiKey: string, model: string, system: string,
  history: { role: string; content: string }[],
  onChunk: (c: string) => void, onDone: () => void, onError: (e: string) => void
) {
  if (!apiKey) return onError('API key OpenAI belum diset. Buka Providers tab untuk mengatur.')

  const messages = [
    { role: 'system', content: system },
    ...history
  ]

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 2048 })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return onError(`OpenAI error: ${err?.error?.message || res.statusText}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const text = json?.choices?.[0]?.delta?.content
          if (text) onChunk(text)
        } catch {}
      }
    }
  }
  onDone()
}

// --- Grok (xAI) ---
async function streamGrok(
  apiKey: string, model: string, system: string,
  history: { role: string; content: string }[],
  onChunk: (c: string) => void, onDone: () => void, onError: (e: string) => void
) {
  if (!apiKey) return onError('API key Grok belum diset. Buka Providers tab untuk mengatur.')

  const messages = [
    { role: 'system', content: system },
    ...history
  ]

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, stream: true })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return onError(`Grok error: ${err?.error?.message || res.statusText}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const text = json?.choices?.[0]?.delta?.content
          if (text) onChunk(text)
        } catch {}
      }
    }
  }
  onDone()
}
