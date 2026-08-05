# AGENTS.md — StudyAI Desktop

> File ini dibaca otomatis oleh Claude Code, Antigravity, dan Cursor. Taruh di root repo. Jangan pernah isi credential/API key di sini — hanya konvensi.

## Project Overview

StudyAI Desktop — aplikasi belajar cerdas berbasis AI untuk desktop.

- **Stack:** Electron 30, React 18, TypeScript, Zustand (state), TipTap (rich text editor), Vite + electron-vite (build)
- **AI providers:** Google Gemini & OpenAI, via Fetch + ReadableStream (streaming)
- **Target distribusi:** Windows (.exe installer), Linux (.AppImage)
- **Struktur:** `electron/` = main process, `src/` = renderer (React)

## Build & Test Commands

```
npm install                # install dependencies
npm run dev                # dev mode
npm run package:win        # build Windows installer
npm run package:linux      # build Linux AppImage
```

Belum ada test suite otomatis — kalau agent menambah satu, update bagian ini.

## Architecture Constraints

- Komunikasi main ↔ renderer **WAJIB** lewat IPC (`ipcMain`/`ipcRenderer`). Renderer tidak boleh punya akses langsung ke Node.js API — `contextIsolation` harus tetap aktif, `nodeIntegration` di renderer harus tetap nonaktif.
- State management pakai Zustand — jangan campur dengan state management lain tanpa alasan kuat.
- Editor pakai TipTap — jangan ganti/duplikasi library editor lain untuk kebutuhan yang sama.

---

## Aturan Wajib untuk Semua AI Agent

Ringkasan di bawah ini WAJIB dipatuhi di setiap sesi kerja, apa pun tools/model yang dipakai. Rincian lengkap ada di `docs/ai-rules/` — baca file yang relevan sebelum mulai task besar.

### 1. Jangan Berhalusinasi
Jangan klaim sesuatu "sudah benar" atau "sudah fix" tanpa benar-benar verifikasi (build, run, atau baca ulang kode-nya). Jangan mengarang nama API, method, atau library yang tidak benar-benar ada — cek `package.json` dan dokumentasi resmi dulu. Kalau tidak yakin, katakan tidak yakin — jangan menebak dengan nada percaya diri. → `docs/ai-rules/verification-and-honesty.md`

### 2. Jangan Sembunyikan Temuan
Kalau investigasi/audit menemukan bug lain di luar scope yang diminta, WAJIB tetap dilaporkan — jangan didiamkan karena "di luar topik". Laporkan tingkat keparahan setiap temuan secara jujur, jangan diperhalus atau dibesar-besarkan. → `docs/ai-rules/verification-and-honesty.md`

### 3. Investigasi Dulu, Eksekusi Kemudian
Untuk task yang ambigu, root cause belum jelas, atau berpotensi destruktif terhadap data user: investigasi dan laporkan rencana/temuan dulu, tunggu konfirmasi, baru eksekusi. Jangan ubah banyak file sekaligus tanpa rencana yang sudah direview. Jangan memperluas scope ("sambil benerin, sekalian nambahin fitur X") tanpa diminta eksplisit. → `docs/ai-rules/workflow.md`

### 4. Keamanan Bukan Opsional
API key tidak boleh plaintext di storage, tidak boleh ter-log ke console/DevTools/terminal, tidak boleh di-hardcode di kode maupun ter-commit ke git. → `docs/ai-rules/security.md`

### 5. Jangan Asumsikan Ketersediaan API Provider
Integrasi dengan Gemini/OpenAI wajib verifikasi ketersediaan model terhadap API key yang sedang dipakai secara real-time — jangan hardcode daftar model statis dan anggap semua tersedia untuk semua tier/key. → `docs/ai-rules/api-integration.md`

### 6. Build Setelah Perubahan Signifikan
Jalankan build setelah perubahan yang menyentuh lebih dari 1-2 file. Laporkan error apa adanya kalau ada — jangan berasumsi "harusnya jalan" tanpa bukti.

---

## Referensi Lengkap

- [`docs/ai-rules/verification-and-honesty.md`](docs/ai-rules/verification-and-honesty.md) — anti-halusinasi & pelaporan jujur
- [`docs/ai-rules/security.md`](docs/ai-rules/security.md) — baseline keamanan Electron & API key
- [`docs/ai-rules/workflow.md`](docs/ai-rules/workflow.md) — pola investigasi → konfirmasi → eksekusi
- [`docs/ai-rules/api-integration.md`](docs/ai-rules/api-integration.md) — aturan integrasi provider AI
