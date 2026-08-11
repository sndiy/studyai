import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, renameSync } from 'fs'
import { atomicWriteSync } from './fsAtomic'
import { DEFAULT_PERSONA_NAME, DEFAULT_PERSONA_PROMPT, DEFAULT_PERSONA_LIMIT } from '../src/lib/personaDefaults'

const USER_DATA     = app.getPath('userData')
const SETTINGS_PATH = join(USER_DATA, 'settings.json')

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: Record<string, string> = {
  gemini_api_key:  '',
  openai_api_key:  '',
  // [M5] gemini-1.5-flash sudah dipensiunkan dari Gemini API untuk project
  // baru — install baru dulu langsung memakai model mati sebagai default.
  active_model:    'gemini-2.0-flash',
  persona_name:    DEFAULT_PERSONA_NAME,
  persona_prompt:  DEFAULT_PERSONA_PROMPT,
  persona_limit:   DEFAULT_PERSONA_LIMIT,
  max_tokens:      '2048',
}

// ── Rahasia: enkripsi at-rest + jangan pernah keluar ke renderer ─────────────
// [S1] docs/ai-rules/security.md melarang API key disimpan plaintext.
// Nilai disimpan sebagai `enc:v1:<base64>` hasil safeStorage (DPAPI di Windows,
// Keychain di macOS, libsecret di Linux). Nilai lama yang masih plaintext tetap
// bisa dibaca, lalu otomatis dimigrasi saat app siap.
const SECRET_KEYS = new Set(['gemini_api_key', 'openai_api_key'])
const ENC_PREFIX  = 'enc:v1:'

function encryptSecret(value: string): string {
  if (!value) return ''
  if (value.startsWith(ENC_PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch (e: any) {
    console.error('[StudyAI] safeStorage encrypt failed:', e?.message ?? e)
    return value
  }
}

function decryptSecret(value: string): string {
  if (!value) return ''
  if (!value.startsWith(ENC_PREFIX)) return value   // nilai lama (plaintext) — masih dibaca
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch (e: any) {
    // Jangan pernah cetak isinya; cukup laporkan bahwa dekripsi gagal
    console.error('[StudyAI] safeStorage decrypt failed:', e?.message ?? e)
    return ''
  }
}

// [A4] Kalau settings.json gagal di-parse, JANGAN diam-diam menimpanya dengan
// default — itu menghapus API key & persona user tanpa jejak. Tulis hanya
// setelah user diberi tahu dan file rusaknya dicadangkan.
let settingsUnreadable = false

// Cache di memori — dulu settings.json dibaca+di-parse+didekripsi berulang
// (migrateSecretsToEncrypted, removeDeadSettingsKeys, warmVerifiedLimits,
// createWindow masing-masing baca sendiri = 4x sebelum window pernah tampil).
// Sekarang satu pembacaan disk per proses; hand-edit settings.json saat app
// berjalan baru terbaca setelah restart — dapat diterima, malah menghindari
// torn read.
let cache: Record<string, string> | null = null

export type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Baca settings.json SEKALI: parse, migrasi (enkripsi ulang key plaintext lama
 * + buang `claude_api_key` basi) dilipat jadi satu pass baca + maksimal satu
 * tulis, lalu satu pass dekripsi seluruh secret, lalu hasilnya di-cache.
 * Panggil sekali dari app.whenReady(); loadSettings() sesudahnya baca cache.
 */
export function initSettings(): Record<string, string> {
  let raw: Record<string, string> = {}
  if (existsSync(SETTINGS_PATH)) {
    try {
      raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
    } catch (e: any) {
      // [B19] Jangan cetak objek error mentah — pesan SyntaxError bisa memuat
      // cuplikan isi file, dan file itu berisi API key.
      console.error('[StudyAI] settings.json tidak bisa dibaca, memakai default sementara:', e?.name ?? 'Error')
      settingsUnreadable = true
      cache = { ...DEFAULT_SETTINGS }
      return cache
    }
  }
  // [Bug #6] Harus balik ke false di jalur sukses — satu kegagalan baca
  // SEMENTARA (file terkunci antivirus/backup/cloud-sync saat startup) tidak
  // boleh menempel selamanya (lihat saveSettings di bawah).
  settingsUnreadable = false

  let mutated = false
  // [S1] Migrasi key plaintext lama → terenkripsi. Kalau safeStorage tidak
  // tersedia, JANGAN tulis apa pun — enkripsi tidak boleh dilewati diam-diam.
  if (safeStorage.isEncryptionAvailable()) {
    for (const k of SECRET_KEYS) {
      if (raw[k] && !raw[k].startsWith(ENC_PREFIX)) { raw[k] = encryptSecret(raw[k]); mutated = true }
    }
  } else if ([...SECRET_KEYS].some(k => raw[k])) {
    console.warn('[StudyAI] safeStorage tidak tersedia di sistem ini — API key tidak bisa dienkripsi')
  }
  // Provider Claude dihapus (streaming tidak pernah diimplementasikan) — key
  // yang sempat tersimpan dari versi lama tidak boleh tertinggal yatim di disk.
  if ('claude_api_key' in raw) {
    delete raw.claude_api_key
    mutated = true
  }
  if (mutated) {
    try {
      atomicWriteSync(SETTINGS_PATH, JSON.stringify(raw, null, 2))
      console.log('[StudyAI] Migrasi settings.json selesai (enkripsi ulang / bersihkan key basi)')
    } catch (e: any) {
      console.error('[StudyAI] Gagal migrasi settings:', e?.message ?? e)
    }
  }

  const merged = { ...DEFAULT_SETTINGS, ...raw }
  for (const k of SECRET_KEYS) merged[k] = decryptSecret(merged[k] ?? '')
  cache = merged
  return merged
}

// Isi settings apa adanya (rahasia sudah didekripsi) — HANYA untuk dipakai di main
export function loadSettings(): Record<string, string> {
  return cache ?? initSettings()
}

export function saveSettings(data: Record<string, string>): WriteResult {
  // [A4] Kalau file lama tidak terbaca, cadangkan dulu — jangan menimpa data
  // yang mungkin masih bisa diselamatkan user secara manual.
  if (settingsUnreadable && existsSync(SETTINGS_PATH)) {
    try {
      const backup = `${SETTINGS_PATH}.corrupt-${Date.now()}.bak`
      renameSync(SETTINGS_PATH, backup)
      console.error('[StudyAI] settings.json rusak, dicadangkan ke:', backup)
    } catch (e: any) {
      console.error('[StudyAI] Gagal mencadangkan settings.json rusak:', e?.message ?? e)
    }
    settingsUnreadable = false
  }

  const toWrite: Record<string, string> = { ...data }
  for (const k of SECRET_KEYS) {
    if (toWrite[k] !== undefined) toWrite[k] = encryptSecret(toWrite[k])
  }

  try {
    atomicWriteSync(SETTINGS_PATH, JSON.stringify(toWrite, null, 2))
    cache = { ...data }
    return { ok: true }
  } catch (e: any) {
    console.error('[StudyAI] Failed to save settings:', e?.message ?? e)
    // Jangan sajikan cache yang mungkin sudah tidak sama dengan disk — baca
    // ulang dari disk di panggilan loadSettings() berikutnya.
    cache = null
    return { ok: false, error: e?.message ?? String(e) }
  }
}

// [S2] Bentuk settings yang boleh dilihat renderer — TANPA API key.
// security.md §"API Key" poin 4: kirim boolean keberadaan key, bukan key-nya.
export function publicSettings() {
  const s = loadSettings()
  return {
    active_model:   s.active_model,
    persona_name:   s.persona_name,
    persona_prompt: s.persona_prompt,
    persona_limit:  s.persona_limit,
    max_tokens:     s.max_tokens,
    theme:          s.theme as 'light' | 'dark' | undefined,
    // Allowlist ini yang menentukan apa yang sampai ke renderer: setting yang
    // tidak terdaftar di sini akan tersimpan ke disk tapi tidak pernah kembali.
    sidebar_collapsed: s.sidebar_collapsed as string | undefined,
    has_gemini_key: !!s.gemini_api_key,
    has_openai_key: !!s.openai_api_key,
    settings_unreadable:  settingsUnreadable,
    encryption_available: safeStorage.isEncryptionAvailable(),
  }
}
