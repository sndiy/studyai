import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import './Modal.css'

interface Props { onClose: () => void }

const FORMATS = [
  {
    id: 'json' as const,
    icon: 'ti-database',
    title: 'JSON — Backup Lengkap',
    desc: 'Semua data + tanggal + kategori. Bisa di-import kembali ke StudyAI.',
    color: 'var(--accent-soft)'
  },
  {
    id: 'md_single' as const,
    icon: 'ti-file-text',
    title: 'Markdown — Satu File (.md)',
    desc: 'Semua rangkuman dalam satu file. Bagus untuk dibaca di editor lain.',
    color: 'var(--green)'
  },
  {
    id: 'md_folder' as const,
    icon: 'ti-folder',
    title: 'Markdown — Per File (folder)',
    desc: 'Setiap rangkuman jadi file .md terpisah di dalam folder yang kamu pilih.',
    color: 'var(--yellow)'
  },
  {
    id: 'txt' as const,
    icon: 'ti-txt',
    title: 'TXT — Plain Text',
    desc: 'Format teks polos, kompatibel dengan Notepad atau aplikasi apapun.',
    color: 'var(--text-muted)'
  },
]

export default function ExportModal({ onClose }: Props) {
  const { notes, exportAllNotes, exportStatus } = useStore()
  const [loading, setLoading] = useState<string | null>(null)

  const handleExport = async (format: 'json' | 'md_single' | 'md_folder' | 'txt') => {
    setLoading(format)
    await exportAllNotes(format)
    setLoading(null)
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box">
        <div className="modal-header">
          <div className="modal-title"><i className="ti ti-download" /> Export Rangkuman</div>
          <button className="modal-close" onClick={onClose}><i className="ti ti-x" /></button>
        </div>
        <div className="modal-body">
          <div className="modal-subtitle">{notes.length} rangkuman siap di-export</div>

          {FORMATS.map(f => (
            <div key={f.id} className="export-row">
              <div className="export-info">
                <div className="export-title" style={{ color: f.color }}>
                  <i className={`ti ${f.icon}`} /> {f.title}
                </div>
                <div className="export-desc">{f.desc}</div>
              </div>
              <button
                className="btn-export"
                style={{ borderColor: f.color, color: f.color }}
                disabled={!!loading || notes.length === 0}
                onClick={() => handleExport(f.id)}
              >
                {loading === f.id
                  ? <><i className="ti ti-loader-2 spin" /> Mengekspor...</>
                  : <><i className="ti ti-download" /> Export</>}
              </button>
            </div>
          ))}

          {exportStatus && (
            <div className={`modal-status ${exportStatus.startsWith('✓') ? 'ok' : 'err'}`}>
              {exportStatus}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  )
}
