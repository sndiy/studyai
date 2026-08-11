import TurndownService from 'turndown'
import { tables as turndownTables, taskListItems as turndownTaskListItems } from 'turndown-plugin-gfm'
import { marked } from 'marked'

// [A1] Markdown murni tidak punya sintaks untuk underline, warna teks, highlight,
// maupun perataan teks. Turndown default membuang keempatnya TANPA peringatan,
// jadi format yang dipakai user hilang permanen begitu file disimpan — sementara
// di layar masih terlihat utuh selama sesi berjalan.
//
// HTML inline di dalam Markdown itu legal, marked meneruskannya apa adanya, dan
// TipTap bisa mem-parsing-nya kembali menjadi mark yang sama. Jadi keempat node
// ini dipertahankan sebagai HTML alih-alih dibuang.
const attr = (node: Node, name: string) => (node as HTMLElement).getAttribute?.(name) ?? ''
const esc  = (v: string) => v.replace(/"/g, '&quot;')

let td: TurndownService | null = null

/**
 * Instance TurndownService singleton, dibuat MALAS saat pertama dibutuhkan
 * (bukan saat modul editor dievaluasi) — supaya boot Editor tidak ikut
 * menunggu konstruksi TurndownService + pendaftaran 5 rule di bawah sebelum
 * React sempat mount.
 *
 * Aturan-aturan ini adalah kontrak fidelity markdown (Bug #1) — jangan ubah
 * satu replacement string pun tanpa memverifikasi round-trip di
 * Editor.tsx (double-rAF check) tetap lolos untuk semua konstruksi di bawah.
 */
export function getTurndown(): TurndownService {
  if (td) return td
  const t = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  // Tabel GFM (```| a | b |```) dan `- [ ] task` — dua dari tiga konstruksi yang
  // hilang di Bug #1. Hanya dua rule ini yang diambil dari plugin, BUKAN bundel
  // `gfm` penuhnya: bundel itu juga menimpa strikethrough dengan sintaks tilde
  // tunggal non-standar (`~teks~`), berbeda dari `~~teks~~` yang dipetakan balik
  // oleh Strike node TipTap (lihat keepStrikethrough di bawah).
  t.use([turndownTables, turndownTaskListItems])

  t.addRule('keepUnderline', {
    filter: ['u'],
    replacement: (content) => `<u>${content}</u>`,
  })

  t.addRule('keepHighlight', {
    filter: ['mark'],
    replacement: (content, node) => {
      const color = attr(node, 'data-color')
      const style = attr(node, 'style')
      const attrs = [
        color ? ` data-color="${esc(color)}"` : '',
        style ? ` style="${esc(style)}"`      : '',
      ].join('')
      return `<mark${attrs}>${content}</mark>`
    },
  })

  // Warna teks dari extension Color dirender sebagai <span style="color: …">
  t.addRule('keepTextStyle', {
    filter: (node) => node.nodeName === 'SPAN' && !!attr(node, 'style'),
    replacement: (content, node) => `<span style="${esc(attr(node, 'style'))}">${content}</span>`,
  })

  // Perataan teks ada sebagai style di blok, bukan sebagai mark. Isinya dipertahankan
  // sebagai HTML utuh supaya format di dalamnya (bold, warna, dst.) ikut selamat.
  t.addRule('keepAlignedBlock', {
    filter: (node) =>
      /^(P|H1|H2|H3)$/.test(node.nodeName) && /text-align/i.test(attr(node, 'style')),
    replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`,
  })

  // [Ditemukan saat mengerjakan Bug #1] Strike (tombol Strikethrough di toolbar)
  // merender <s>, tapi turndown TIDAK punya rule bawaan untuk <s>/<del>/<strike> —
  // isinya lolos tanpa tanda formatnya hilang, sama persis seperti empat kasus
  // di atas. `~~teks~~` dipilih (bukan `~teks~`) karena itu yang dipetakan balik
  // ke <del> oleh marked (gfm:true) dan diterima parseHTML Strike node TipTap.
  t.addRule('keepStrikethrough', {
    // Filter fungsi, bukan array tag — 'strike' bukan key valid di
    // HTMLElementTagNameMap (tag lawas, tidak ada di lib.dom.d.ts).
    filter: (node) => /^(S|DEL|STRIKE)$/.test(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  })

  return (td = t)
}

/**
 * Markdown → HTML dengan opsi SELALU eksplisit per panggilan, bukan lewat
 * `marked.setOptions()` global. `marked` adalah singleton bersama antara
 * Editor dan Chat, dan keduanya sekarang lazy-loaded terpisah (code
 * splitting) — kalau konfigurasi `gfm: true` cuma pernah di-set sekali oleh
 * salah satu modul, urutan mana yang dimuat lebih dulu diam-diam menentukan
 * apakah tabel/strikethrough ke-parse benar di modul yang satunya. Opsi
 * eksplisit di sini menghilangkan ketergantungan urutan itu sepenuhnya.
 */
export function parseMarkdown(raw: string): string {
  return marked.parse(raw, { breaks: true, gfm: true, async: false }) as string
}
