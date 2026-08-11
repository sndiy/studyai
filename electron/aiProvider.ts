// electron/aiProvider.ts
//
// [S2] Semua panggilan ke provider AI dijalankan DI MAIN PROCESS.
// Sebelumnya fetch dilakukan dari renderer, sehingga API key ikut masuk ke memori
// renderer dan terlihat mentah di tab Network DevTools. Renderer sekarang tidak
// pernah menerima API key sama sekali — ia cuma mengirim pesan & model.

import { providerOf, isStreamableModel } from '../src/lib/providers'
export { providerOf }

/**
 * [Aturan 5] Penyebab error dibedakan, bukan digeneralisasi jadi "AI tidak merespons".
 * `errorKind` dipakai UI untuk memutuskan apakah tombol "Coba lagi" masuk akal
 * dan apakah perlu menyarankan pindah provider.
 */
export type ErrorKind = 'auth' | 'quota' | 'network' | 'server' | 'input' | 'other'

export type StreamChunk = {
  text: string
  done: boolean
  error?: string
  errorKind?: ErrorKind
}

export interface ProviderStreamOptions {
  apiKey: string
  model: string
  messages: { role: string; content: string }[]
  systemPrompt: string
  maxOutputTokens: number
  abortSignal: AbortSignal
  onChunk: (chunk: StreamChunk) => void
}

// ─── Fix alternating roles untuk Gemini ───────────────────────────────────────
// Gemini menolak dua giliran dengan role sama secara beruntun, dan wajib
// dimulai + diakhiri oleh 'user'. Tidak ada mutasi destruktif di sini.
function enforceAlternatingRoles(
  contents: { role: string; parts: { text: string }[] }[]
): { role: string; parts: { text: string }[] }[] {
  if (contents.length === 0) return []

  const result: { role: string; parts: { text: string }[] }[] = []
  for (const msg of contents) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      last.parts.push({ text: '\n\n' + msg.parts[0].text })
    } else {
      result.push({ role: msg.role, parts: [...msg.parts] })
    }
  }

  const firstUser = result.findIndex(m => m.role === 'user')
  if (firstUser < 0) return []
  const trimmed = result.slice(firstUser)

  let lastUserIdx = trimmed.length - 1
  while (lastUserIdx >= 0 && trimmed[lastUserIdx].role !== 'user') lastUserIdx--
  if (lastUserIdx < 0) return []

  return trimmed.slice(0, lastUserIdx + 1)
}

// ─── SSE reader ───────────────────────────────────────────────────────────────

/**
 * @returns true kalau stream berakhir karena error.
 *
 * [B6] Caller WAJIB memeriksa nilai ini. Sebelumnya caller selalu mengirim
 * `done: true` setelah reader selesai — termasuk sesudah error — sehingga teks
 * parsial muncul di bawah bubble error dan status error langsung tertimpa 'idle'.
 */
async function readSSEStream(
  res: Response,
  abortSignal: AbortSignal,
  onLine: (line: string) => void,
  onChunk: (chunk: StreamChunk) => void
): Promise<boolean> {
  if (!res.body) {
    onChunk({ text: '', done: true, error: 'Response body kosong — koneksi terputus', errorKind: 'network' })
    return true
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let cleanEnd = false

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) { cleanEnd = true; break }
      if (abortSignal.aborted) { await reader.cancel(); break }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      // [L6] Sebelumnya hanya `releaseLock()` di finally — melepas reader
      // TANPA membatalkan stream yang mendasarinya, jadi body response
      // ditinggalkan begitu saja alih-alih benar-benar ditutup. `cancel()`
      // dulu supaya koneksi/socket yang mendasarinya benar-benar dilepas.
      try { await reader.cancel() } catch {}
      onChunk({ text: '', done: true, error: describeNetworkError(e), errorKind: 'network' })
      return true
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }

  // [Bug #11+#23] Hanya di jalur berakhir BERSIH (bukan abort/error): baris
  // terakhir yang tersisa di buffer (data: tanpa newline penutup — SSE tidak
  // menjamin ini) dan sisa byte yang tertunda di decoder (karakter multi-byte
  // yang terbelah tepat di batas paket terakhir, sebelumnya muncul sebagai
  // U+FFFD) sekarang ikut diproses, bukan dibuang diam-diam.
  if (cleanEnd) {
    buffer += decoder.decode()
    if (buffer) onLine(buffer)
  }

  return false
}

function describeNetworkError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  if (/terminated|ECONNRESET|socket hang up/i.test(msg)) {
    return 'Koneksi ke provider terputus di tengah jalan'
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
    return 'Tidak bisa menghubungi provider — periksa koneksi internet'
  }
  return msg
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function streamGemini(opts: ProviderStreamOptions): Promise<void> {
  const { apiKey, model, messages, systemPrompt, onChunk, abortSignal, maxOutputTokens } = opts

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`

  const contents = enforceAlternatingRoles(messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  })))

  if (contents.length === 0) {
    onChunk({ text: '', done: true, error: 'Tidak ada pesan valid untuk dikirim ke AI.' })
    return
  }

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens, topK: 40, topP: 0.95 },
    // [L6] Sebelumnya hanya 2 dari 4 kategori standar diset — materi belajar
    // yang menyentuh SEXUALLY_EXPLICIT (mis. biologi/kesehatan) atau
    // DANGEROUS_CONTENT (mis. kimia) tetap kena threshold default provider,
    // jadi describeBlockReason bisa terpicu tidak konsisten tergantung
    // kategori mana yang kebetulan diset. CIVIC_INTEGRITY sengaja TIDAK
    // ditambahkan — kategori itu lebih baru dan aksesnya lebih terbatas,
    // menyertakannya berisiko membuat SELURUH request Gemini gagal (400)
    // untuk key yang tidak diizinkan mengubah threshold kategori ini.
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  }

  let res: Response
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body:    JSON.stringify(body),
      signal:  abortSignal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') { onChunk({ text: '', done: true }); return }
    onChunk({ text: '', done: true, error: describeNetworkError(e), errorKind: 'network' })
    return
  }

  if (!res.ok) {
    onChunk({ text: '', done: true, ...(await describeHttpError(res, model)) })
    return
  }

  // [Celah 4] Error kuota/rate-limit tidak selalu datang sebagai HTTP non-200 —
  // Gemini bisa membalas 200 lalu mengirim `{"error": {...}}` di TENGAH SSE
  // setelah sebagian teks sudah mengalir. `readSSEStream` sebelumnya hanya
  // membaca field teks dan mengabaikan objek error ini sepenuhnya, sehingga
  // stream terlihat "selesai normal" padahal sebenarnya gagal.
  let streamErrored = false
  // [Celah 5] Respons yang diblokir filter keamanan tidak mengirim teks maupun
  // error HTTP — tanpa ini user melihat bubble kosong tanpa penjelasan.
  let gotText = false
  let blockReason: string | null = null
  let finishReason: string | null = null

  const errored = await readSSEStream(res, abortSignal, (line) => {
    if (streamErrored) return
    if (!line.startsWith('data: ')) return
    const jsonStr = line.slice(6).trim()
    if (!jsonStr || jsonStr === '[DONE]') return
    try {
      const parsed = JSON.parse(jsonStr)

      if (parsed?.error) {
        streamErrored = true
        onChunk({ text: '', done: true, ...mapProviderError(parsed.error.code, parsed.error.message ?? '', model) })
        return
      }

      const candidate = parsed?.candidates?.[0]
      // [C3] Sebelumnya `finishReason` HANYA direkam kalau bukan 'STOP' — jadi
      // kandidat yang selesai normal (STOP) tapi kosong TANPA teks lolos tanpa
      // jejak sama sekali (blockReason null, finishReason null), dan guard di
      // bawah tidak pernah terpicu. Sekarang direkam apa adanya; 'STOP' dengan
      // teks kosong ditangani lewat pesan generik di describeBlockReason.
      if (candidate?.finishReason) finishReason = candidate.finishReason
      if (parsed?.promptFeedback?.blockReason) blockReason = parsed.promptFeedback.blockReason

      // [Bug #8] Gabungkan SEMUA part, bukan cuma parts[0] — Gemini bisa sah
      // mengembalikan beberapa part dalam satu candidate; sebelumnya sisanya
      // dibuang tanpa jejak dan user melihat jawaban terpotong tanpa tanda apa pun.
      const parts: { text?: string }[] = candidate?.content?.parts ?? []
      const text = parts.map(p => p.text ?? '').join('')
      if (text) { gotText = true; onChunk({ text, done: false }) }

      // [Bug #9] Penanda dikirim SETELAH teks candidate yang sama, bukan
      // sebelumnya — dulu penanda nyempil di TENGAH jawaban karena teksnya
      // sendiri baru menyusul lewat onChunk di atas. Jalur OpenAI di bawah
      // sudah urut teks-dulu-baru-penanda; ini menyamakannya.
      if (candidate?.finishReason === 'MAX_TOKENS') {
        onChunk({ text: '\n\n[Respons terpotong — output token limit tercapai]', done: false })
      }
    } catch {
      // Chunk SSE tidak utuh — abaikan baris ini, jangan cetak isinya ke log
    }
  }, onChunk)

  // [B6] Jangan tumpuk `done` di atas error — errornya sudah dikirim reader
  if (errored || streamErrored) return

  // [C3] Sebelumnya guard ini butuh blockReason ATAU finishReason (bukan
  // MAX_TOKENS) supaya error terkirim — jadi kandidat yang selesai 'STOP'
  // tapi nol teks (finishReason jadi null karena difilter di atas) lolos
  // sebagai `done: true` polos tanpa teks maupun error. MAX_TOKENS tetap
  // dikecualikan karena penanda "[Respons terpotong...]" sudah dikirim
  // sebagai teks penjelas di atas.
  if (!gotText && finishReason !== 'MAX_TOKENS') {
    onChunk({ text: '', done: true, error: describeBlockReason(blockReason, finishReason), errorKind: 'input' })
    return
  }

  onChunk({ text: '', done: true })
}

function describeBlockReason(blockReason: string | null, finishReason: string | null): string {
  const reason = blockReason || finishReason
  // Selesai normal (atau tanpa alasan sama sekali) tapi nol teks — bukan
  // pemblokiran, provider memang tidak menghasilkan apa-apa.
  if (!reason || reason === 'STOP') {
    return 'Provider tidak mengembalikan teks apa pun untuk permintaan ini. Coba lagi atau ubah pertanyaanmu.'
  }
  const labels: Record<string, string> = {
    SAFETY:                       'diblokir oleh filter keamanan Gemini',
    RECITATION:                   'diblokir karena terdeteksi mengutip konten berhak cipta',
    PROHIBITED_CONTENT:           'diblokir karena konten yang diminta melanggar kebijakan Gemini',
    SPII:                         'diblokir karena terdeteksi informasi pribadi sensitif',
    OTHER:                        'diblokir oleh provider (alasan tidak dirinci)',
    BLOCKED_REASON_UNSPECIFIED:   'diblokir oleh provider (alasan tidak dirinci)',
  }
  const desc = labels[reason] ?? `dihentikan oleh provider (${reason})`
  return `Respons ${desc}. Coba ubah pertanyaanmu.`
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

async function streamOpenAI(opts: ProviderStreamOptions): Promise<void> {
  const { apiKey, model, messages, systemPrompt, onChunk, abortSignal, maxOutputTokens } = opts

  // [Celah 1a] Model o-series (o1/o3/o4-mini, dst) menolak permintaan yang
  // memakai `max_tokens`/`temperature` kustom — wajib `max_completion_tokens`
  // tanpa `temperature`. Tanpa ini, model yang ditawarkan dropdown (karena
  // memang ada di GET /v1/models key ini) selalu gagal saat benar-benar dipakai.
  //
  // [M3] Perbaikan di atas tadinya hanya menyentuh max_tokens/temperature —
  // role pesan instruksi masih dikirim sebagai 'system', padahal keluarga
  // o-series menolaknya dan mengharapkan 'developer'. Model yang lolos
  // dropdown (karena memang muncul di GET /v1/models) tetap gagal di
  // permintaan pertama tanpa ini.
  const isOSeries = /^o\d/.test(model)
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [{ role: isOSeries ? 'developer' : 'system', content: systemPrompt }, ...messages],
  }
  if (isOSeries) {
    // [M3] `max_completion_tokens` ikut menghitung reasoning token yang tidak
    // terlihat user — dengan default kecil (mis. 2048), seluruh anggaran bisa
    // habis untuk reasoning sebelum satu token jawaban pun keluar, dan respons
    // berakhir sebagai `finish_reason: 'length'` dengan teks kosong. Beri
    // headroom di atas permintaan output user, dengan lantai yang wajar untuk
    // reasoning minimal.
    body.max_completion_tokens = Math.max(maxOutputTokens + 4096, 8192)
  } else {
    body.max_tokens = maxOutputTokens
    body.temperature = 0.7
  }

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body:    JSON.stringify(body),
      signal:  abortSignal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') { onChunk({ text: '', done: true }); return }
    onChunk({ text: '', done: true, error: describeNetworkError(e), errorKind: 'network' })
    return
  }

  if (!res.ok) {
    onChunk({ text: '', done: true, ...(await describeHttpError(res, model)) })
    return
  }

  // [Celah 4] Sama seperti Gemini — error kuota bisa datang sebagai payload
  // `{"error": {...}}` di tengah SSE, bukan cuma lewat status HTTP non-200.
  let streamErrored = false
  // [C3] OpenAI sebelumnya TIDAK PUNYA guard sama sekali untuk stream yang
  // "selesai" tanpa satu token teks pun (mis. o-series yang menghabiskan
  // seluruh `max_completion_tokens` untuk reasoning tersembunyi lalu berhenti
  // dengan delta kosong) — `done: true` polos terkirim dan user tidak melihat
  // apa pun, tanpa error, tanpa penjelasan.
  let gotText = false
  let truncated = false

  const errored = await readSSEStream(res, abortSignal, (line) => {
    if (streamErrored) return
    if (!line.startsWith('data: ')) return
    const jsonStr = line.slice(6).trim()
    if (!jsonStr || jsonStr === '[DONE]') return
    try {
      const parsed = JSON.parse(jsonStr)

      if (parsed?.error) {
        streamErrored = true
        onChunk({
          text: '', done: true,
          ...mapProviderError(openaiErrorToStatus(parsed.error), parsed.error.message ?? '', model),
        })
        return
      }

      const text: string = parsed?.choices?.[0]?.delta?.content ?? ''
      if (text) { gotText = true; onChunk({ text, done: false }) }
      if (parsed?.choices?.[0]?.finish_reason === 'length') {
        truncated = true
        onChunk({ text: '\n\n[Respons terpotong — output token limit tercapai]', done: false })
      }
    } catch {
      // Chunk SSE tidak utuh — abaikan baris ini
    }
  }, onChunk)

  // [B6] Jangan tumpuk `done` di atas error — errornya sudah dikirim reader
  if (errored || streamErrored) return

  // [C3] `truncated` dikecualikan sama seperti MAX_TOKENS di Gemini — penanda
  // "[Respons terpotong...]" sudah menjelaskan kenapa kosong, jadi tidak perlu
  // error kedua di atasnya.
  if (!gotText && !truncated) {
    onChunk({
      text: '', done: true, errorKind: 'input',
      error: 'Provider tidak mengembalikan teks apa pun untuk permintaan ini. Coba lagi atau ubah pertanyaanmu.',
    })
    return
  }

  onChunk({ text: '', done: true })
}

// OpenAI mengirim error mid-stream sebagai `{ type, code, message }` tanpa
// status HTTP numerik — dipetakan ke status setara supaya bisa lewat
// `mapProviderError` yang sama dengan jalur non-stream.
function openaiErrorToStatus(err: { type?: string; code?: string; message?: string }): number {
  const type = String(err?.type ?? '')
  const code = String(err?.code ?? '')
  if (/insufficient_quota|rate_limit/i.test(type) || /insufficient_quota|rate_limit/i.test(code)) return 429
  if (/invalid_api_key|authentication/i.test(type) || /invalid_api_key/i.test(code)) return 401
  if (/server_error/i.test(type)) return 500
  return 400
}

// ─── Pemetaan error HTTP ─────────────────────────────────────────────────────
// [Celah 4] Diekstrak dari bekas isi `describeHttpError` supaya jalur error
// HTTP biasa (sebelum stream terbuka) dan error mid-stream (dalam payload SSE,
// lihat streamGemini/streamOpenAI di atas) memakai satu tabel pemetaan yang sama.

function mapProviderError(status: number, providerMsg: string, model: string): { error: string; errorKind: ErrorKind } {
  if (status === 401 || status === 403) {
    return { error: `API key ditolak provider (HTTP ${status}). Periksa key di Pengaturan.`, errorKind: 'auth' }
  }
  if (status === 429) {
    return {
      error: providerMsg
        ? `Kuota atau rate limit habis (HTTP 429): ${providerMsg}`
        : 'Kuota atau rate limit habis (HTTP 429). Tunggu sebentar sebelum mencoba lagi.',
      errorKind: 'quota',
    }
  }
  if (status >= 500) {
    return { error: `Server provider sedang bermasalah (HTTP ${status}). Coba lagi nanti.`, errorKind: 'server' }
  }
  if (status === 400 && /token|context_length/i.test(providerMsg)) {
    return {
      error: `Input terlalu panjang untuk model ${model}. Bersihkan riwayat chat atau matikan konteks file.`,
      errorKind: 'input',
    }
  }
  return { error: providerMsg || (status ? `HTTP ${status}` : 'Provider mengembalikan error tanpa detail'), errorKind: 'other' }
}

export async function describeHttpError(
  res: Response,
  model: string
): Promise<{ error: string; errorKind: ErrorKind }> {
  let providerMsg = ''
  try {
    const data = await res.json() as any
    providerMsg = data?.error?.message ?? ''
  } catch {
    // Body error bukan JSON — cukup pakai status code
  }
  return mapProviderError(res.status, providerMsg, model)
}

// ─── Router ──────────────────────────────────────────────────────────────────

export async function streamAI(opts: ProviderStreamOptions): Promise<void> {
  const { model } = opts
  const provider = providerOf(model)
  if (provider === 'gemini') return streamGemini(opts)
  if (provider === 'openai') return streamOpenAI(opts)

  opts.onChunk({
    text: '', done: true, errorKind: 'other',
    error: `Model tidak dikenali: "${model}". Periksa pengaturan provider.`,
  })
}

// ─── Daftar model dari provider (bukan hardcode) ─────────────────────────────
// [Aturan 1] Daftar model WAJIB berasal dari endpoint resmi provider memakai key
// yang sedang aktif. [Aturan 3] Kegagalan dilaporkan jelas, tidak fallback diam-diam.

export type ListModelsResult =
  | { valid: true; models: string[]; limits: Record<string, number> }
  | { valid: false; error: string; errorKind: ErrorKind }

async function fetchWithTimeout(url: string, init: RequestInit, ms = 12_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function describeListError(res: Response, provider: string): Promise<{ error: string; errorKind: ErrorKind }> {
  let detail = ''
  try { detail = ((await res.json()) as any)?.error?.message ?? '' } catch {}
  if (res.status === 401 || res.status === 403) {
    return { error: `API key ${provider} ditolak (HTTP ${res.status}). Periksa kembali key-nya.`, errorKind: 'auth' }
  }
  if (res.status === 429) {
    return { error: `Kuota/rate limit ${provider} sedang habis (HTTP 429). Tunggu sebentar lalu coba lagi.`, errorKind: 'quota' }
  }
  if (res.status >= 500) {
    return { error: `Server ${provider} sedang bermasalah (HTTP ${res.status}).`, errorKind: 'server' }
  }
  return { error: detail || `HTTP ${res.status}`, errorKind: 'other' }
}

export async function listGeminiModels(key: string): Promise<ListModelsResult> {
  const models: string[] = []
  const limits: Record<string, number> = {}
  let pageToken: string | undefined

  try {
    // [B18] Sebelumnya tanpa paginasi — sebagian model bisa tidak pernah muncul
    for (let page = 0; page < 10; page++) {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
      url.searchParams.set('pageSize', '200')
      if (pageToken) url.searchParams.set('pageToken', pageToken)

      const res = await fetchWithTimeout(url.toString(), { headers: { 'x-goog-api-key': key } })
      if (!res.ok) return { valid: false, ...(await describeListError(res, 'Gemini')) }

      const data = await res.json() as any
      for (const m of data.models ?? []) {
        const name = String(m?.name ?? '').replace(/^models\//, '')
        if (!name) continue
        // Kunci aturan 1: hanya model yang benar-benar bisa dipakai untuk chat.
        // Ini yang dulu bikin dropdown menawarkan model yang gagal saat dipakai.
        // [L6] App ini memanggil `:streamGenerateContent` (lihat streamGemini
        // di atas), tapi filter di sini hanya mengecek 'generateContent' —
        // kalau provider suatu saat mengiklankan model yang HANYA mendaftarkan
        // 'streamGenerateContent' (bukan 'generateContent'), model itu akan
        // salah tersaring padahal sebenarnya bisa dipakai lewat jalur app ini.
        const methods: string[] = m?.supportedGenerationMethods ?? []
        if (methods.length > 0 && !methods.includes('generateContent') && !methods.includes('streamGenerateContent')) continue
        // [Celah 1c] `generateContent` juga didukung model TTS/audio/image/live —
        // secara teknis "bisa generateContent" tapi bukan model chat teks biasa,
        // dan pasti gagal dipakai lewat jalur streaming teks yang ada di app ini.
        if (!isStreamableModel(name)) continue
        models.push(name)
        // [B11] Batas input yang terverifikasi dari provider, bukan tabel hardcode
        if (typeof m?.inputTokenLimit === 'number' && m.inputTokenLimit > 0) {
          limits[name] = m.inputTokenLimit
        }
      }
      pageToken = data.nextPageToken
      if (!pageToken) break
    }
    return { valid: true, models, limits }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { valid: false, error: 'Timeout saat menghubungi Gemini — periksa koneksi internet', errorKind: 'network' }
    }
    return { valid: false, error: describeNetworkError(e), errorKind: 'network' }
  }
}

export async function listOpenAIModels(key: string): Promise<ListModelsResult> {
  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return { valid: false, ...(await describeListError(res, 'OpenAI')) }

    const data = await res.json() as any
    // [Celah 1a] Pemfilteran dipusatkan lewat `isStreamableModel` (src/lib/providers.ts)
    // supaya daftar yang dikembalikan sudah pasti sama dengan yang dikenali router
    // streaming — mencakup o-series tanpa perlu menghardcode "o1|o3|o4" di sini.
    const models = (data?.data ?? [])
      .map((m: any) => String(m?.id ?? ''))
      .filter((id: string) => isStreamableModel(id))
      .sort((a: string, b: string) => a.localeCompare(b))

    // Catatan jujur: endpoint /v1/models OpenAI tidak mengembalikan context window,
    // jadi `limits` kosong dan perhitungan token memakai tabel cadangan.
    return { valid: true, models, limits: {} }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { valid: false, error: 'Timeout saat menghubungi OpenAI — periksa koneksi internet', errorKind: 'network' }
    }
    return { valid: false, error: describeNetworkError(e), errorKind: 'network' }
  }
}
