// src/lib/personaDefaults.ts — satu sumber kebenaran untuk persona default.
//
// [L3] Sebelumnya ADA TIGA versi berbeda tersebar di electron/main.ts (default
// yang benar-benar ditulis ke settings.json baru), src/store/useStore.ts
// (fallback runtime kalau field kosong), dan tombol "Reset Default" di
// Settings.tsx — dan tidak ada satu pun yang sama persis dengan yang lain.
// Menekan "Reset Default" tidak benar-benar mengembalikan default yang
// dipakai fresh install. Dipindah ke sini supaya main process dan renderer
// selalu memakai teks yang sama.

export const DEFAULT_PERSONA_NAME = 'Mai'

export const DEFAULT_PERSONA_PROMPT =
  'Kamu adalah Mai, asisten belajar yang cerdas dan supportif. Berbicara bahasa Indonesia dengan hangat dan fokus pada materi.'

export const DEFAULT_PERSONA_LIMIT =
  'Jawab maksimal 3 paragraf. Sertakan contoh kode untuk topik programming.'
