// src/lib/aiStream.ts — FASE 4 PATCH
// [Bug #8]  buildSafeMessages: tambah post-trim cleanup agar hasil selalu dimulai 'user'
// [Bug #12] streamAI router: deteksi claude-* secara eksplisit, error terbaca langsung

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
  'gemini-2.0-flash':   1_048_576,
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

  // Budget terlalu kecil — kembalikan minimal 1 pesan user terakhir
  if (hardBudget - systemTokens <= 0) {
    const last = [...history].reverse().find(m => m.role === 'user') ?? history[history.length - 1]
    return {
      safeMessages: last ? [last] : [],
      trimmedCount: history.length - (last ? 1 : 0),
      estimatedInputTokens: systemTokens + estimateTokens(last?.content ?? '')
    }
  }

  let budget = hardBudget - systemTokens
  const safeMessages: { role: string; content: string }[] = []
  let trimmedCount = 0

  // Iterasi dari belakang — pesan terbaru diprioritaskan
  for (let i = history.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(history[i].content)
    if (budget - tokens < 0) { trimmedCount++; continue }
    safeMessages.unshift(history[i])
    budget -= tokens
  }

  if (safeMessages.length === 0 && history.length > 0) {
    // Fallback: masukkan pesan terakhir apapun role-nya
    safeMessages.push(history[history.length - 1])
    trimmedCount = history.length - 1
  }

  // [Bug #8] Post-trim cleanup:
  // Setelah pemotongan dari depan, array bisa dimulai dengan 'assistant'.
  // Gemini WAJIB dimulai dengan 'user' — drop dari depan sampai ketemu 'user'.
  // Gunakan findIndex, bukan loop destruktif, agar tidak mutasi array asli.
  const firstUserIdx = safeMessages.findIndex(m => m.role === 'user')
  const cleanMessages = firstUserIdx > 0
    ? safeMessages.slice(firstUserIdx)     // drop semua sebelum 'user' pertama
    : safeMessages

  // Hitung ulang trimmedCount berdasarkan berapa yang benar-benar dibuang
  const totalDropped = history.length - cleanMessages.length
  const finalTrimmedCount = Math.max(trimmedCount, totalDropped)

  const estimatedInputTokens = systemTokens + cleanMessages.reduce(
    (sum, m) => sum + estimateTokens(m.content), 0
  )

  return {
    safeMessages: cleanMessages,
    trimmedCount: finalTrimmedCount,
    estimatedInputTokens
  }
}

// ─── Fix alternating roles untuk Gemini ───────────────────────────────────────
// CATATAN: fungsi ini tetap ada sebagai defense-in-depth di streamGemini,
// tapi Bug #4 (Fase 3) sudah memastikan input sudah bersih sebelum sampai sini.
// Tidak ada .pop() di sini — gunakan slice agar tidak destruktif.
function enforceAlternatingRoles(
  contents: { role: string; parts: { text: string }[] }[]
): { role: string; parts: { text: string }[] }[] {
  if (contents.length === 0) return []

  const result: { role: string; parts: { text: string }[] }[] = []

  for (const msg of contents) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      // Merge: consecutive role sama → gabung parts
      last.parts.push({ text: '\n\n' + msg.parts[0].text })
    } else {
      result.push({ role: msg.role, parts: [...msg.parts] })
    }
  }

  // Pastikan dimulai dengan 'user' — drop dari depan, jangan shift() destruktif
  const firstUser = result.findIndex(m => m.role === 'user')
  if (firstUser < 0) return [] // tidak ada pesan user sama sekali → abort
  const trimmed = result.slice(firstUser)

  // Pastikan diakhiri dengan 'user' — [Bug #8 defense] jangan .pop()
  // Cari index 'user' terakhir
  let lastUserIdx = trimmed.length - 1
  while (lastUserIdx >= 0 && trimmed[lastUserIdx].role !== 'user') lastUserIdx--
  if (lastUserIdx < 0) return []

  return trimmed.slice(0, lastUserIdx + 1)
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`

  const rawContents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))

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
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
    } catch (e) {
      console.warn('[StudyAI] Failed to parse Gemini error response:', e)
    }
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
    } catch (e) {
      console.warn('[StudyAI] Failed to parse Gemini SSE chunk:', e)
    }
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
    } catch (e) {
      console.warn('[StudyAI] Failed to parse OpenAI error response:', e)
    }
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
    } catch (e) {
      console.warn('[StudyAI] Failed to parse OpenAI SSE chunk:', e)
    }
  }, onChunk)

  onChunk({ text: '', done: true })
  onProgress?.('done')
}

// ─── Router ──────────────────────────────────────────────────────────────────

export async function streamAI(opts: StreamOptions): Promise<void> {
  const { model } = opts

  if (model.startsWith('gemini')) return streamGemini(opts)
  if (model.startsWith('gpt'))    return streamOpenAI(opts)

  // [Bug #12] Claude terdeteksi secara eksplisit — error terbaca, bukan silent fail
  // Store (Fase 3) sudah guard sebelum sampai sini, tapi defense-in-depth wajib ada di sini
  if (model.startsWith('claude')) {
    opts.onChunk({
      text: '',
      done: true,
      error: `Claude streaming belum diimplementasikan. Ganti model ke Gemini atau GPT di Pengaturan → Providers.`
    })
    return
  }

  // Model benar-benar tidak dikenali
  opts.onChunk({
    text: '',
    done: true,
    error: `Model tidak dikenali: "${model}". Periksa pengaturan provider.`
  })
}