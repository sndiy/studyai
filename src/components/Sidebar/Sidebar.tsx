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

const NAV_ITEMS: { id: View; icon: string; label: string }[] = [
  { id: 'editor',   icon: 'ti-edit',     label: 'Editor' },
  { id: 'ai',       icon: 'ti-sparkles', label: 'Tanya AI' },
  { id: 'settings', icon: 'ti-settings', label: 'Pengaturan' },
]

export default function Sidebar() {
  const {
    currentView, setView,
    doc, openFile, newDoc,
    recentFiles, openRecent, removeRecent,
    settings, sidebarCollapsed, toggleSidebar,
  } = useStore()

  const activeModel = settings?.active_model ?? 'gemini-2.0-flash'
  // [S2] Renderer tidak lagi menerima API key — cukup tahu sudah terisi atau belum
  const hasKey = !!(settings?.has_gemini_key || settings?.has_openai_key)

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>

      {/* Logo + tombol lipat */}
      <div className="sidebar-top">
        <div className="logo-row">
          <img className="logo-icon" src={logoUrl} alt="" width={26} height={26} />
          <span className="logo-text">StudyAI</span>
          <button
            className="sidebar-toggle"
            onClick={toggleSidebar}
            data-tip={sidebarCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            title={sidebarCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            aria-label={sidebarCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
          >
            <i className={`ti ${sidebarCollapsed ? 'ti-layout-sidebar-right-collapse' : 'ti-layout-sidebar-left-collapse'}`} />
          </button>
        </div>
      </div>

      {/* Navigasi */}
      <nav className="nav-section">
        <div className="nav-label">Navigasi</div>
        {NAV_ITEMS.map((item, i) => (
          <button
            key={item.id}
            className={`nav-item ${currentView === item.id ? 'active' : ''}`}
            style={{ '--i': i } as React.CSSProperties}
            onClick={() => setView(item.id)}
            data-tip={item.label}
          >
            {/* Satu-satunya elemen pembawa view-transition-name: saat view
                berganti, pil ini MELUNCUR dari item lama ke item baru. */}
            {currentView === item.id && <span className="nav-pill" aria-hidden="true" />}
            <i className={`ti ${item.icon}`} />
            <span className="nav-text">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Aksi file */}
      <div className="nav-section">
        <div className="nav-label">File</div>
        <button className="nav-item" onClick={newDoc} data-tip="Baru">
          <i className="ti ti-file-plus" />
          <span className="nav-text">Baru</span>
        </button>
        <button className="nav-item" onClick={openFile} data-tip="Buka File">
          <i className="ti ti-folder-open" />
          <span className="nav-text">Buka File</span>
        </button>
      </div>

      {/* Satu region scroll untuk kedua daftar file. Sebelumnya dua section
          sama-sama mengklaim flex:1 dan saling berebut tinggi. */}
      <div className="sidebar-scroll">
        {doc && (
          <section className="file-section">
            <div className="nav-label">File Aktif</div>
            <div className="note-card active">
              <div className="note-card-title">
                <i className="ti ti-file-text" />
                <span className="note-card-title-text">{doc.title || 'Tanpa Judul'}</span>
                {doc.isDirty && <span className="dirty-dot" title="Belum disimpan" />}
              </div>
              {doc.filePath ? (
                <div className="note-card-meta">
                  <i className="ti ti-file-symlink" />
                  <span className="note-card-path">{doc.filePath.split(/[\\/]/).pop()}</span>
                </div>
              ) : (
                <div className="note-card-meta warn">
                  <i className="ti ti-alert-circle" />
                  <span>Belum disimpan ke file</span>
                </div>
              )}
            </div>
          </section>
        )}

        {recentFiles.length > 0 && (
          <section className="file-section">
            <div className="nav-label">Terakhir Dibuka</div>
            {recentFiles.map((f, i) => (
              <div
                key={f.path}
                className={`note-card ${doc?.filePath === f.path ? 'active' : ''}`}
                style={{ '--i': i } as React.CSSProperties}
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
                    aria-label={`Hapus ${f.title || 'file'} dari daftar`}
                  >
                    <i className="ti ti-x" />
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <button
          className="provider-badge"
          onClick={() => setView('settings')}
          data-tip={activeModel}
          title={activeModel}
        >
          <span className={`provider-dot ${hasKey ? 'ok' : 'off'}`} />
          <span className="provider-name">{activeModel}</span>
          <i className="ti ti-chevron-right provider-arrow" />
        </button>
      </div>

    </aside>
  )
}
