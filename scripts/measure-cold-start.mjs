#!/usr/bin/env node
// Mengukur waktu spawn -> ready-to-show StudyAI.exe terpaket, berulang kali.
// Pakai: node scripts/measure-cold-start.mjs [--runs=10] [--compare]
//
// Butuh `npm run package:win` sudah dijalankan (release/win-unpacked/StudyAI.exe ada).

import { spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const EXE  = join(ROOT, 'release', 'win-unpacked', 'StudyAI.exe')
const BASELINE_PATH = join(ROOT, 'perf-baseline.json')

const args = process.argv.slice(2)
const runs = Number(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? 10)
const compare = args.includes('--compare')

if (!existsSync(EXE)) {
  console.error(`[measure] Tidak ditemukan: ${EXE}`)
  console.error('[measure] Jalankan "npm run package:win" dulu.')
  process.exit(1)
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function percentile(nums, p) {
  const s = [...nums].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)
  return s[Math.max(0, idx)]
}

function runOnce() {
  return new Promise((resolve, reject) => {
    const child = spawn(EXE, [], {
      env: { ...process.env, STUDYAI_PERF: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let readyMs = null
    let buf = ''

    const onData = (chunk) => {
      buf += chunk.toString()
      const m = buf.match(/\[perf\] ready-to-show (\d+)/)
      if (m && readyMs === null) {
        readyMs = Number(m[1])
        // Beri waktu render frame terakhir sebelum kill, lalu selesai.
        setTimeout(() => { child.kill(); }, 150)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    child.on('exit', () => {
      if (readyMs === null) reject(new Error('Tidak ada [perf] ready-to-show di output — cek STUDYAI_PERF terbaca.'))
      else resolve(readyMs)
    })
    child.on('error', reject)

    // Pengaman: jangan sampai proses menggantung selamanya.
    setTimeout(() => { if (readyMs === null) child.kill() }, 15000)
  })
}

async function main() {
  console.log(`[measure] Menjalankan ${EXE} sebanyak ${runs}x...`)
  const samples = []
  for (let i = 0; i < runs; i++) {
    try {
      const ms = await runOnce()
      samples.push(ms)
      console.log(`[measure] run ${i + 1}/${runs}: ${ms} ms`)
    } catch (e) {
      console.warn(`[measure] run ${i + 1}/${runs} gagal: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 400))
  }

  if (samples.length === 0) {
    console.error('[measure] Semua run gagal, tidak ada data.')
    process.exit(1)
  }

  const result = {
    timestamp: new Date().toISOString(),
    runs: samples.length,
    min: Math.min(...samples),
    median: median(samples),
    p90: percentile(samples, 90),
    max: Math.max(...samples),
    samples,
  }

  console.log('\n[measure] Hasil (ready-to-show, ms sejak spawn process):')
  console.log(`  min=${result.min} median=${result.median} p90=${result.p90} max=${result.max}`)

  if (compare) {
    if (!existsSync(BASELINE_PATH)) {
      console.warn('[measure] --compare diminta tapi perf-baseline.json belum ada. Menulis baseline baru.')
      writeFileSync(BASELINE_PATH, JSON.stringify(result, null, 2))
    } else {
      const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
      const deltaMedian = result.median - baseline.median
      const pct = ((deltaMedian / baseline.median) * 100).toFixed(1)
      console.log(`\n[measure] Baseline median=${baseline.median} (${baseline.timestamp})`)
      console.log(`[measure] Delta median: ${deltaMedian >= 0 ? '+' : ''}${deltaMedian} ms (${pct}%)`)
    }
  } else {
    writeFileSync(BASELINE_PATH, JSON.stringify(result, null, 2))
    console.log(`\n[measure] Baseline ditulis ke ${BASELINE_PATH}`)
  }
}

main()
