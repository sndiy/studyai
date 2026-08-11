#!/usr/bin/env node
// Budget ukuran bundle keras — gagal (exit 1) kalau ada yang melampaui batas.
// Dipanggil dari "npm run size", dan itu dipanggil dari "npm run package".
// Tujuannya: mencegah bundle diam-diam menggembung lagi di masa depan.

import { statSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function dirSize(path) {
  if (!existsSync(path)) return 0
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size
  }
  return total
}

const rendererAssets = join(ROOT, 'out', 'renderer', 'assets')

// [Fase 4] Sejak code splitting, "out/renderer/assets" berisi BANYAK chunk —
// entry (dimuat selalu) + chunk lazy (editor-engine, markdown, per-komponen)
// yang baru dimuat saat benar-benar dibutuhkan. Menjumlah SEMUA .js/.css jadi
// satu angka tidak lagi berarti "beban startup" — yang penting untuk cold
// start adalah ukuran chunk ENTRY saja. Rollup menamai entry sesuai key di
// rollupOptions.input ("index"), jadi filenya selalu berpola "index-*.ext".
function entryFiles(dir, ext) {
  if (!existsSync(dir)) return []
  const re = new RegExp(`^index-.*\\.${ext}$`)
  return readdirSync(dir).filter(f => re.test(f))
}

function sumSizes(dir, files) {
  return files.reduce((sum, f) => sum + statSync(join(dir, f)).size, 0)
}

function totalBySuffix(dir, suffix) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir)
    .filter(f => f.endsWith(suffix))
    .reduce((sum, f) => sum + statSync(join(dir, f)).size, 0)
}

// Font ikon subset (~7.5 KB) ada di bawah assetsInlineLimit (12 KB), jadi
// seharusnya di-inline sebagai data: URI ke dalam CSS entry — TIDAK ada file
// .woff2 terpisah di renderer/assets. Kalau ada, assetsInlineLimit berhenti
// bekerja (mis. subset font membesar melewati limit) dan perlu diselidiki.
function looseIconFontBytes(dir) {
  if (!existsSync(dir)) return 0
  return readdirSync(dir)
    .filter(f => /\.(woff2?|ttf)$/.test(f))
    .reduce((sum, f) => sum + statSync(join(dir, f)).size, 0)
}

const asarPath = join(ROOT, 'release', 'win-unpacked', 'resources', 'app.asar')

const entryJsFiles  = entryFiles(rendererAssets, 'js')
const entryCssFiles = entryFiles(rendererAssets, 'css')

const measurements = {
  'entry js':        sumSizes(rendererAssets, entryJsFiles),
  'entry css':       sumSizes(rendererAssets, entryCssFiles),
  'loose icon font': looseIconFontBytes(rendererAssets),
  'all js chunks':   totalBySuffix(rendererAssets, '.js'),   // informational, tanpa budget ketat
  'out/ total':      dirSize(join(ROOT, 'out')),
  'app.asar':        existsSync(asarPath) ? statSync(asarPath).size : 0,
}

// Budget berdasarkan hasil terukur pasca code-splitting (lihat plan file).
// "entry js"/"entry css" adalah yang BENAR-BENAR memblokir cold start —
// chunk lazy (editor-engine, markdown, per-komponen) sengaja tidak dibatasi
// ketat di sini karena mereka boleh besar selama tidak di jalur render awal.
const BUDGETS = {
  'entry js':        100_000,
  'entry css':         80_000,
  'loose icon font':    1_000,   // seharusnya 0 — ada berarti inlining berhenti bekerja
  'all js chunks':  2_000_000,   // longgar, sekadar jaring pengaman kasar
  'out/ total':     1_600_000,
  'app.asar':       4_500_000,
}

let failed = false
console.log('[size] Ukuran bundle vs budget:\n')
for (const [key, bytes] of Object.entries(measurements)) {
  const budget = BUDGETS[key]
  const ok = bytes === 0 ? null : bytes <= budget
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`
  const status = ok === null ? 'SKIP (0 / belum di-build)' : ok ? 'OK' : 'MELEBIHI BUDGET'
  console.log(`  ${key.padEnd(16)} ${kb(bytes).padStart(12)} / ${kb(budget).padStart(12)}  [${status}]`)
  if (ok === false) failed = true
}

if (failed) {
  console.error('\n[size] GAGAL — satu atau lebih bundle melebihi budget.')
  process.exit(1)
} else {
  console.log('\n[size] Semua dalam budget (atau belum di-build).')
}
