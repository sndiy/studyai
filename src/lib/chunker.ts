/**
 * Chunker — memecah teks panjang menjadi potongan yang aman untuk dikirim ke AI API.
 * 
 * Strategi:
 * 1. Split berdasarkan paragraf (lebih natural dari character-based)
 * 2. Setiap chunk max ~2000 token (estimasi: 1 token ≈ 4 karakter)
 * 3. Overlap 10% di setiap chunk agar konteks tidak putus
 * 4. Relevance scoring via keyword matching → pilih chunk paling relevan
 */

const CHARS_PER_TOKEN = 4
export const MAX_TOKENS_PER_CHUNK = 2000
const MAX_CHARS_PER_CHUNK = MAX_TOKENS_PER_CHUNK * CHARS_PER_TOKEN // 8000 chars
const OVERLAP_RATIO = 0.1

export interface Chunk {
  index: number
  text: string
  tokenEstimate: number
}

/**
 * Pecah teks menjadi chunks berdasarkan paragraf dengan overlap.
 */
export function chunkText(text: string): Chunk[] {
  if (!text.trim()) return []

  // Normalize: hapus excessive whitespace, tapi pertahankan struktur paragraf
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Estimasi total token
  const totalTokens = Math.ceil(normalized.length / CHARS_PER_TOKEN)

  // Kalau teks pendek, langsung return 1 chunk
  if (totalTokens <= MAX_TOKENS_PER_CHUNK) {
    return [{
      index: 0,
      text: normalized,
      tokenEstimate: totalTokens
    }]
  }

  // Split per paragraf
  const paragraphs = normalized.split(/\n\n+/).filter(p => p.trim().length > 0)
  const chunks: Chunk[] = []
  let current = ''
  let chunkIndex = 0

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim()
    const candidate = current ? current + '\n\n' + para : para

    if (candidate.length <= MAX_CHARS_PER_CHUNK) {
      current = candidate
      continue
    }

    // [Bug #14] Paragraf ITU SENDIRI melebihi batas — selalu dipecah per
    // kalimat, TIDAK HANYA saat `current` kebetulan kosong. Sebelumnya
    // paragraf raksasa yang menyusul teks lain (current tidak kosong) masuk
    // ke cabang "flush lalu current = overlap + para" TANPA pernah dipecah,
    // jadi satu chunk bisa jauh melampaui MAX_CHARS_PER_CHUNK.
    if (para.length > MAX_CHARS_PER_CHUNK) {
      if (current.trim()) {
        chunks.push({
          index: chunkIndex++,
          text: current.trim(),
          tokenEstimate: Math.ceil(current.length / CHARS_PER_TOKEN)
        })
      }
      current = ''
      // [C1] Alternasi `|[^.!?]+$` menangkap ekor tanpa tanda baca penutup —
      // sebelumnya regex hanya mengenali kalimat yang diakhiri . ! ?, jadi
      // apa pun setelah tanda baca TERAKHIR di paragraf (tabel, transkrip,
      // dump bullet tanpa titik) terbuang diam-diam dan tidak pernah masuk
      // ke chunk manapun. `sentences.join('') === para` sekarang selalu benar.
      const sentences = para.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [para]
      for (const sentence of sentences) {
        const sc = current ? current + ' ' + sentence : sentence
        if (sc.length <= MAX_CHARS_PER_CHUNK) {
          current = sc
          continue
        }
        if (current.trim()) {
          chunks.push({
            index: chunkIndex++,
            text: current.trim(),
            tokenEstimate: Math.ceil(current.length / CHARS_PER_TOKEN)
          })
        }
        // [Bug #14] Satu kalimat yang SENDIRIAN masih melebihi batas (tidak ada
        // tanda baca untuk dipecah lebih halus) dipotong keras per karakter —
        // sebelumnya ditetapkan utuh apa adanya, jadi chunk tetap bisa
        // melampaui MAX_CHARS_PER_CHUNK.
        if (sentence.length > MAX_CHARS_PER_CHUNK) {
          for (let c = 0; c < sentence.length; c += MAX_CHARS_PER_CHUNK) {
            const piece = sentence.slice(c, c + MAX_CHARS_PER_CHUNK)
            chunks.push({
              index: chunkIndex++,
              text: piece.trim(),
              tokenEstimate: Math.ceil(piece.length / CHARS_PER_TOKEN)
            })
          }
          current = ''
        } else {
          current = sentence
        }
      }
      continue
    }

    // Paragraf ini sendiri muat, tapi menambahkannya ke current melebihi batas.
    if (current.trim()) {
      chunks.push({
        index: chunkIndex++,
        text: current.trim(),
        tokenEstimate: Math.ceil(current.length / CHARS_PER_TOKEN)
      })

      // Overlap: ambil ~10% terakhir dari chunk sebelumnya sebagai konteks awal chunk berikut.
      // [Bug #13] `slice(-0) === slice(0)` === SELURUH string ketika overlapLength
      // adalah 0 (chunk pendek, <10 karakter) — alih-alih overlap ~10%, seluruh
      // chunk sebelumnya diduplikasi utuh ke chunk berikutnya.
      const overlapLength = Math.floor(current.length * OVERLAP_RATIO)
      let overlap = overlapLength > 0 ? current.slice(-overlapLength) : ''
      // [L6] `overlap + para` bisa melampaui MAX_CHARS_PER_CHUNK sampai ~10%
      // kalau `para` sendiri sudah mendekati batas — invarian ukuran chunk
      // dilanggar diam-diam. Potong overlap supaya gabungannya tetap muat;
      // buang overlap sama sekali kalau paragrafnya sendiri sudah memenuhi batas.
      const maxOverlapLen = MAX_CHARS_PER_CHUNK - para.length - 2
      if (overlap && overlap.length > maxOverlapLen) {
        overlap = maxOverlapLen > 0 ? overlap.slice(-maxOverlapLen) : ''
      }
      current = overlap ? overlap + '\n\n' + para : para
    } else {
      current = para
    }
  }

  // Flush sisa
  if (current.trim()) {
    chunks.push({
      index: chunkIndex,
      text: current.trim(),
      tokenEstimate: Math.ceil(current.length / CHARS_PER_TOKEN)
    })
  }

  return chunks
}

/**
 * Pilih chunk paling relevan berdasarkan keyword dari pertanyaan user.
 * Simple TF-IDF scoring — tidak perlu vector DB untuk skala ini.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// [C2] Kata umum ID+EN yang HAMPIR SELALU muncul di pertanyaan tapi tidak
// pernah membedakan chunk mana yang relevan. Sebelumnya kata seperti "dalam"
// atau "apa" ikut dihitung sama beratnya dengan istilah teknis, jadi chunk
// yang kebetulan penuh kata umum (bukan yang benar-benar menjawab) bisa
// menang murni karena lebih banyak mengulang kata umum itu.
const STOPWORDS = new Set([
  // Indonesian
  'yang', 'dari', 'untuk', 'dalam', 'dengan', 'pada', 'adalah', 'ini', 'itu',
  'dan', 'atau', 'tidak', 'bisa', 'akan', 'apa', 'apakah', 'siapa', 'kenapa',
  'mengapa', 'bagaimana', 'kapan', 'dimana', 'mana', 'ada', 'sudah', 'belum',
  'masih', 'lebih', 'kurang', 'sangat', 'banyak', 'sedikit', 'semua', 'setiap',
  'beberapa', 'tersebut', 'tanpa', 'hingga', 'sampai', 'sejak', 'agar',
  'supaya', 'namun', 'tetapi', 'bahwa', 'yaitu', 'yakni', 'oleh', 'sebagai',
  'karena', 'jika', 'kalau', 'maka', 'saat', 'ketika', 'antara', 'tentang',
  // English
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are',
  'was', 'were', 'this', 'that', 'these', 'those', 'with', 'from', 'by', 'as',
  'at', 'it', 'its', 'be', 'what', 'how', 'why', 'who', 'when', 'where',
  'which', 'can', 'could', 'would', 'should', 'do', 'does', 'did', 'have',
  'has', 'had', 'not', 'but', 'if', 'then', 'than', 'so', 'about', 'into',
  'over', 'under', 'between', 'also', 'just', 'only', 'more', 'most',
])

function tokenizeQuery(query: string): string[] {
  const raw = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
  const filtered = raw.filter(w => !STOPWORDS.has(w))
  // Kalau SEMUA kata query kebetulan stopword (query pendek/umum), jangan
  // buang semuanya — fallback ke daftar mentah supaya skor tidak nol rata.
  return filtered.length > 0 ? filtered : raw
}

export function selectRelevantChunks(chunks: Chunk[], query: string, maxChunks = 3): Chunk[] {
  if (chunks.length <= maxChunks) return chunks

  const queryWords = tokenizeQuery(query)
  if (queryWords.length === 0) return chunks.slice(0, maxChunks)

  const lowerChunks = chunks.map(c => c.text.toLowerCase())

  // [C2] Document frequency per kata query — dasar bobot IDF di bawah.
  const df = new Map<string, number>()
  for (const word of queryWords) {
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`)
    let count = 0
    for (const lower of lowerChunks) if (re.test(lower)) count++
    df.set(word, count)
  }

  const scored = chunks.map((chunk, i) => {
    const lower = lowerChunks[i]
    let score = 0
    for (const word of queryWords) {
      // [C2] Word boundary (\b) — sebelumnya substring mentah, jadi query
      // "ada" cocok di dalam "kepada", "adalah", "mengadakan".
      const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'g')
      const tf = (lower.match(re) ?? []).length
      if (tf === 0) continue
      // [C2] Bobot IDF: kata yang muncul di SEMUA chunk (df === chunks.length)
      // otomatis bernilai 0 — tidak membedakan apa pun. Kata langka (df kecil)
      // dibobot lebih tinggi karena lebih mungkin jadi penanda chunk yang tepat.
      const idf = Math.log(chunks.length / (df.get(word) ?? 1))
      score += tf * idf
    }
    return { chunk, score }
  })

  // Sort by score descending, ambil top N, lalu sort ulang by index agar urutan natural
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
    .sort((a, b) => a.chunk.index - b.chunk.index)
    .map(s => s.chunk)
}

/**
 * Format chunks menjadi satu string konteks yang siap dilempar ke AI.
 * Kalau multi-chunk, tambahkan label agar AI tahu ini potongan dari dokumen lebih panjang.
 */
export function formatChunksAsContext(chunks: Chunk[], totalChunks: number): string {
  if (chunks.length === 0) return ''
  if (chunks.length === 1 && totalChunks === 1) {
    return chunks[0].text
  }

  return chunks
    .map(c => `[Bagian ${c.index + 1} dari ${totalChunks}]\n${c.text}`)
    .join('\n\n---\n\n')
}
