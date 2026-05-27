/**
 * aiStream.ts — Streaming layer untuk Gemini & OpenAI
 * FIXED: buildSafeMessages hanya di router, tidak di streamGemini/streamOpenAI
 * FIXED: Gemini alternating role enforcement lebih robust
 */

export type StreamChunk = { text: string; done: boolean; error?: string }
export type ProgressStatus =
  | 'chunking'
  | 'selecting'
  | 'sending'
  | 'streaming'
  | 'done'
  | 'error'

export interface StreamOptions {
  apiKey: string
  model: string
  messages: { role: string; content: string }[]
  systemPrompt: string
  onChunk: (chunk: StreamChunk) => void
  onProgress?: (status: ProgressStatus, detail?: string) => void
  abortSignal?: AbortSignal
  maxOutputTokens?: number
}

// ─── Token Budget Utilities ───────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export const MODEL_INPUT_LIMITS: Record<string, number> = {
  'gemini-2.5-flash':   1_048_576,
  'gemini-2.5-pro':     1_048_576,
  'gemini-2.0-flash':      32_000,
  'gemini-1.5-flash':   1_048_576,
  'gemini-1.5-pro':     2_097_152,
  'gpt-4o':               128_000,
  'gpt-4o-mini':          128_000,
  'gpt-4-turbo':          128_000,
  'gpt-3.5-turbo':         16_385,
}

const DEFAULT_INPUT_LIMIT = 32_000

export function buildSafeMessages(
  history: { role: string; content: string }[],
  systemPrompt: string,
  maxOutputTokens: number,
  model: string
): {
  safeMessages: { role: string; content: string }[]
  trimmedCount: number
  estimatedInputTokens: number
} {
  const inputLimit = MODEL_INPUT_LIMITS[model] ?? DEFAULT_INPUT_LIMIT
  const hardBudget = Math.floor(inputLimit * 0.9) - maxOutputTokens
  const systemTokens = estimateTokens(systemPrompt)

  let budget = hardBudget - systemTokens
  if (budget <= 0) {
    return {
      safeMessages: history.slice(-1),
      trimmedCount: history.length - 1,
      estimatedInputTokens: systemTokens + estimateTokens(history[history.length - 1]?.content ?? '')
    }
  }

  const safeMessages: { role: string; content: string }[] = []
  let trimmedCount = 0

  for (let i = history.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(history[i].content)
    if (budget - tokens < 0) { trimmedCount++; continue }
    safeMessages.unshift(history[i])
    budget -= tokens
  }

  if (safeMessages.length === 0 && history.length > 0) {
    safeMessages.push(history[history.length - 1])
    trimmedCount = history.length - 1
  }

  const estimatedInputTokens = systemTokens + safeMessages.reduce(
    (sum, m) => sum + estimateTokens(m.content), 0
  )

  return { safeMessages, trimmedCount, estimatedInputTokens }
}

// ─── Fix alternating roles for Gemini ────────────────────────────────────────
// Gemini API hanya menerima pesan dengan role bergantian user/model.
// Kalau ada 2 pesan user berturut-turut → merge jadi satu.
function enforceAlternatingRoles(
  contents: { role: string; parts: { text: string }[] }[]
): { role: string; parts: { text: string }[] }[] {
  if (contents.length === 0) return contents

  const result: { role: string; parts: { text: string }[] }[] = []

  for (const msg of contents) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      // Merge dengan pesan sebelumnya yang sama role-nya
      last.parts.push({ text: '\n\n' + msg.parts[0].text })
    } else {
      result.push({ role: msg.role, parts: [...msg.parts] })
    }
  }

  // Pastikan dimulai dengan 'user'
  if (result[0]?.role !== 'user') {
    result.shift()
  }

  // Pastikan diakhiri dengan 'user'
  if (result[result.length - 1]?.role !== 'user') {
    result.pop()
  }

  return result
}

// ─── SSE Stream Reader ────────────────────────────────────────────────────────

async function readSSEStream(
  res: Response,
  abortSignal: AbortSignal | undefined,
  onLine: (line: string) => void,
  onChunk: (chunk: StreamChunk) => void
): Promise<void> {
  if (!res.body) {
    onChunk({ text: '', done: true, error: 'Response body null — koneksi terputus' })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (abortSignal?.aborted) {
        await reader.cancel()
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      onChunk({ text: '', done: true, error: String(e) })
      return
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

export async function streamGemini(opts: StreamOptions): Promise<void> {
  const { apiKey, model, messages, systemPrompt, onChunk, onProgress, abortSignal } = opts
  const maxOutputTokens = opts.maxOutputTokens ?? 2048

  onProgress?.('sending', `Mengirim ke Gemini (${model})...`)

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`

  // Convert ke Gemini format
  const rawContents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))

  // Enforce alternating roles — CRITICAL untuk Gemini API
  const contents = enforceAlternatingRoles(rawContents)

  if (contents.length === 0) {
    onChunk({ text: '', done: true, error: 'Tidak ada pesan valid untuk dikirim ke AI.' })
    return
  }

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens,
      topK: 40,
      topP: 0.95
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',  threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    ]
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abortSignal
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') { onChunk({ text: '', done: true }); return }
    onChunk({ text: '', done: true, error: `Network error: ${String(e)}` })
    return
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`
    try {
      const errData = await res.json() as any
      errMsg = errData?.error?.message ?? errMsg
      if (res.status === 400 && errMsg.toLowerCase().includes('token')) {
        errMsg = `Input terlalu panjang untuk model ${model}. Coba hapus history chat.`
      }
    } catch {}
    onChunk({ text: '', done: true, error: errMsg })
    return
  }

  onProgress?.('streaming')

  await readSSEStream(res, abortSignal, (line) => {
    if (!line.startsWith('data: ')) return
    const jsonStr = line.slice(6).trim()
    if (!jsonStr || jsonStr === '[DONE]') return
    try {
      const parsed = JSON.parse(jsonStr)
      const finishReason = parsed?.candidates?.[0]?.finishReason
      if (finishReason === 'MAX_TOKENS') {
        onChunk({ text: '\n\n[Respons terpotong — output token limit tercapai]', done: false })
      }
      const text: string = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (text) onChunk({ text, done: false })
    } catch {}
  }, onChunk)

  onChunk({ text: '', done: true })
  onProgress?.('done')
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

export async function streamOpenAI(opts: StreamOptions): Promise<void> {
  const { apiKey, model, messages, systemPrompt, onChunk, onProgress, abortSignal } = opts
  const maxOutputTokens = opts.maxOutputTokens ?? 2048

  onProgress?.('sending', `Mengirim ke OpenAI (${model})...`)

  const url = 'https://api.openai.com/v1/chat/completions'
  const body = {
    model,
    stream: true,
    max_tokens: maxOutputTokens,
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ]
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: abortSignal
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') { onChunk({ text: '', done: true }); return }
    onChunk({ text: '', done: true, error: `Network error: ${String(e)}` })
    return
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`
    try {
      const errData = await res.json() as any
      errMsg = errData?.error?.message ?? errMsg
      if (res.status === 400 && errData?.error?.code === 'context_length_exceeded') {
        errMsg = `Input terlalu panjang untuk model ${model}. Coba hapus history chat.`
      }
    } catch {}
    onChunk({ text: '', done: true, error: errMsg })
    return
  }

  onProgress?.('streaming')

  await readSSEStream(res, abortSignal, (line) => {
    if (!line.startsWith('data: ')) return
    const jsonStr = line.slice(6).trim()
    if (!jsonStr || jsonStr === '[DONE]') return
    try {
      const parsed = JSON.parse(jsonStr)
      const text: string = parsed?.choices?.[0]?.delta?.content ?? ''
      if (text) onChunk({ text, done: false })
      const finishReason = parsed?.choices?.[0]?.finish_reason
      if (finishReason === 'length') {
        onChunk({ text: '\n\n[Respons terpotong — output token limit tercapai]', done: false })
      }
    } catch {}
  }, onChunk)

  onChunk({ text: '', done: true })
  onProgress?.('done')
}

// ─── Router ──────────────────────────────────────────────────────────────────

export async function streamAI(opts: StreamOptions): Promise<void> {
  const { model } = opts
  if (model.startsWith('gemini')) return streamGemini(opts)
  if (model.startsWith('gpt'))    return streamOpenAI(opts)
  opts.onChunk({ text: '', done: true, error: `Model tidak dikenali: ${model}. Cek pengaturan provider.` })
}
