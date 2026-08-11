// src/lib/providers.ts — satu sumber kebenaran untuk pemetaan model → provider.
//
// [Aturan 2] Sebelumnya `providerOf` di electron/aiProvider.ts dan pre-check key
// di src/store/useStore.ts adalah dua implementasi terpisah yang bisa saling
// menyimpang (mis. `useStore` tidak mengenali model o-series OpenAI sama sekali).
// Dipindah ke sini supaya main process dan renderer selalu sepakat.

export type Provider = 'gemini' | 'openai' | 'unknown'

export function providerOf(model: string): Provider {
  if (model.startsWith('gemini')) return 'gemini'
  // o-series (o1, o3, o4-mini, dst) tidak diawali "gpt" tapi tetap OpenAI.
  // [L4] "chatgpt-4o-latest" dan "codex-*" juga model chat-completions OpenAI
  // yang sah dari GET /v1/models — sebelumnya tidak dikenali sama sekali,
  // jadi hilang dari dropdown dan (lewat selectActiveModelMissing) salah
  // dilaporkan "tidak tersedia untuk key ini" kalau terlanjur dipilih. Kelas
  // bug yang sama dengan [Bug #24] untuk model "search", prefix berbeda.
  if (model.startsWith('gpt') || model.startsWith('chatgpt') || model.startsWith('codex') || /^o\d/.test(model)) return 'openai'
  return 'unknown'
}

// Nama model yang menandakan bukan model chat teks biasa (TTS, audio, image,
// embedding, dll). Dipakai untuk menyaring hasil ListModels/GET /v1/models
// supaya dropdown tidak menawarkan model yang pasti gagal dipakai untuk chat.
//
// [Bug #24] `search` DIKELUARKAN dari daftar ini — gpt-4o-search-preview dan
// gpt-4o-mini-search-preview adalah model chat-completions yang sah (web
// search bawaan, tetap lewat endpoint chat biasa), bukan model non-chat.
// Sebelumnya keduanya hilang dari dropdown dan, lewat selectActiveModelMissing,
// salah dilaporkan "tidak tersedia untuk key ini" kalau terlanjur dipilih.
// `instruct` DIPERTAHANKAN — gpt-3.5-turbo-instruct memang bukan model chat.
const NON_CHAT_PATTERN = /embedding|vision|aqa|tts|audio|image|imagen|veo|live|learnlm|moderation|whisper|dall-e|realtime|transcribe|instruct/i

export function isStreamableModel(model: string): boolean {
  const provider = providerOf(model)
  if (provider !== 'gemini' && provider !== 'openai') return false
  return !NON_CHAT_PATTERN.test(model)
}

// [M4/M5] Perbandingan versi Gemini yang benar (numerik, bukan substring
// hardcode "2.0"/"1.5") — dipakai renderer (urutan dropdown Pengaturan) DAN
// main process (auto-koreksi active_model saat startup di electron/main.ts)
// supaya keduanya selalu sepakat model mana yang "terbaik" untuk provider
// yang sama, tanpa duplikasi logika yang bisa saling menyimpang.
function parseGeminiVersion(model: string): { raw: string; num: number } | null {
  const m = model.match(/^gemini-(\d+(?:\.\d+)?)/)
  return m ? { raw: m[1], num: parseFloat(m[1]) } : null
}

function geminiTierScore(s: string): number {
  let n = 0
  if (!s.includes('preview') && !s.includes('tts') && !s.includes('audio') && !s.includes('image') && !s.includes('native')) n += 10
  if (s.includes('flash') && !s.includes('lite')) n += 4
  else if (s.includes('pro')) n += 3
  else if (s.includes('flash-lite')) n += 2
  return n
}

/** Urutkan model untuk tampilan: versi Gemini terbaru dulu, lalu tier dalam versi yang sama. */
export function sortModelsForDisplay(models: string[]): string[] {
  return [...models].sort((a, b) => {
    const versionDiff = (parseGeminiVersion(b)?.num ?? 0) - (parseGeminiVersion(a)?.num ?? 0)
    if (versionDiff !== 0) return versionDiff
    return geminiTierScore(b) - geminiTierScore(a)
  })
}

/** Kelompokkan model per versi Gemini (mis. "Gemini 2.5"), model non-Gemini masuk "Lainnya". */
export function groupModelsByVersion(models: string[]): { label: string; models: string[] }[] {
  const order: number[] = []
  const labels = new Map<number, string>()
  const items = new Map<number, string[]>()
  const others: string[] = []

  for (const m of models) {
    const version = parseGeminiVersion(m)
    if (!version) { others.push(m); continue }
    if (!items.has(version.num)) {
      order.push(version.num)
      labels.set(version.num, `Gemini ${version.raw}`)
      items.set(version.num, [])
    }
    items.get(version.num)!.push(m)
  }

  // Caller diharapkan sudah memanggil sortModelsForDisplay lebih dulu, jadi
  // urutan kemunculan grup di atas SUDAH versi-menurun.
  const result = order.map(num => ({ label: labels.get(num)!, models: items.get(num)! }))
  if (others.length > 0) result.push({ label: 'Lainnya', models: others })
  return result
}
