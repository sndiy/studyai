import React from 'react'
import { useStore } from '../../store/useStore'
import type { View } from '../../types'
import './Sidebar.css'
import logoUrl from '../../assets/studyai-logo.png'

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr).getTime()
  if (isNaN(d)) return dateStr
  const diff = Math.floor((Date.now() - d) / 1000)
  if (diff < 60) return 'baru saja'
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`
  return `${Math.floor(diff / 604800)} minggu lalu`
}

// StudyAI Logo — menggunakan asset PNG asli
function StudyAILogo({ size = 28 }: { size?: number }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="StudyAI"
      style={{ flexShrink: 0, borderRadius: 4, objectFit: 'contain' }}
    />
  )
}

export default function Sidebar() {
  const {
    currentView, setView,
    doc, openFile, newDoc,
    recentFiles, openRecent, removeRecent,
    settings,
  } = useStore()

  const navItems: { id: View; icon: string; label: string }[] = [
    { id: 'editor', icon: 'ti-edit', label: 'Editor' },
    { id: 'ai', icon: 'ti-sparkles', label: 'Tanya AI' },
    { id: 'settings', icon: 'ti-settings', label: 'Pengaturan' },
  ]

  const activeModel = settings?.active_model ?? 'gemini-1.5-flash'
  const hasKey = !!(settings?.gemini_api_key || settings?.openai_api_key)

  return (
    <aside className="sidebar">

      {/* Logo */}
      <div className="sidebar-top">
        <div className="logo-row">
          <div className="logo-icon">
            <StudyAILogo size={28} />
          </div>
          <span className="logo-text">StudyAI</span>
          <span className="logo-ver">v2.2</span>
        </div>
      </div>

      {/* Navigasi */}
      <div className="nav-section">
        <div className="nav-label">Navigasi</div>
        {navItems.map(item => (
          <div
            key={item.id}
            className={`nav-item ${currentView === item.id ? 'active' : ''}`}
            onClick={() => setView(item.id)}
          >
            <i className={`ti ${item.icon}`} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Aksi file */}
      <div className="nav-section" style={{ paddingTop: 4 }}>
        <div className="nav-label">File</div>
        <div className="nav-item" onClick={newDoc}>
          <i className="ti ti-file-plus" />
          <span>Baru</span>
        </div>
        <div className="nav-item" onClick={openFile}>
          <i className="ti ti-folder-open" />
          <span>Buka File</span>
        </div>
      </div>

      {/* File aktif */}
      {doc && (
        <div className="last-opened-section">
          <div className="nav-label">File Aktif</div>
          <div className={`note-card active`}>
            <div className="note-card-title">
              <i className="ti ti-file-text" />
              <span className="note-card-title-text">{doc.title || 'Tanpa Judul'}</span>
              {doc.isDirty && <span className="dirty-dot" title="Belum disimpan" />}
            </div>
            {doc.filePath && (
              <div className="note-card-meta" style={{ fontSize: 10 }}>
                <i className="ti ti-file-symlink" />
                <span style={{ opacity: 0.6, wordBreak: 'break-all' }}>
                  {doc.filePath.split(/[\\\/]/).pop()}
                </span>
              </div>
            )}
            {!doc.filePath && (
              <div className="note-card-meta" style={{ fontSize: 10, color: 'var(--yellow)' }}>
                <i className="ti ti-alert-circle" />
                <span>Belum disimpan ke file</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent files */}
      {recentFiles.length > 0 && (
        <div className="last-opened-section" style={{ flex: 1, overflowY: 'auto' }}>
          <div className="nav-label">Terakhir Dibuka</div>
          {recentFiles.map(f => (
            <div
              key={f.path}
              className={`note-card ${doc?.filePath === f.path ? 'active' : ''}`}
              onClick={() => openRecent(f.path, f.title)}
            >
              <div className="note-card-title">
                <i className="ti ti-file-text" />
                <span className="note-card-title-text">{f.title || 'Tanpa Judul'}</span>
              </div>
              <div className="note-card-meta">
                <i className="ti ti-clock" />
                <span>{timeAgo(f.updatedAt)}</span>
                <button
                  className="recent-remove-btn"
                  onClick={e => { e.stopPropagation(); removeRecent(f.path) }}
                  title="Hapus dari daftar"
                >
                  <i className="ti ti-x" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="provider-badge" onClick={() => setView('settings')}>
          <span className={`provider-dot ${hasKey ? 'ok' : 'off'}`} />
          <span className="provider-name">{activeModel}</span>
          <i className="ti ti-chevron-down provider-arrow" />
        </div>
      </div>

    </aside>
  )
}
