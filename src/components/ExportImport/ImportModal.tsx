import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import './Modal.css'

interface Props { onClose: () => void }

type Format = 'json' | 'md' | 'txt'
type Strategy = 'skip' | 'overwrite' | 'keep_both'

const FORMAT_BTNS: { id: Format; label: string; icon: string }[] = [
  { id: 'json', label: 'JSON Backup', icon: 'ti-database' },
  { id: 'md',   label: 'Markdown (.md)', icon: 'ti-file-text' },
  { id: 'txt',  label: 'TXT', icon: 'ti-txt' },
]

const STRATEGIES: { id: Strategy; label: string; desc: string }[] = [
  { id: 'skip',      label: 'Lewati',         desc: 'Abaikan rangkuman yang sudah ada' },
  { id: 'overwrite', label: 'Timpa',           desc: 'Ganti isi rangkuman yang sudah ada' },
  { id: 'keep_both', label: 'Simpan keduanya', desc: 'Buat duplikat dengan suffix "(import)"' },
]

export default function ImportModal({ onClose }: Props) {
  const {
    importPreview, importMergeStrategy, importStatus,
    importBulkNotes, setImportPreview, setImportMergeStrategy, doImport
  } = useStore()
  const [loading, setLoading] = useState(false)
  const [doneMsg, setDoneMsg] = useState('')

  const handlePick = async (format: Format) => {
    setLoading(true)
    setDoneMsg('')
    await importBulkNotes(format)
    setLoading(false)
  }

  const handleImport = async () => {
    if (importPreview.length === 0) return
    setLoading(true)
    const res = await doImport()
    setDoneMsg(`✓ Selesai! Ditambah: ${res.added}${res.overwritten ? ` · Ditimpa: ${res.overwritten}` : ''}${res.skipped ? ` · Dilewati: ${res.skipped}` : ''}`)
    setLoading(false)
    setImportPreview([])
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box">
        <div className="modal-header">
          <div className="modal-title"><i className="ti ti-upload" /> Import Rangkuman</div>
          <button className="modal-close" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="modal-body">
          <div className="modal-subtitle">Pilih format file yang ingin di-import:</div>

          <div className="import-format-row">
            {FORMAT_BTNS.map(f => (
              <button key={f.id} className="btn-format" onClick={() => handlePick(f.id)} disabled={loading}>
                <i className={`ti ${f.icon}`} /> {f.label}
              </button>
            ))}
          </div>

          {/* Preview */}
          {(importStatus || importPreview.length > 0) && (
            <div className="import-preview-box">
              <div className="preview-header">
                {loading && <i className="ti ti-loader-2 spin" style={{ marginRight: 6 }} />}
                {importStatus}
              </div>
              {importPreview.length > 0 && (
                <div className="preview-list">
                  {importPreview.slice(0, 20).map((n, i) => (
                    <div key={i} className="preview-row">
                      <span className="preview-cat">{n.category}</span>
                      <span className="preview-title">{n.title}</span>
                    </div>
                  ))}
                  {importPreview.length > 20 && (
                    <div className="preview-more">... dan {importPreview.length - 20} lainnya</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Merge strategy */}
          {importPreview.length > 0 && (
            <>
              <div className="modal-subtitle" style={{ marginTop: 12 }}>Jika ada duplikat (judul sama):</div>
              <div className="strategy-row">
                {STRATEGIES.map(s => (
                  <button
                    key={s.id}
                    className={`btn-strategy ${importMergeStrategy === s.id ? 'active' : ''}`}
                    onClick={() => setImportMergeStrategy(s.id)}
                  >
                    {s.label}
                    <div className="strategy-desc">{s.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {doneMsg && <div className="modal-status ok">{doneMsg}</div>}
        </div>
        <div className="modal-footer">
          {importPreview.length > 0 && !doneMsg && (
            <button className="btn-primary" disabled={loading} onClick={handleImport}>
              {loading
                ? <><i className="ti ti-loader-2 spin" /> Mengimpor...</>
                : <><i className="ti ti-upload" /> Import {importPreview.length} Rangkuman</>}
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>
            {doneMsg ? 'Tutup' : 'Batal'}
          </button>
        </div>
      </div>
    </div>
  )
}
