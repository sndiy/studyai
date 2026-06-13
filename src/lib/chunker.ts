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
const MAX_TOKENS_PER_CHUNK = 2000
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
    } else {
      // Simpan chunk saat ini jika ada isi
      if (current.trim()) {
        chunks.push({
          index: chunkIndex++,
          text: current.trim(),
          tokenEstimate: Math.ceil(current.length / CHARS_PER_TOKEN)
        })

        // Overlap: ambil ~10% terakhir dari chunk sebelumnya sebagai konteks awal chunk berikut
        const overlapLength = Math.floor(current.length * OVERLAP_RATIO)
        const overlap = current.slice(-overlapLength)
        current = overlap ? overlap + '\n\n' + para : para
      } else {
        // Paragraf single yang lebih besar dari limit — paksa potong per kalimat
        const sentences = para.match(/[^.!?]+[.!?]+/g) ?? [para]
        for (const sentence of sentences) {
          const sc = current ? current + ' ' + sentence : sentence
          if (sc.length <= MAX_CHARS_PER_CHUNK) {
            current = sc
          } else {
            if (current.trim()) {
              chunks.push({
                index: chunkIndex++,
                text: current.trim(),
                tokenEstimate: Math.ceil(current.length / CHARS_PER_TOKEN)
              })
            }
            current = sentence
          }
        }
      }
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
 * Simple TF-based scoring — tidak perlu vector DB untuk skala ini.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function selectRelevantChunks(chunks: Chunk[], query: string, maxChunks = 3): Chunk[] {
  if (chunks.length <= maxChunks) return chunks

  const queryWords = query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)

  const scored = chunks.map(chunk => {
    const lower = chunk.text.toLowerCase()
    let score = 0
    for (const word of queryWords) {
      // Count occurrences — escape special regex chars to prevent crash
      const matches = (lower.match(new RegExp(escapeRegExp(word), 'g')) ?? []).length
      score += matches
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
