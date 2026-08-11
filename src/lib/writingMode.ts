/**
 * Calm focus: selama user benar-benar mengetik, lapisan aurora diredupkan dan
 * hanyutnya dihentikan (aturannya di styles/app.css). Tujuannya menjaga janji
 * "Aurora Glass tapi tetap nyaman menulis" — gerak latar tidak boleh menarik
 * mata saat mata sedang di teks.
 *
 * Sengaja menyentuh DOM langsung, bukan lewat state React: ini murni presentasi
 * dan dipicu tiap ketukan tombol — melewatkan render adalah intinya.
 */

const IDLE_MS = 2500

let idleTimer: ReturnType<typeof setTimeout> | null = null

export function markWriting(): void {
  document.documentElement.dataset.writing = 'true'
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(clearWriting, IDLE_MS)
}

export function clearWriting(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  delete document.documentElement.dataset.writing
}
