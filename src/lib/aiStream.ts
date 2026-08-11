// src/lib/aiStream.ts — utilitas anggaran token untuk renderer.
//
// [S2] Pemanggilan provider AI SUDAH TIDAK ada di sini lagi. Semua fetch ke
// Gemini/OpenAI dipindah ke main process (`electron/aiProvider.ts`) supaya API key
// tidak pernah masuk ke memori renderer maupun terlihat di Network tab DevTools.
// Yang tersisa di file ini murni perhitungan — tidak menyentuh jaringan.

import { providerOf } from './providers'

// ─── Token Budget Utilities ───────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Batas input per model.
 *
 * [B11] Ini HANYA cadangan untuk saat daftar model belum sempat diambil dari
 * provider. Sumber kebenaran yang sebenarnya adalah `inputTokenLimit` yang
 * dikembalikan endpoint ListModels — lihat `resolveInputLimit` di bawah.
 */
export const FALLBACK_INPUT_LIMITS: Record<string, number> = {
  'gemini-2.0-flash':   1_048_576,
  'gemini-1.5-flash':   1_048_576,
  'gemini-1.5-pro':     2_097_152,
  'gpt-4o':               128_000,
  'gpt-4o-mini':          128_000,
  'gpt-4-turbo':          128_000,
  'gpt-3.5-turbo':         16_385,
  'gpt-4.1':            1_047_576,
  'gpt-4.1-mini':       1_047_576,
  'gpt-4.1-nano':       1_047_576,
  'o1':                   200_000,
  'o1-mini':              128_000,
  'o1-preview':           128_000,
  'o3':                   200_000,
  'o3-mini':              200_000,
  'o4-mini':              200_000,
}

// [M2] `GET /v1/models` OpenAI TIDAK mengembalikan context window sama sekali
// (lihat listOpenAIModels di electron/aiProvider.ts) — jadi model apa pun di
// luar tabel EXACT di atas, termasuk varian bertanggal seperti
// "gpt-4.1-2025-04-14" atau "o3-mini-2025-01-31", sebelumnya jatuh langsung ke
// DEFAULT_INPUT_LIMIT (32k), jauh lebih kecil dari context window sebenarnya.
// Dicocokkan dari prefix PALING SPESIFIK ke paling umum supaya "o1-mini"
// tidak salah kena aturan "o1" yang lebih pendek.
const FALLBACK_PREFIX_LIMITS: [string, number][] = [
  ['o1-mini',       128_000],
  ['o1-preview',    128_000],
  ['o1',            200_000],
  ['o3-mini',       200_000],
  ['o3',            200_000],
  ['o4-mini',       200_000],
  ['gpt-4.1',     1_047_576],
  ['gpt-4o',        128_000],
  ['gpt-4-turbo',   128_000],
  ['gpt-3.5-turbo',  16_385],
]

const DEFAULT_INPUT_LIMIT = 32_000
// [M2] Model OpenAI modern nyaris selalu >=128k konteks. Default 32k yang
// sama untuk semua provider terlalu agresif memangkas riwayat untuk model
// OpenAI yang tidak dikenali tabel maupun prefix di atas sama sekali.
const DEFAULT_OPENAI_INPUT_LIMIT = 128_000

/**
 * Batas input efektif untuk sebuah model.
 * Prioritas: nilai terverifikasi dari provider → tabel cadangan (exact →
 * prefix) → default konservatif (per-provider).
 */
export function resolveInputLimit(
  model: string,
  verifiedLimits?: Record<string, number> | null
): number {
  const verified = verifiedLimits?.[model]
  if (typeof verified === 'number' && verified > 0) return verified
  if (FALLBACK_INPUT_LIMITS[model]) return FALLBACK_INPUT_LIMITS[model]
  const prefixMatch = FALLBACK_PREFIX_LIMITS.find(([prefix]) => model.startsWith(prefix))
  if (prefixMatch) return prefixMatch[1]
  return providerOf(model) === 'openai' ? DEFAULT_OPENAI_INPUT_LIMIT : DEFAULT_INPUT_LIMIT
}

export function buildSafeMessages(
  history: { role: string; content: string }[],
  systemPrompt: string,
  maxOutputTokens: number,
  model: string,
  verifiedLimits?: Record<string, number> | null
): {
  safeMessages: { role: string; content: string }[]
  trimmedCount: number
  estimatedInputTokens: number
} {
  const inputLimit   = resolveInputLimit(model, verifiedLimits)
  const hardBudget   = Math.floor(inputLimit * 0.9) - maxOutputTokens
  const systemTokens = estimateTokens(systemPrompt)

  // Budget terlalu kecil — kembalikan minimal 1 pesan user terakhir
  if (hardBudget - systemTokens <= 0) {
    const last = [...history].reverse().find(m => m.role === 'user') ?? history[history.length - 1]
    return {
      safeMessages: last ? [last] : [],
      trimmedCount: history.length - (last ? 1 : 0),
      estimatedInputTokens: systemTokens + estimateTokens(last?.content ?? ''),
    }
  }

  let budget = hardBudget - systemTokens
  const safeMessages: { role: string; content: string }[] = []
  let trimmedCount = 0

  // Iterasi dari belakang — pesan terbaru diprioritaskan
  for (let i = history.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(history[i].content)
    // [Bug #12] `break`, bukan `continue` — "pesan terbaru diprioritaskan"
    // berarti potongan yang disertakan harus BERURUTAN dari belakang. `continue`
    // sebelumnya melompati satu pesan yang kebetulan terlalu besar lalu tetap
    // menyertakan pesan-pesan yang LEBIH TUA lagi di baliknya, membuat riwayat
    // berlubang di tengah — giliran assistant bisa terkirim tanpa giliran user
    // yang memicunya. Semua pesan dari sini ke belakang (indeks 0..i) dianggap
    // terpangkas sekaligus.
    if (budget - tokens < 0) { trimmedCount += i + 1; break }
    safeMessages.unshift(history[i])
    budget -= tokens
  }

  if (safeMessages.length === 0 && history.length > 0) {
    safeMessages.push(history[history.length - 1])
    trimmedCount = history.length - 1
  }

  // Setelah pemotongan dari depan, array bisa dimulai dengan 'assistant'.
  // Gemini WAJIB dimulai dengan 'user' — buang dari depan sampai ketemu 'user'.
  const firstUserIdx = safeMessages.findIndex(m => m.role === 'user')
  const cleanMessages = firstUserIdx > 0 ? safeMessages.slice(firstUserIdx) : safeMessages

  const totalDropped      = history.length - cleanMessages.length
  const finalTrimmedCount = Math.max(trimmedCount, totalDropped)

  const estimatedInputTokens = systemTokens + cleanMessages.reduce(
    (sum, m) => sum + estimateTokens(m.content), 0
  )

  return { safeMessages: cleanMessages, trimmedCount: finalTrimmedCount, estimatedInputTokens }
}
