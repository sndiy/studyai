import { existsSync, writeFileSync, renameSync, unlinkSync } from 'fs'

/**
 * Tulis file secara atomik: tulis ke `.tmp` lalu rename.
 *
 * [B2-fix] Menulis-tmp dan rename HARUS dibedakan gagalnya. Kalau keduanya
 * berbagi satu try/catch, tulis-tmp yang gagal (disk penuh, folder read-only,
 * lock antivirus) membuat fallback di bawah membuka file ASLI dengan mode 'w'
 * dan men-truncate-nya ke 0 byte sebelum gagal lagi dengan alasan yang sama —
 * file yang tadinya sehat berakhir kosong.
 */
export function atomicWriteSync(filePath: string, data: string): void {
  const tmpPath = filePath + '.tmp'
  try {
    writeFileSync(tmpPath, data, 'utf-8')
    try {
      renameSync(tmpPath, filePath)
    } catch {
      // Sampai titik ini file asli masih utuh — fallback tulis-langsung aman.
      // Error dari sini sengaja TIDAK ditelan — caller yang memutuskan cara melapor.
      writeFileSync(filePath, data, 'utf-8')
    }
  } finally {
    // Jangan tinggalkan .tmp menumpuk kalau rename gagal / write parsial
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
  }
}
