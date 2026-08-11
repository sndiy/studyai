import React, { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { providerOf, sortModelsForDisplay, groupModelsByVersion } from '../../lib/providers'
import { revealTheme } from '../../lib/theme'
import { DEFAULT_PERSONA_NAME, DEFAULT_PERSONA_PROMPT, DEFAULT_PERSONA_LIMIT } from '../../lib/personaDefaults'
import './Settings.css'

export default function Settings() {
  // [L5] Sebelumnya `useStore()` tanpa selector — pola yang [Bug #16] sendiri
  // larang di Chat.tsx — membuat komponen ini berlangganan ke SELURUH store,
  // jadi Settings re-render pada SETIAP token stream chat walau sedang
  // dibuka di tab lain, dan pada setiap perubahan state lain yang sama
  // sekali tidak dibaca komponen ini.
  const settings           = useStore(s => s.settings)
  const updateSetting      = useStore(s => s.updateSetting)
  const providerModels     = useStore(s => s.providerModels)
  const loadProviderModels = useStore(s => s.loadProviderModels)
  const showToast          = useStore(s => s.showToast)
  const [theme,        setTheme]        = useState(settings?.theme ?? 'dark')
  // [S2] Field key selalu mulai kosong — nilainya tidak pernah dikirim ke renderer.
  // Kosong = "biarkan key yang tersimpan"; diisi = "ganti dengan yang ini".
  const [geminiKey,     setGeminiKey]     = useState('')
  const [openaiKey,     setOpenaiKey]     = useState('')
  const [maxTokens,     setMaxTokens]     = useState(settings?.max_tokens ?? '2048')
  const [personaName,   setPersonaName]   = useState(settings?.persona_name ?? 'Mai')
  const [personaPrompt, setPersonaPrompt] = useState(settings?.persona_prompt ?? '')
  const [personaLimit,  setPersonaLimit]  = useState(settings?.persona_limit ?? '')
  const [validating,    setValidating]    = useState<string | null>(null)
  const [validMsg,      setValidMsg]      = useState<{ ok: boolean; msg: string } | null>(null)

  const activeModel = settings?.active_model ?? ''

  useEffect(() => {
    if (settings?.theme) setTheme(settings.theme)
  }, [settings?.theme])

  // [A5] State lokal dulu hanya diinisialisasi sekali. Kalau panel ini ter-mount
  // sebelum loadSettings() selesai, semua field tetap kosong selamanya — lalu
  // "Simpan Persona" menimpa nilai asli dengan string kosong.
  const hydrated = useRef(false)
  useEffect(() => {
    if (!settings || hydrated.current) return
    hydrated.current = true
    setMaxTokens(settings.max_tokens ?? '2048')
    setPersonaName(settings.persona_name ?? 'Mai')
    setPersonaPrompt(settings.persona_prompt ?? '')
    setPersonaLimit(settings.persona_limit ?? '')
  }, [settings])

  // [Celah 2] TIDAK ADA fetch di sini. `loadSettings()` di store sudah
  // menghangatkan `providerModels` sekali di awal (dan main punya cache
  // per-key sendiri), jadi Settings remount tidak memicu request jaringan.

  // Sapuan melingkar dari titik klik — lihat src/lib/theme.ts
  const handleThemeChange = (newTheme: 'light' | 'dark', e: React.MouseEvent) => {
    if (newTheme === theme) return
    revealTheme(newTheme, { x: e.clientX, y: e.clientY })
    setTheme(newTheme)
    void updateSetting('theme', newTheme)
  }

  const geminiModels = providerModels.gemini
  const openaiModels = providerModels.openai

  // [Aturan 4][Celah 3] Peringatan hanya kalau daftar terverifikasi provider
  // yang SAMA dengan model aktif sudah ada dan tidak memuat model itu.
  const geminiMissingActive = providerOf(activeModel) === 'gemini' && geminiModels.models.length > 0 && !geminiModels.models.includes(activeModel)
  const openaiMissingActive = providerOf(activeModel) === 'openai' && openaiModels.models.length > 0 && !openaiModels.models.includes(activeModel)

  // [Celah 3 — bugfix] Sebelumnya validasi SATU provider bisa membajak
  // `active_model` walau model aktif sebenarnya milik provider lain (mis. user
  // sedang pakai gpt-4o lalu menekan "Validasi & Simpan Key" di kartu Gemini).
  // Auto-switch sekarang hanya terjadi kalau model aktif memang milik provider
  // yang baru divalidasi, atau belum ada model valid sama sekali (provider tidak
  // dikenali). Selain itu, biarkan — peringatan di kartu masing-masing sudah cukup.
  function decideModelSwitch(provider: 'gemini' | 'openai', list: string[]): string | null {
    const belongsHere = providerOf(activeModel) === provider
    const noneValid   = providerOf(activeModel) === 'unknown'
    if ((belongsHere || noneValid) && list.length > 0 && !list.includes(activeModel)) {
      // [M4] Sebelumnya `list[0]` — urutan MENTAH dari provider (ListModels
      // Gemini/GET /v1/models OpenAI), bukan urutan tampilan. Auto-switch bisa
      // memilih model preview/eksperimental yang justru ada di paling bawah
      // dropdown. Pakai urutan yang sama dengan yang dilihat user.
      return sortModelsForDisplay(list)[0]
    }
    return null
  }

  // [Aturan 3] Kegagalan TIDAK boleh ditelan diam-diam — errornya sendiri sudah
  // ditampilkan lewat `providerModels.<provider>.error` di kartu masing-masing.
  const validateGemini = async () => {
    setValidating('gemini'); setValidMsg(null)
    try {
      // Field kosong = validasi ulang key yang sudah tersimpan
      const keyToSend = geminiKey.trim() || undefined
      if (!keyToSend && !settings?.has_gemini_key) {
        setValidMsg({ ok: false, msg: '❌ Isi API key dulu' })
        return
      }

      const res = await window.api.ai.validateKey('gemini', keyToSend)
      if (!res.valid) {
        setValidMsg({ ok: false, msg: `❌ ${res.error}` })
        return
      }

      if (keyToSend) {
        if (!await updateSetting('gemini_api_key', keyToSend)) return
        setGeminiKey('')   // jangan biarkan key mengendap di state renderer
      }

      // Key yang baru saja divalidasi sudah di-cache di main (fingerprint sama),
      // jadi ini praktis langsung dari cache — bukan request jaringan kedua.
      await loadProviderModels('gemini')
      const list = useStore.getState().providerModels.gemini.models

      const switchTo = decideModelSwitch('gemini', list)
      if (switchTo) {
        const previous = activeModel
        await updateSetting('active_model', switchTo)
        setValidMsg({
          ok: true,
          msg: previous
            ? `✅ Valid! ${list.length} model terdeteksi. Model "${previous}" tidak tersedia untuk key ini — diganti ke "${switchTo}".`
            : `✅ Valid! ${list.length} model terdeteksi`,
        })
      } else {
        setValidMsg({ ok: true, msg: list.length ? `✅ Valid! ${list.length} model terdeteksi` : '✅ Valid!' })
      }
    } finally {
      setValidating(null)
    }
  }

  // [Aturan 1 & 3] OpenAI kini benar-benar divalidasi lewat GET /v1/models.
  // Sebelumnya main langsung membalas valid tanpa memanggil API sama sekali.
  const validateOpenAI = async () => {
    setValidating('openai'); setValidMsg(null)
    try {
      const keyToSend = openaiKey.trim() || undefined
      if (!keyToSend && !settings?.has_openai_key) {
        showToast('err', 'Isi API key OpenAI dulu')
        return
      }

      const res = await window.api.ai.validateKey('openai', keyToSend)
      if (!res.valid) {
        showToast('err', String(res.error))
        return
      }

      if (keyToSend) {
        if (!await updateSetting('openai_api_key', keyToSend)) return
        setOpenaiKey('')
      }

      await loadProviderModels('openai')
      const list = useStore.getState().providerModels.openai.models

      const switchTo = decideModelSwitch('openai', list)
      if (switchTo) {
        const previous = activeModel
        await updateSetting('active_model', switchTo)
        showToast('ok', previous
          ? `Key OpenAI valid — ${list.length} model terdeteksi. Model "${previous}" tidak tersedia, diganti ke "${switchTo}".`
          : `Key OpenAI valid — ${list.length} model terdeteksi`)
      } else {
        showToast('ok', `Key OpenAI valid — ${list.length} model terdeteksi`)
      }
    } finally {
      setValidating(null)
    }
  }

  // [B8] Kalau salah satu penulisan gagal, berhenti dan jangan klaim "disimpan".
  // Pesan error-nya sendiri sudah dimunculkan sebagai toast global oleh updateSetting.
  const savePersona = async () => {
    if (!await updateSetting('persona_name', personaName))     return
    if (!await updateSetting('persona_prompt', personaPrompt)) return
    if (!await updateSetting('persona_limit', personaLimit))   return
    showToast('ok', 'Persona disimpan')
  }

  // [B17] Clamp dua arah — atribut max pada input number tidak memaksa apa pun
  // untuk nilai yang diketik manual.
  const saveMaxTokens = async () => {
    const parsed = parseInt(maxTokens)
    if (isNaN(parsed)) {
      showToast('err', 'Max tokens harus berupa angka')
      return
    }
    const v = Math.min(8192, Math.max(256, parsed))
    if (v !== parsed) setMaxTokens(String(v))
    if (!await updateSetting('max_tokens', String(v))) return
    showToast('ok', v !== parsed
      ? `Max tokens disesuaikan ke batas valid: ${v}`
      : `Max tokens disimpan: ${v}`)
  }

  const grouped = groupModelsByVersion(sortModelsForDisplay(geminiModels.models))

  return (
    <div className="settings-panel">
      <header className="settings-head">
        <h1 className="settings-title">Pengaturan</h1>
        <p className="settings-subtitle">Tema, provider AI, dan persona asisten</p>
      </header>

      {/* [A4] File settings rusak — jangan diam-diam pakai default lalu menimpanya */}
      {settings?.settings_unreadable && (
        <div className="settings-warning">
          <i className="ti ti-alert-triangle" />
          <span>
            File pengaturan tidak bisa dibaca, jadi yang tampil sekarang adalah nilai default.
            Menyimpan apa pun di halaman ini akan mencadangkan file lama
            (<code>settings.json.corrupt-….bak</code>) sebelum menulis yang baru.
          </span>
        </div>
      )}
      {/* [S1] Kalau OS tidak menyediakan enkripsi, user berhak tahu */}
      {settings && !settings.encryption_available && (
        <div className="settings-warning">
          <i className="ti ti-lock-open" />
          <span>
            Sistem ini tidak menyediakan penyimpanan terenkripsi (safeStorage),
            jadi API key terpaksa disimpan tanpa enkripsi di folder data aplikasi.
          </span>
        </div>
      )}

      {/* Tampilan */}
      <div className="settings-section">
        <div className="settings-section-title">
          <i className="ti ti-palette" /> Tampilan
        </div>
        <div className="theme-toggle-row">
          <button
            className={`theme-btn ${theme === 'light' ? 'active' : ''}`}
            onClick={e => handleThemeChange('light', e)}
          >
            <i className="ti ti-sun" /> Terang
          </button>
          <button
            className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
            onClick={e => handleThemeChange('dark', e)}
          >
            <i className="ti ti-moon" /> Gelap
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          <i className="ti ti-cpu" /> AI Providers
        </div>

        {/* Gemini — dulu kartu ini disalin tangan dari ProviderCard dan keduanya
            harus dijaga sinkron manual. Sekarang perbedaannya cuma props. */}
        <ProviderCard
          logo="G" logoClass="plogo-gemini" name="Google Gemini"
          defaultOpen
          keyPlaceholder="AIzaSy..."
          modelLabel="Model Aktif"
          connected={!!settings?.has_gemini_key}
          hasStoredKey={!!settings?.has_gemini_key}
          activeModel={activeModel}
          apiKey={geminiKey} setApiKey={setGeminiKey}
          // [Celah 4 poin 4] Bagian model muncul begitu ada key — tidak peduli
          // sukses/gagalnya pemuatan terakhir — supaya user bisa retry tanpa
          // harus menekan ulang "Validasi & Simpan Key".
          models={settings?.has_gemini_key ? geminiModels.models : null}
          modelGroups={grouped}
          modelsError={geminiModels.error}
          modelsLoading={geminiModels.loading}
          modelMissing={geminiMissingActive}
          onSelectModel={m => updateSetting('active_model', m)}
          onRefreshModels={() => loadProviderModels('gemini', true)}
          onValidate={validateGemini}
          validating={validating === 'gemini'}
          validMsg={validMsg}
        />

        {/* OpenAI */}
        <ProviderCard
          logo="O" logoClass="plogo-gpt" name="OpenAI ChatGPT"
          connected={!!settings?.has_openai_key}
          hasStoredKey={!!settings?.has_openai_key}
          activeModel={activeModel}
          apiKey={openaiKey} setApiKey={setOpenaiKey}
          models={openaiModels.models}
          modelsError={openaiModels.error}
          modelsLoading={openaiModels.loading}
          modelMissing={openaiMissingActive}
          onSelectModel={m => updateSetting('active_model', m)}
          onRefreshModels={() => loadProviderModels('openai', true)}
          onValidate={validateOpenAI}
          validating={validating === 'openai'}
        />
      </div>

      {/* Persona */}
      <div className="settings-section">
        <div className="settings-section-title">
          <i className="ti ti-adjustments" /> Parameter AI
        </div>
        <label className="field-label">Max Tokens per Respons</label>
        <div className="field-row">
          <input
            className="field-input narrow" type="number" min={256} max={8192} step={256}
            value={maxTokens}
            onChange={e => setMaxTokens(e.target.value)}
          />
          <button className="btn-secondary" onClick={saveMaxTokens}>
            <i className="ti ti-device-floppy" /> Simpan
          </button>
        </div>
        <div className="quota-info"><i className="ti ti-info-circle" /> Gemini: maks 8192. Lebih tinggi = respons lebih panjang tapi lebih lambat.</div>
      </div>

      {/* Persona */}
      <div className="settings-section">
        <div className="settings-section-title">
          <i className="ti ti-mood-smile" /> Custom AI Persona
        </div>
        <div className="persona-section">
          <div className="persona-header">
            <div className="persona-big-avatar">🌸</div>
            <div>
              <div className="persona-title">{personaName} — Asisten Belajarmu</div>
              <div className="persona-meta">Persona aktif · Bahasa Indonesia</div>
            </div>
          </div>
          <label className="field-label">Nama persona</label>
          <input className="field-input" value={personaName}
            onChange={e => setPersonaName(e.target.value)}
          />
          <label className="field-label">Karakter &amp; kepribadian</label>
          <textarea className="custom-prompt-area"
            value={personaPrompt}
            onChange={e => setPersonaPrompt(e.target.value)}
            rows={4} placeholder="Kamu adalah..."
          />
          <label className="field-label">Batasan jawaban</label>
          <textarea className="custom-prompt-area"
            value={personaLimit}
            onChange={e => setPersonaLimit(e.target.value)}
            rows={3} placeholder="Jawab maksimal 3 paragraf..."
          />
          <div className="persona-actions">
            <button className="btn-primary" onClick={savePersona}>
              <i className="ti ti-device-floppy" /> Simpan Persona
            </button>
            <button className="btn-secondary" onClick={async () => {
              // [L3] Sebelumnya punya teks defaultnya SENDIRI (beda dari yang
              // benar-benar ditulis ke settings.json baru) dan hanya mengubah
              // state lokal — persona lama tetap tersimpan sampai user
              // menekan "Simpan Persona" secara terpisah, tanpa pemberitahuan
              // bahwa langkah itu masih diperlukan. Sekarang memakai satu
              // konstanta yang sama dengan default aplikasi DAN langsung tersimpan.
              setPersonaName(DEFAULT_PERSONA_NAME)
              setPersonaPrompt(DEFAULT_PERSONA_PROMPT)
              setPersonaLimit(DEFAULT_PERSONA_LIMIT)
              if (!await updateSetting('persona_name', DEFAULT_PERSONA_NAME))     return
              if (!await updateSetting('persona_prompt', DEFAULT_PERSONA_PROMPT)) return
              if (!await updateSetting('persona_limit', DEFAULT_PERSONA_LIMIT))   return
              showToast('ok', 'Persona dikembalikan ke default')
            }}>
              <i className="ti ti-refresh" /> Reset Default
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Satu kartu untuk SEMUA provider. Gemini dulu punya salinan tangan sendiri;
 * perbedaannya (terbuka secara default, model dikelompokkan optgroup, pesan
 * validasi, catatan kuota) sekarang jadi props.
 *
 * Urutan isinya: key → tombol validasi/simpan → pesan hasil → daftar model →
 * catatan. Validasi dulu, baru pilih model.
 */
function ProviderCard({
  logo, logoClass, name, connected, hasStoredKey, activeModel,
  apiKey, setApiKey, models, modelGroups, modelsError, modelsLoading, modelMissing,
  onSelectModel, onRefreshModels, onSave, onValidate, validating, note,
  defaultOpen = false, keyPlaceholder = 'sk-...', modelLabel = 'Model',
  validMsg, footer,
}: {
  logo: string; logoClass: string; name: string; connected: boolean; hasStoredKey: boolean;
  activeModel: string;
  apiKey: string; setApiKey: (s: string) => void;
  /** null = provider ini tidak punya pemilihan model */
  models: string[] | null;
  /** Ada = model ditampilkan berkelompok dalam optgroup, bukan daftar datar */
  modelGroups?: { label: string; models: string[] }[] | null;
  modelsError?: string | null;
  modelsLoading?: boolean;
  /** [Aturan 4] Model aktif tidak ada di daftar terverifikasi provider ini */
  modelMissing?: boolean;
  onSelectModel: (m: string) => void;
  /** [Celah 2] Ada = provider ini punya tombol Refresh manual */
  onRefreshModels?: () => void;
  onSave?: () => Promise<void>;
  /** Ada = key divalidasi ke provider sebelum disimpan (aturan 1) */
  onValidate?: () => Promise<void>;
  validating?: boolean;
  note?: string;
  defaultOpen?: boolean;
  keyPlaceholder?: string;
  modelLabel?: string;
  validMsg?: { ok: boolean; msg: string } | null;
  footer?: string;
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [saving, setSaving] = useState(false)

  return (
    <div className="provider-card">
      <button className="provider-header" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <div className={`provider-logo ${logoClass}`}>{logo}</div>
        <div className="provider-info">
          <div className="provider-pname">{name}</div>
          <div className="provider-status">
            <span className={`status-dot ${connected ? 'ok' : 'off'}`} />
            {connected ? `Connected · ${activeModel}` : 'Tidak terhubung'}
          </div>
        </div>
        <i className={`ti ti-chevron-right provider-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="provider-body">
          {note && <div className="provider-note">{note}</div>}

          <label className="field-label">API Key</label>
          <input className="field-input" type="password"
            placeholder={hasStoredKey ? '•••••••• (tersimpan) — isi untuk mengganti' : keyPlaceholder}
            value={apiKey} onChange={e => setApiKey(e.target.value)}
          />

          {onValidate ? (
            <button className="model-detect-btn" disabled={!!validating} onClick={onValidate}>
              <i className={`ti ${validating ? 'ti-loader-2 spin' : 'ti-plug'}`} />
              {validating ? 'Memvalidasi...' : 'Validasi & Simpan Key'}
            </button>
          ) : onSave ? (
            <button className="model-detect-btn" disabled={saving}
              onClick={async () => { setSaving(true); await onSave(); setSaving(false) }}>
              <i className={`ti ${saving ? 'ti-loader-2 spin' : 'ti-device-floppy'}`} />
              {saving ? 'Menyimpan...' : 'Simpan Key'}
            </button>
          ) : null}

          {validMsg && <div className={`valid-msg ${validMsg.ok ? 'ok' : 'err'}`}>{validMsg.msg}</div>}

          {models !== null && (
            <>
              <div className="model-select-header">
                <label className="field-label flush">{modelLabel}</label>
                {models.length > 0 && (
                  <span className="model-source-badge detected">
                    <i className="ti ti-antenna-bars-5" /> {models.length} terdeteksi
                  </span>
                )}
                {onRefreshModels && (
                  <button className="model-refresh-btn"
                    onClick={onRefreshModels}
                    disabled={!!modelsLoading}
                    title="Refresh daftar model">
                    <i className={`ti ${modelsLoading ? 'ti-loader-2 spin' : 'ti-refresh'}`} />
                  </button>
                )}
              </div>

              {/* [Aturan 3] Jangan tampilkan daftar tebakan — katakan apa adanya */}
              {modelsError && (
                <div className="model-empty-hint valid-msg err">
                  <i className="ti ti-alert-circle" /> Gagal memuat daftar model: {modelsError}
                </div>
              )}

              {!modelsError && models.length === 0 && (
                <div className="model-empty-hint">
                  <i className="ti ti-info-circle" />
                  {modelsLoading ? 'Memuat daftar model...' : 'Validasi key untuk memuat daftar model dari provider'}
                </div>
              )}

              {models.length > 0 && (
                // Model aktif bisa milik provider lain — jangan tampilkan seolah terpilih di sini
                <select className="model-select"
                  value={models.includes(activeModel) ? activeModel : ''}
                  onChange={e => e.target.value && onSelectModel(e.target.value)}>
                  {!models.includes(activeModel) && <option value="">— pilih model —</option>}
                  {modelGroups && modelGroups.length > 0
                    ? modelGroups.map(g => (
                        <optgroup key={g.label} label={g.label}>
                          {g.models.map(m => <option key={m} value={m}>{m}</option>)}
                        </optgroup>
                      ))
                    : models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}

              {modelMissing && (
                <div className="settings-warning inline">
                  <i className="ti ti-alert-triangle" />
                  <span>
                    Model aktif <code>{activeModel}</code> tidak ada di daftar yang bisa diakses
                    key ini. Pilih model lain di atas sebelum mengirim pesan.
                  </span>
                </div>
              )}
            </>
          )}

          {footer && (
            <div className="quota-info">
              <i className="ti ti-info-circle" />
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
