<div align="center">

<img src="src/assets/studyai-logo.png" width="100" height="100" alt="StudyAI Logo"/>

# StudyAI Desktop

**Aplikasi belajar cerdas berbasis AI untuk desktop**

[![Made with Electron](https://img.shields.io/badge/Electron-30-47848F?style=flat&logo=electron&logoColor=white)](https://electronjs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react&logoColor=black)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Built with AI](https://img.shields.io/badge/Built%20with-AI-8B5CF6?style=flat)](#-dibuat-dengan-ai)

</div>

---

## 🤖 Dibuat dengan AI

Proyek ini dibangun **sepenuhnya dengan bantuan AI** — mulai dari arsitektur kode, desain UI, hingga logo aplikasi. Tidak ada satu baris pun yang ditulis tanpa kolaborasi AI.

| AI | Peran |
|----|-------|
| **Claude** (Anthropic) | Arsitektur kode, semua komponen React/TypeScript, Electron IPC, logika state Zustand, refactor & debugging |
| **Gemini** (Google) | Generasi logo pertama (versi awal icon buku + neural spark ungu) |
| **ChatGPT** (OpenAI) | Generasi logo final yang digunakan — icon buku ungu dengan partikel AI hijau |
| **Antigravity** | Konsep produk, arah desain, dan kurasi keputusan kreatif |

> *Proyek ini adalah bukti bahwa manusia + AI bisa membangun aplikasi desktop lengkap dari nol.*

---

## Stack
- Electron 30 + React 18 + TypeScript
- Zustand (state management)
- TipTap (rich text editor)
- Vite + electron-vite (build)
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

## Install & Jalankan

```bash
# 1. Install dependencies
cd studyai
npm install

# 2. Jalankan dev mode
npm run dev
```

---

## Setup API Key

1. Buka app → klik **Pengaturan** di sidebar kiri
2. Di section **AI Providers** → expand **Google Gemini**
3. Masukkan API key dari: https://aistudio.google.com/app/apikey
4. Klik **Validasi & Simpan Key**
5. Pilih model (default: `gemini-1.5-flash`)

---

## Build untuk Distribusi

```bash
# Windows (.exe installer)
npm run package:win

# Linux (.AppImage)
npm run package:linux

# Output ada di folder: release/
```

---

## Fitur

| Fitur | Status |
|-------|--------|
| Editor teks (TipTap) | ✅ |
| Auto-save | ✅ |
| Export ke TXT/MD/JSON | ✅ |
| AI streaming (Gemini) | ✅ |
| AI streaming (OpenAI) | ✅ |
| Context-aware chat (pakai isi catatan) | ✅ |
| Custom AI persona | ✅ |
| Riwayat file terakhir dibuka | ✅ |
| Window controls custom | ✅ |

---

## Troubleshooting

**Electron tidak bisa launch:**
```bash
rm -rf node_modules
npm install
```

**AI tidak merespons:**
- Pastikan API key valid (klik Validasi di Pengaturan)
- Cek koneksi internet
- Cek quota harian di Google AI Studio

---

<div align="center">

Made with ❤️ by humans, written by AI

**Claude · Gemini · ChatGPT · Antigravity**

</div>
