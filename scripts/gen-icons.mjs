#!/usr/bin/env node
// Regenerasi src/assets/icons.css + font subset dari tabler-icons penuh,
// berdasarkan kelas `ti-xxx` yang BENAR-BENAR dipakai di src/.
//
// Pakai:
//   node scripts/gen-icons.mjs          — regenerate icons.css + subset woff2
//   node scripts/gen-icons.mjs --check  — verifikasi TANPA menulis apa pun;
//                                          exit 1 kalau icons.css basi.
//                                          Dipanggil dari "npm run build" —
//                                          menambah `ti ti-nama-baru` di kode
//                                          tanpa regenerate jadi BUILD GAGAL,
//                                          bukan kotak kosong di produksi.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import subsetFont from 'subset-font'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC  = join(ROOT, 'src')

const FULL_CSS_PATH   = join(SRC, 'assets', 'tabler-icons.min.css')
const FULL_WOFF2_PATH = join(SRC, 'assets', 'fonts', 'tabler-icons.woff2')
const OUT_CSS_PATH    = join(SRC, 'assets', 'icons.css')
const OUT_WOFF2_PATH  = join(SRC, 'assets', 'fonts', 'tabler-icons-subset.woff2')

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html'])
// File CSS sumber (berisi SEMUA 5.147 nama ikon) dan output hasil generate
// (komentar penjelasannya sendiri menyebut contoh nama kelas `ti-`) wajib
// dikecualikan dari scan — kalau ikut, "yang dipakai" jadi salah dihitung.
const SCAN_EXCLUDE = new Set([FULL_CSS_PATH, OUT_CSS_PATH])
const ICON_CLASS_RE = /\bti-[a-z0-9-]+/g

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (SCAN_EXTENSIONS.has(extname(entry.name)) && !SCAN_EXCLUDE.has(full)) files.push(full)
  }
  return files
}

function findUsedIcons() {
  const used = new Set()
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf-8')
    for (const m of text.matchAll(ICON_CLASS_RE)) used.add(m[0].slice(3)) // buang prefix "ti-"
  }
  return [...used].sort()
}

function parseCodepoints(css) {
  const map = new Map()
  const re = /\.ti-([a-z0-9-]+):before\{content:"\\([0-9a-f]+)"\}/g
  for (const m of css.matchAll(re)) map.set(m[1], m[2])
  return map
}

function buildCss(entries) {
  const lines = [
    '/*!',
    ' * Subset Tabler Icons — HANYA glyph yang benar-benar dipakai di src/.',
    ' * File ini DIGENERATE oleh scripts/gen-icons.mjs — JANGAN edit manual.',
    ' * Menambah ikon baru: pakai `ti ti-nama-baru` di kode, lalu jalankan',
    ' *   node scripts/gen-icons.mjs',
    ' * "npm run build" menjalankan --check dan GAGAL kalau file ini basi.',
    ' */',
    '@font-face{font-family:"tabler-icons";font-style:normal;font-weight:400;' +
      'src:url("./fonts/tabler-icons-subset.woff2") format("woff2");font-display:block}',
    '.ti{font-family:"tabler-icons" !important;speak:none;font-style:normal;' +
      'font-weight:normal;font-variant:normal;text-transform:none;line-height:1;' +
      '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}',
    ...entries.map(([name, cp]) => `.ti-${name}:before{content:"\\${cp}"}`),
    '',
  ]
  return lines.join('\n')
}

async function main() {
  const check = process.argv.includes('--check')

  const used = findUsedIcons()
  const fullCss = readFileSync(FULL_CSS_PATH, 'utf-8')
  const codepointMap = parseCodepoints(fullCss)

  const missing = used.filter(name => !codepointMap.has(name))
  if (missing.length > 0) {
    console.error('[icons] Dipakai di kode tapi TIDAK ADA di tabler-icons.min.css:')
    for (const m of missing) console.error(`  ti-${m}`)
    process.exit(1)
  }

  const entries = used.map(name => [name, codepointMap.get(name)])
  const newCss = buildCss(entries)

  if (check) {
    if (!existsSync(OUT_CSS_PATH)) {
      console.error('[icons] src/assets/icons.css belum ada. Jalankan: node scripts/gen-icons.mjs')
      process.exit(1)
    }
    const existing = readFileSync(OUT_CSS_PATH, 'utf-8')
    if (existing !== newCss) {
      console.error('[icons] src/assets/icons.css BASI — set ikon terpakai berbeda dari yang ter-generate.')
      console.error('[icons] Jalankan: node scripts/gen-icons.mjs')
      process.exit(1)
    }
    if (!existsSync(OUT_WOFF2_PATH)) {
      console.error('[icons] src/assets/fonts/tabler-icons-subset.woff2 belum ada. Jalankan: node scripts/gen-icons.mjs')
      process.exit(1)
    }
    console.log(`[icons] OK — ${used.length} ikon, icons.css sinkron.`)
    return
  }

  writeFileSync(OUT_CSS_PATH, newCss)
  console.log(`[icons] Ditulis ${OUT_CSS_PATH} (${used.length} ikon)`)

  const fullWoff2 = readFileSync(FULL_WOFF2_PATH)
  // Karakter di Private Use Area Unicode — beberapa codepoint tabler > 0xFFFF,
  // String.fromCodePoint menangani surrogate pair-nya otomatis.
  const text = entries.map(([, cp]) => String.fromCodePoint(parseInt(cp, 16))).join('')
  const subsetBuffer = await subsetFont(fullWoff2, text, { targetFormat: 'woff2' })
  writeFileSync(OUT_WOFF2_PATH, subsetBuffer)
  console.log(`[icons] Ditulis ${OUT_WOFF2_PATH} (${subsetBuffer.length} B, dari ${fullWoff2.length} B penuh)`)
}

main().catch(e => {
  console.error('[icons] Gagal:', e)
  process.exit(1)
})
