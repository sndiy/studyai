# StudyAI Desktop — Setup Guide

## Stack
- Electron 30 + React 18 + TypeScript
- Zustand (state management)
- better-sqlite3 (local DB)
- Vite + electron-vite (build)
- pdf-parse + mammoth (import file)
- Fetch + ReadableStream (AI streaming)

---

## Prerequisites

```bash
# Node.js 20+ (wajib)
node --version   # harus v20+
npm --version    # harus v9+
```

Kalau belum ada Node.js 20, install via:
- Windows: https://nodejs.org/en/download/
- Atau pakai fnm: https://github.com/Schniz/fnm

---

## 1. Install Dependencies

```bash
cd studyai
npm install
```

Kalau error di `better-sqlite3` (native module):
```bash
# Windows — pastikan ada Visual Studio Build Tools
npm install --global windows-build-tools
npm install
```

---

## 2. Jalankan Dev Mode

```bash
npm run dev
```

Ini akan:
1. Build Electron main process
2. Start Vite dev server untuk renderer
3. Launch Electron window

---

## 3. Setup API Key (wajib untuk AI)

1. Buka app → klik **Pengaturan** di sidebar kiri
2. Di section **AI Providers** → expand **Google Gemini**
3. Masukkan API key dari: https://aistudio.google.com/app/apikey
4. Klik **Validasi & Simpan Key**
5. Pilih model (default: gemini-2.5-flash)

---

## 4. Build untuk Distribusi

```bash
# Windows (.exe installer)
npm run package:win

# Linux (.AppImage)
npm run package:linux

# Output ada di folder: release/
```

---

## Struktur Project

```
studyai/
├── electron/
│   ├── main.ts       ← Electron main process, IPC handlers, SQLite
│   └── preload.ts    ← Context bridge (security layer)
├── src/
│   ├── components/
│   │   ├── Sidebar/  ← Navigasi + daftar catatan
│   │   ├── Editor/   ← Text editor dengan markdown toolbar
│   │   ├── Chat/     ← AI streaming chat
│   │   ├── Settings/ ← Provider & persona config
│   │   └── Stats/    ← Dashboard statistik
│   ├── store/
│   │   └── useStore.ts  ← Zustand global state
│   ├── lib/
│   │   └── aiStream.ts  ← Gemini & OpenAI streaming
│   ├── types/index.ts
│   └── App.tsx
├── electron.vite.config.ts
├── package.json
└── tsconfig.json
```

---

## Data Storage

Database SQLite tersimpan di:
- Windows: `%APPDATA%\studyai\studyai.db`
- Linux: `~/.config/studyai/studyai.db`
- macOS: `~/Library/Application Support/studyai/studyai.db`

---

## Fitur

| Fitur | Status |
|-------|--------|
| Editor markdown | ✅ |
| Auto-save (debounced 800ms) | ✅ |
| Import PDF/DOCX/TXT/MD | ✅ |
| Export ke TXT/MD | ✅ |
| AI streaming (Gemini) | ✅ |
| AI streaming (OpenAI) | ✅ |
| Context-aware chat (pakai isi catatan) | ✅ |
| Custom AI persona | ✅ |
| Statistik & streak | ✅ |
| Riwayat chat per catatan | ✅ |
| Pencarian catatan | ✅ |
| Kategori catatan | ✅ |
| Window controls custom | ✅ |

---

## Troubleshooting

**`better-sqlite3` build error di Windows:**
```bash
npm install --global node-gyp
npm install --global windows-build-tools
npm install
```

**Electron tidak bisa launch:**
```bash
# Hapus node_modules dan reinstall
rm -rf node_modules
npm install
```

**AI tidak merespons:**
- Pastikan API key valid (klik Validasi)
- Cek koneksi internet
- Cek quota harian di Google AI Studio
"# studyai" 
