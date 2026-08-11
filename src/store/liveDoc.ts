import { useStore } from './useStore'

// Modul ini SENGAJA tidak pernah punya subscriber React (tidak ada hook,
// tidak ada useSyncExternalStore) — satu-satunya tugasnya adalah menjembatani
// "apa isi editor Tiptap sekarang" ke "doc.content di Zustand" TANPA membuat
// keduanya selalu sinkron per-render. Sinkronisasi hanya terjadi pada titik
// yang benar-benar butuh: idle timer di latar belakang, atau tepat sebelum
// save/kirim chat (lihat flushEditorToStore()).
//
// [Bug perf sesi panjang] Sebelum ini, `onUpdate` Tiptap menyerialisasi
// SELURUH dokumen (getHTML + turndown, keduanya O(n)) dan menulis string
// dokumen utuh ke store PADA SETIAP KETUKAN — yang lalu me-render ulang
// Editor, Sidebar, CommandPalette, Titlebar, dan Chat (termasuk mem-parse
// ulang seluruh transkrip chat). Biayanya tumbuh linear terhadap panjang
// dokumen, jadi mengetik terasa makin berat di dokumen yang makin panjang.
// Pola flush-tertunda di sini menghilangkan SEMUA itu dari jalur ketikan.

let flushFn: (() => string | null) | null = null

/**
 * Dipanggil engine editor (TiptapEngine) saat mount/unmount untuk
 * mendaftarkan cara menarik markdown TERKINI dari editor. `null` saat
 * editor di-unmount, supaya flush yang telat tidak memanggil instance lama.
 */
export function registerEditorFlush(fn: (() => string | null) | null): void {
  flushFn = fn
}

/**
 * Tarik markdown terkini dari editor ke store — idempoten, aman dipanggil
 * berlebih (idle timer, saveDoc, sendMessage semua memanggilnya). Hanya
 * menulis ke store kalau benar-benar ada editor terdaftar DAN isinya
 * berbeda dari yang sudah ada, supaya tidak memicu re-render tanpa alasan.
 */
export function flushEditorToStore(): void {
  const md = flushFn?.()
  if (md == null) return
  const { doc, setDocContent } = useStore.getState()
  if (!doc || doc.content === md) return
  setDocContent(md)
}

let idlePending = false

/**
 * Jadwalkan SATU flush di waktu idle browser. Kalau sudah ada yang
 * dijadwalkan dan belum jalan, panggilan berikutnya tidak menambah
 * jadwal baru — ini yang membuat mengetik cepat tidak menumpuk callback,
 * cukup satu flush per jeda idle.
 */
export function scheduleIdleFlush(): void {
  if (idlePending) return
  idlePending = true
  const run = () => { idlePending = false; flushEditorToStore() }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2000 })
  } else {
    setTimeout(run, 2000)
  }
}
