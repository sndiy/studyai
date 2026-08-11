// Dokumen yang sedang dibuka di editor
export interface Document {
  /** [Bug #15] Identitas stabil dokumen — TIDAK berubah lewat Save As (filePath berubah, docId tidak).
   *  Dipakai saveDoc() untuk menolak menempelkan path hasil simpan ke dokumen yang sudah diganti
   *  selagi dialog Save As masih terbuka. */
  docId:    string
  title:    string
  content:  string
  filePath: string | null   // null = belum disimpan / new file
  isDirty:  boolean         // ada perubahan belum disimpan
  /** [Bug #1] Konstruksi markdown yang terdeteksi hilang saat parsing ke editor
   *  (mis. tabel/gambar/task-list yang tidak dikenal schema). null = tidak ada yang hilang. */
  contentWarning: string[] | null
}

// Entry di daftar recent files
export interface RecentFile {
  path:      string
  title:     string
  updatedAt: string
}

// [S2] Bentuk settings yang diterima renderer. API key SENGAJA tidak ada di sini —
// renderer hanya boleh tahu apakah sebuah key sudah terisi atau belum
// (docs/ai-rules/security.md §"API Key" poin 4). Tipe ini yang menegakkannya.
export interface Settings {
  active_model:   string
  persona_name:   string
  persona_prompt: string
  persona_limit:  string
  max_tokens:     string
  theme?:         'light' | 'dark'
  /** Preferensi UI, disimpan sebagai string '1' | '0' seperti setting lain. */
  sidebar_collapsed?: string
  has_gemini_key: boolean
  has_openai_key: boolean
  /** settings.json gagal di-parse — nilai yang tampil adalah default sementara */
  settings_unreadable:  boolean
  /** false = OS tidak menyediakan enkripsi, key terpaksa disimpan plaintext */
  encryption_available: boolean
}

export interface ChatMessage {
  role:    'user' | 'assistant'
  content: string
}

export type View = 'editor' | 'ai' | 'settings'

// Hasil operasi tulis di main process — kegagalan dilaporkan, bukan ditelan
export type WriteResult = { ok: true } | { ok: false; error: string }

// Hasil baca file — alasan kegagalan ikut dibawa supaya bisa ditampilkan ke user
export type ReadResult =
  | { ok: true; title: string; content: string; filePath: string }
  | { ok: false; error: string }

// [Aturan 5] Penyebab error dibedakan supaya UI bisa memberi langkah lanjut
// yang tepat — bukan pesan generik "AI tidak merespons".
export type ErrorKind = 'auth' | 'quota' | 'network' | 'server' | 'input' | 'other'

/** Error yang masuk akal untuk dicoba ulang oleh user (bukan auto-retry — aturan 7) */
export const RETRYABLE_ERROR_KINDS: ErrorKind[] = ['quota', 'network', 'server']

// Potongan stream AI yang dikirim main → renderer
export interface AIChunkPayload {
  requestId:  string
  text:       string
  done:       boolean
  error?:     string
  errorKind?: ErrorKind
}

export type ValidateKeyResult =
  | { valid: true;  models: string[]; limits: Record<string, number> }
  | { valid: false; error: string; errorKind?: ErrorKind }

// Aksi yang ditunda karena dokumen aktif masih punya perubahan belum disimpan
export type PendingNav =
  | { kind: 'new' }
  | { kind: 'openDialog' }
  | { kind: 'openPath'; filePath: string }
  | { kind: 'close' }

export interface Toast {
  kind: 'ok' | 'err'
  msg:  string
}

declare global {
  interface Window {
    api: {
      window: {
        minimize: () => void
        maximize: () => void
        close:    () => void
        isMaximized: () => Promise<boolean>
        /** Mengembalikan fungsi unsubscribe, sama seperti listener lain di sini. */
        onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
      }
      settings: {
        getAll: () => Promise<Settings>
        set:    (key: string, value: string) => Promise<WriteResult>
      }
      recent: {
        getAll: () => Promise<RecentFile[]>
        remove: (path: string) => Promise<WriteResult>
      }
      app: {
        setDirty:       (dirty: boolean) => void
        forceClose:     () => void
        onRequestClose: (cb: () => void) => () => void
      }
      file: {
        /** null = dialog dibatalkan user */
        open:               () => Promise<ReadResult | null>
        /** `recentWarning` = dokumen tersimpan, tapi recent.json gagal diperbarui (Bug #17) — non-fatal */
        save:               (note: { title: string; content: string; filePath?: string | null }) => Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string; recentWarning?: string }>
        openAsContext:      () => Promise<ReadResult | null>
        readDirect:         (path: string) => Promise<ReadResult>
        getPendingOpenPath: () => Promise<string | null>
        onOpenExternal:     (cb: (path: string) => void) => () => void
      }
      ai: {
        validateKey:       (provider: string, key?: string) => Promise<ValidateKeyResult>
        getVerifiedLimits: () => Promise<Record<string, number>>
        /** [Celah 2] Cache per-key di main; `force: true` = lewati cache (tombol Refresh) */
        getModels: (provider: string, opts?: { force?: boolean }) => Promise<ValidateKeyResult>
        stream: (req: {
          requestId: string
          model: string
          messages: { role: string; content: string }[]
          systemPrompt: string
          maxOutputTokens: number
        }) => Promise<{ started: boolean }>
        cancel:  (requestId: string) => void
        onChunk: (cb: (payload: AIChunkPayload) => void) => () => void
      }
      openExternal: (url: string) => void
      /** true saat proses main dijalankan dengan STUDYAI_PERF=1. */
      perf: boolean
    }
  }
}
