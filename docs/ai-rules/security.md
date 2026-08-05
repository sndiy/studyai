# Keamanan

## API Key (Gemini, OpenAI)

- **Tidak boleh plaintext.** API key harus disimpan terenkripsi (misal lewat `safeStorage` API milik Electron, atau OS keychain/credential manager), bukan di `localStorage`, plain JSON config, atau file teks biasa.
- **Tidak boleh ter-log.** Audit semua `console.log`/`console.error` yang berpotensi ikut nge-print request/response mentah yang mengandung API key. Redact sebelum log kalau memang perlu logging untuk debugging.
- **Tidak boleh di-hardcode.** Tidak ada API key milik developer yang ditanam di kode maupun ter-commit ke git. Semua key adalah milik user sendiri (BYOK — bring your own key), diinput lewat UI Settings yang sudah ada.
- **Tidak boleh ter-expose ke DevTools tanpa perlu.** Kalau renderer process perlu tahu "apakah key sudah diisi" (misal untuk UI state), kirim boolean lewat IPC — jangan kirim key-nya sendiri ke renderer kalau tidak benar-benar dibutuhkan di sana.

## Electron Process Isolation

- `contextIsolation: true` wajib aktif di `BrowserWindow`.
- `nodeIntegration` di renderer wajib `false`.
- Semua akses filesystem/Node API dari renderer HARUS lewat `preload script` + IPC yang eksplisit, dengan whitelist channel yang jelas — jangan expose seluruh `ipcRenderer` mentah ke `window`.
- Validasi/sanitasi path file yang diterima lewat IPC (termasuk dari "Open With" / drag-drop) sebelum dipakai untuk operasi filesystem, untuk menghindari path traversal.

## Audit Sebelum Eksekusi

Untuk task apa pun yang menyentuh area di atas (penyimpanan key, IPC baru, akses filesystem baru): investigasi dan laporkan kondisi SAAT INI dulu (aman/tidak, dan kenapa), sebelum mengubah apa pun. Ini konsisten dengan `workflow.md`.
