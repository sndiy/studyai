import React from 'react'
import { useStore } from '../../store/useStore'
import type { View } from '../../types'
import './Sidebar.css'

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const d = new Date(dateStr).getTime()
  if (isNaN(d)) return dateStr
  const diff = Math.floor((now - d) / 1000)
  if (diff < 60) return 'baru saja'
  if (diff < 3600) return `${Math.floor(diff/60)} menit lalu`
  if (diff < 86400) return `${Math.floor(diff/3600)} jam lalu`
  if (diff < 604800) return `${Math.floor(diff/86400)} hari lalu`
  return `${Math.floor(diff/604800)} minggu lalu`
}

export default function Sidebar() {
  const {
    notes, selectedNote, selectNote, createNote,
    currentView, setView, settings, streak,
    lastOpenedNote,
  } = useStore()

  const navItems: { id: View; icon: string; label: string }[] = [
    { id: 'notes',    icon: 'ti-books',       label: 'Semua Rangkuman' },
    { id: 'ai',       icon: 'ti-sparkles',     label: 'Tanya AI'        },
    { id: 'stats',    icon: 'ti-chart-line',   label: 'Statistik'       },
    { id: 'settings', icon: 'ti-settings',     label: 'Pengaturan'      },
  ]

  const activeModel = settings?.active_model ?? 'gemini-2.5-flash'
  const hasKey = !!(settings?.gemini_api_key || settings?.openai_api_key)

  // Note yang ditampilkan di preview: selectedNote jika ada, fallback ke lastOpenedNote
  const previewNote = selectedNote ?? lastOpenedNote

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="logo-row">
          <div className="logo-icon">📚</div>
          <span className="logo-text">StudyAI</span>
          <span className="logo-ver">v1.2.0</span>
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
            {item.id === 'notes' && <span className="nav-badge">{notes.length}</span>}
          </div>
        ))}
      </div>

      {/* Preview rangkuman terbaru dibuka */}
      <div className="last-opened-section">
        <div className="nav-label">Terakhir Dibuka</div>

        {previewNote ? (
          <div
            className={`note-card ${selectedNote?.id === previewNote.id ? 'active' : ''}`}
            onClick={() => { selectNote(previewNote); setView('notes') }}
          >
            <div className="note-card-title">
              <i className="ti ti-file-text" />
              <span className="note-card-title-text">{previewNote.title}</span>
            </div>
            <div className="note-card-meta">
              <span className="note-cat"><i className="ti ti-tag" />{previewNote.category}</span>
              <span>·</span>
              <i className="ti ti-clock" />
              <span>{timeAgo(previewNote.updated_at)}</span>
            </div>
            <div className="note-card-preview">
              {previewNote.content
                ? previewNote.content.replace(/[#*`>\-_\[\]]/g, '').slice(0, 80).trim() + (previewNote.content.length > 80 ? '…' : '')
                : <span className="note-card-empty">Belum ada isi</span>
              }
            </div>
          </div>
        ) : (
          <div className="note-empty">
            <i className="ti ti-notebook-off" />
            Belum ada rangkuman dibuka
          </div>
        )}

        <button className="sidebar-new-btn" onClick={() => { createNote(); setView('notes') }}>
          <i className="ti ti-plus" /> Rangkuman Baru
        </button>
      </div>

      <div className="sidebar-footer">
        <div className="provider-badge" onClick={() => setView('settings')}>
          <span className={`provider-dot ${hasKey ? 'ok' : 'off'}`} />
          <span className="provider-name">{activeModel}</span>
          {streak > 0 && <span className="streak-badge">🔥{streak}</span>}
          <i className="ti ti-chevron-down provider-arrow" />
        </div>
      </div>
    </aside>
  )
}
