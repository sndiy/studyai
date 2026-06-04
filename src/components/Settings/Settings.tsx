import React, { useState, useEffect } from 'react'
import { useStore } from '../../store/useStore'
import './Settings.css'

// Group prefixes for dropdown grouping
const GEMINI_GROUPS: { label: string; match: (m: string) => boolean }[] = [
  { label: 'Gemini 2.0', match: m => m.startsWith('gemini-2.0') },
  { label: 'Gemini 1.5', match: m => m.startsWith('gemini-1.5') },
  { label: 'Lainnya',    match: () => true },
]

function groupModels(models: string[]): { label: string; models: string[] }[] {
  const used = new Set<string>()
  return [
    { label: 'Gemini 2.0', match: (m: string) => m.startsWith('gemini-2.0') },
    { label: 'Gemini 1.5', match: (m: string) => m.startsWith('gemini-1.5') },
    { label: 'Lainnya',    match: () => true },
  ]
    .map(g => ({
      label: g.label,
      models: models.filter(m => !used.has(m) && g.match(m) && (used.add(m), true))
    }))
    .filter(g => g.models.length > 0)
}

const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo']

export default function Settings() {
  const { settings, updateSetting } = useStore()
  const [theme,        setTheme]        = useState(settings?.theme ?? 'dark')
  const [geminiKey,     setGeminiKey]     = useState(settings?.gemini_api_key ?? '')
  const [maxTokens,     setMaxTokens]     = useState(settings?.max_tokens ?? '2048')
  const [openaiKey,     setOpenaiKey]     = useState(settings?.openai_api_key ?? '')
  const [claudeKey,     setClaudeKey]     = useState(settings?.openai_api_key_unused ?? '')
  const [personaName,   setPersonaName]   = useState(settings?.persona_name ?? 'Mai')
  const [personaPrompt, setPersonaPrompt] = useState(settings?.persona_prompt ?? '')
  const [personaLimit,  setPersonaLimit]  = useState(settings?.persona_limit ?? '')
  const [validating,    setValidating]    = useState<string | null>(null)
  const [validMsg,      setValidMsg]      = useState<{ ok: boolean; msg: string } | null>(null)
  const [geminiOpen,    setGeminiOpen]    = useState(true)
  const [detectedModels, setDetectedModels] = useState<string[]>([])
  const [loadingModels,  setLoadingModels]  = useState(false)

  const activeModel = settings?.active_model ?? ''

  useEffect(() => {
    if (settings?.theme) setTheme(settings.theme)
  }, [settings?.theme])

  useEffect(() => {
    if (settings?.gemini_api_key && detectedModels.length === 0) {
      fetchGeminiModels(settings.gemini_api_key)
    }
  }, [settings?.gemini_api_key])

  const handleThemeChange = async (newTheme: 'light' | 'dark') => {
    setTheme(newTheme)
    await updateSetting('theme', newTheme)
  }

  const filterModels = (models: string[]) =>
    models
      .filter(m =>
        m.includes('gemini') &&
        !m.includes('embedding') &&
        !m.includes('vision') &&
        !m.includes('aqa')
      )
      .sort((a, b) => {
        const score = (s: string) => {
          let n = 0
          if (s.includes('2.0')) n += 200
          else if (s.includes('1.5')) n += 100
          // prefer non-preview, non-tts, non-audio, non-image for top slots
          if (!s.includes('preview') && !s.includes('tts') && !s.includes('audio') && !s.includes('image') && !s.includes('native')) n += 10
          if (s.includes('flash') && !s.includes('lite')) n += 4
          else if (s.includes('pro')) n += 3
          else if (s.includes('flash-lite')) n += 2
          return n
        }
        return score(b) - score(a)
      })

  const fetchGeminiModels = async (key: string) => {
    if (!key) return
    setLoadingModels(true)
    try {
      const res = await window.api.ai.validateKey('gemini', key)
      if (res.valid && res.models?.length) {
        setDetectedModels(filterModels(res.models as string[]))
      }
    } catch {}
    setLoadingModels(false)
  }

  const validateGemini = async () => {
    setValidating('gemini'); setValidMsg(null)
    const res = await window.api.ai.validateKey('gemini', geminiKey)
    if (res.valid) {
      await updateSetting('gemini_api_key', geminiKey)
      if (res.models?.length) {
        const filtered = filterModels(res.models as string[])
        setDetectedModels(filtered)
        // auto-select first model if none selected or previous not in list
        if (!filtered.includes(activeModel)) {
          await updateSetting('active_model', filtered[0])
        }
        setValidMsg({ ok: true, msg: `✅ Valid! ${filtered.length} model terdeteksi` })
      } else {
        setValidMsg({ ok: true, msg: '✅ Valid!' })
      }
    } else {
      setValidMsg({ ok: false, msg: `❌ ${res.error}` })
    }
    setValidating(null)
  }

  const savePersona = async () => {
    await updateSetting('persona_name', personaName)
    await updateSetting('persona_prompt', personaPrompt)
    await updateSetting('persona_limit', personaLimit)
    setValidMsg({ ok: true, msg: '✅ Persona disimpan' })
    setTimeout(() => setValidMsg(null), 2000)
  }

  const grouped = groupModels(detectedModels)

  return (
    <div className="settings-panel">
      {/* Tampilan */}
      <div className="settings-section">
        <div className="settings-section-title">
          <i className="ti ti-palette" /> Tampilan
        </div>
        <div className="theme-toggle-row">
          <button 
            className={`theme-btn ${theme === 'light' ? 'active' : ''}`}
            onClick={() => handleThemeChange('light')}
          >
            <i className="ti ti-sun" /> Terang
          </button>
          <button 
            className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => handleThemeChange('dark')}
          >
            <i className="ti ti-moon" /> Gelap
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          <i className="ti ti-cpu" /> AI Providers
        </div>

        {/* Gemini */}
        <div className="provider-card">
          <div className="provider-header" onClick={() => setGeminiOpen(v => !v)}>
            <div className="provider-logo plogo-gemini">G</div>
            <div className="provider-info">
              <div className="provider-pname">Google Gemini</div>
              <div className="provider-status">
                <span className={`status-dot ${settings?.gemini_api_key ? 'ok' : 'off'}`} />
                {settings?.gemini_api_key ? `Connected · ${activeModel}` : 'Tidak terhubung'}
              </div>
            </div>
            <i className={`ti ti-chevron-${geminiOpen ? 'down' : 'right'}`} />
          </div>

          {geminiOpen && (
            <div className="provider-body">
              <label className="field-label">API Key</label>
              <input className="field-input" type="password"
                placeholder="AIzaSy..."
                value={geminiKey}
                onChange={e => setGeminiKey(e.target.value)}
              />
              <button className="model-detect-btn" onClick={validateGemini} disabled={!!validating}>
                <i className={`ti ${validating === 'gemini' ? 'ti-loader-2 spin' : 'ti-plug'}`} />
                {validating === 'gemini' ? 'Memvalidasi...' : 'Validasi & Simpan Key'}
              </button>
              {validMsg && <div className={`valid-msg ${validMsg.ok ? 'ok' : 'err'}`}>{validMsg.msg}</div>}

              {/* Model dropdown — only shown if models detected */}
              {detectedModels.length > 0 && (
                <>
                  <div className="model-select-header">
                    <label className="field-label" style={{ margin: 0 }}>Model Aktif</label>
                    <span className="model-source-badge detected">
                      <i className="ti ti-antenna-bars-5" /> {detectedModels.length} terdeteksi
                    </span>
                    <button className="model-refresh-btn"
                      onClick={() => fetchGeminiModels(settings?.gemini_api_key ?? geminiKey)}
                      disabled={loadingModels}
                      title="Refresh daftar model">
                      <i className={`ti ${loadingModels ? 'ti-loader-2 spin' : 'ti-refresh'}`} />
                    </button>
                  </div>
                  <select
                    className="model-select"
                    value={activeModel}
                    onChange={e => updateSetting('active_model', e.target.value)}
                  >
                    {grouped.map(group => (
                      <optgroup key={group.label} label={group.label}>
                        {group.models.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </>
              )}

              {/* No models yet */}
              {detectedModels.length === 0 && settings?.gemini_api_key && (
                <div className="model-empty-hint">
                  <i className="ti ti-info-circle" /> Validasi ulang key untuk memuat daftar model
                </div>
              )}

              {/* Quota info */}
              <div className="quota-info">
                <i className="ti ti-info-circle" />
                Free tier: 1.5-flash 15 req/mnt · 1.5-pro 2 req/mnt · 2.0-flash experimental
              </div>
            </div>
          )}
        </div>

        {/* OpenAI */}
        <ProviderCard
          logo="O" logoClass="plogo-gpt" name="OpenAI ChatGPT"
          connected={!!settings?.openai_api_key}
          activeModel={activeModel}
          apiKey={openaiKey} setApiKey={setOpenaiKey}
          models={OPENAI_MODELS}
          onSelectModel={m => updateSetting('active_model', m)}
          onSave={async () => { await updateSetting('openai_api_key', openaiKey) }}
        />

        {/* Claude */}
        <ProviderCard
          logo="C" logoClass="plogo-claude" name="Anthropic Claude"
          connected={!!settings?.openai_api_key_unused}
          activeModel={activeModel}
          apiKey={claudeKey} setApiKey={setClaudeKey}
          models={['claude-sonnet-4-5', 'claude-haiku-4-5']}
          onSelectModel={m => updateSetting('active_model', m)}
          onSave={async () => { await updateSetting('openai_api_key_unused', claudeKey) }}
          note="Claude API belum didukung streaming langsung. Gunakan Gemini untuk performa terbaik."
        />
      </div>

      {/* Persona */}
      <div className="settings-section">
        <div className="settings-section-title">
          <i className="ti ti-adjustments" /> Parameter AI
        </div>
        <label className="field-label">Max Tokens per Respons</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <input
            className="field-input" type="number" min={256} max={8192} step={256}
            value={maxTokens}
            onChange={e => setMaxTokens(e.target.value)}
            style={{ width: 140 }}
          />
          <button className="btn-secondary" style={{ fontSize: 11 }}
            onClick={async () => {
              const v = parseInt(maxTokens)
              if (!isNaN(v) && v >= 256) {
                await updateSetting('max_tokens', String(v))
                setValidMsg({ ok: true, msg: `✅ Max tokens disimpan: ${v}` })
                setTimeout(() => setValidMsg(null), 2000)
              }
            }}>
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
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
                {personaName} — Asisten Belajarmu
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Persona aktif · Bahasa Indonesia</div>
            </div>
          </div>
          <label className="field-label">Nama persona</label>
          <input className="field-input" value={personaName}
            onChange={e => setPersonaName(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <label className="field-label">Karakter & kepribadian</label>
          <textarea className="custom-prompt-area"
            value={personaPrompt}
            onChange={e => setPersonaPrompt(e.target.value)}
            rows={4} placeholder="Kamu adalah..."
          />
          <label className="field-label" style={{ marginTop: 10 }}>Batasan jawaban</label>
          <textarea className="custom-prompt-area"
            value={personaLimit}
            onChange={e => setPersonaLimit(e.target.value)}
            rows={3} placeholder="Jawab maksimal 3 paragraf..."
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-primary" onClick={savePersona}>
              <i className="ti ti-device-floppy" /> Simpan Persona
            </button>
            <button className="btn-secondary" onClick={() => {
              setPersonaName('Mai')
              setPersonaPrompt('Kamu adalah Mai, asisten belajar yang cerdas dan supportif. Kamu berbicara dengan hangat tapi tetap fokus pada materi. Gunakan bahasa Indonesia casual.')
              setPersonaLimit('Jawab maksimal 3 paragraf. Sertakan contoh kode untuk topik programming.')
            }}>
              <i className="ti ti-refresh" /> Reset Default
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProviderCard({
  logo, logoClass, name, connected, activeModel,
  apiKey, setApiKey, models, onSelectModel, onSave, note
}: {
  logo: string; logoClass: string; name: string; connected: boolean; activeModel: string;
  apiKey: string; setApiKey: (s: string) => void; models: string[];
  onSelectModel: (m: string) => void; onSave: () => Promise<void>; note?: string;
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  return (
    <div className="provider-card">
      <div className="provider-header" onClick={() => setOpen(v => !v)}>
        <div className={`provider-logo ${logoClass}`}>{logo}</div>
        <div className="provider-info">
          <div className="provider-pname">{name}</div>
          <div className="provider-status">
            <span className={`status-dot ${connected ? 'ok' : 'off'}`} />
            {connected ? `Connected · ${activeModel}` : 'Tidak terhubung'}
          </div>
        </div>
        <i className={`ti ti-chevron-${open ? 'down' : 'right'}`} />
      </div>
      {open && (
        <div className="provider-body">
          {note && <div className="provider-note">{note}</div>}
          <label className="field-label">API Key</label>
          <input className="field-input" type="password"
            placeholder="sk-..."
            value={apiKey} onChange={e => setApiKey(e.target.value)}
          />
          <label className="field-label" style={{ marginTop: 10 }}>Model</label>
          <select className="model-select"
            value={activeModel}
            onChange={e => onSelectModel(e.target.value)}>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="btn-secondary" style={{ marginTop: 10, fontSize: 11 }}
            disabled={saving}
            onClick={async () => { setSaving(true); await onSave(); setSaving(false) }}>
            <i className={`ti ${saving ? 'ti-loader-2 spin' : 'ti-device-floppy'}`} />
            {saving ? 'Menyimpan...' : 'Simpan Key'}
          </button>
        </div>
      )}
    </div>
  )
}