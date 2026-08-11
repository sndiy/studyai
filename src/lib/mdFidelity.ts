// src/lib/mdFidelity.ts — jaring pengaman untuk Bug #1.
//
// StarterKit v3 (Tiptap) tidak memaketkan node untuk setiap konstruksi
// markdown yang bisa dihasilkan `marked` (tabel/gambar/task-list ditambal
// lewat extension terpisah — lihat Editor.tsx). Tapi menambal yang SUDAH
// diketahui tidak menutup celah untuk konstruksi yang BELUM diketahui:
// apa pun yang schema editor tidak kenal akan tetap hilang diam-diam saat
// `onUpdate` menulis balik `editor.getHTML()` yang sudah telanjur bersih.
//
// Ini bukan validator markdown — cuma pembanding "sidik" sebelum vs sesudah
// round-trip lewat editor. Kalau sidiknya berkurang, sesuatu hilang.

export interface MdFingerprint {
  images:     number
  tableRows:  number
  taskItems:  number
  headings:   number
  codeFences: number
  listItems:  number
}

const STRUCTURAL_LABELS: Record<keyof MdFingerprint, string> = {
  images:     'gambar',
  tableRows:  'baris tabel',
  taskItems:  'task item',
  headings:   'heading',
  codeFences: 'blok kode',
  listItems:  'item list',
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length
}

export function fingerprint(md: string): MdFingerprint {
  // Isi code block dikeluarkan dulu — teksnya bisa memuat karakter yang
  // kebetulan cocok dengan pola lain di bawah (mis. baris `| a | b |` di
  // dalam contoh kode bukan baris tabel sungguhan).
  const withoutCode = md.replace(/```[\s\S]*?```/g, '\n')

  return {
    images:     countMatches(withoutCode, /!\[[^\]]*\]\([^)]*\)/g),
    tableRows:  countMatches(withoutCode, /^\s*\|.*\|\s*$/gm),
    taskItems:  countMatches(withoutCode, /^\s*[-*+]\s+\[[ xX]\]/gm),
    headings:   countMatches(withoutCode, /^#{1,6}\s+\S/gm),
    codeFences: countMatches(md, /^```/gm),
    listItems:  countMatches(withoutCode, /^\s*(?:[-*+]|\d+[.)])\s+\S/gm),
  }
}

function wordBag(text: string): Map<string, number> {
  const bag = new Map<string, number>()
  for (const w of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const k = w.toLowerCase()
    bag.set(k, (bag.get(k) ?? 0) + 1)
  }
  return bag
}

/** Fraksi kata dari `original` yang tidak muncul (cukup sering) di `roundTripped`. Order-insensitive
 *  dengan sengaja — turndown boleh menata ulang, yang tidak boleh adalah MEMBUANG. */
function missingWordFraction(original: string, roundTripped: string): number {
  const originalBag = wordBag(original)
  let total = 0
  let missing = 0
  const rtBag = wordBag(roundTripped)
  for (const [word, count] of originalBag) {
    total += count
    const have = rtBag.get(word) ?? 0
    if (have < count) missing += count - have
  }
  return total > 0 ? missing / total : 0
}

export interface FidelityResult {
  lossy: boolean
  /** Deskripsi manusiawi tentang apa yang terdeteksi hilang, mis. ["2 gambar", "1 baris tabel"] */
  lost: string[]
}

// Sedikit slack untuk perbedaan wajar (mis. entity HTML, spasi) — bukan 0%.
const TEXT_LOSS_THRESHOLD = 0.08

export function compareFidelity(original: string, roundTripped: string): FidelityResult {
  const a = fingerprint(original)
  const b = fingerprint(roundTripped)
  const lost: string[] = []

  for (const key of Object.keys(STRUCTURAL_LABELS) as (keyof MdFingerprint)[]) {
    const diff = a[key] - b[key]
    if (diff > 0) lost.push(`${diff} ${STRUCTURAL_LABELS[key]}`)
  }

  const textLossFraction = missingWordFraction(original, roundTripped)
  if (textLossFraction > TEXT_LOSS_THRESHOLD) {
    lost.push(`sebagian teks (~${Math.round(textLossFraction * 100)}% kata)`)
  }

  return { lossy: lost.length > 0, lost }
}
