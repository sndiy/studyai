import React from 'react'
import { useStore } from '../../store/useStore'
import type { Note, View } from '../../types'
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
    notes, selectedNote, selectNote, createNote, currentView, setView,
    searchQuery, setSearchQuery, settings, streak
  } = useStore()

  const filtered = notes.filter(n =>
    !searchQuery || n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    n.category.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const navItems: { id: View; icon: string; label: string }[] = [
    { id: 'notes',    icon: 'ti-books',       label: 'Semua Rangkuman' },
    { id: 'ai',       icon: 'ti-sparkles',     label: 'Tanya AI' },
    { id: 'stats',    icon: 'ti-chart-line',   label: 'Statistik' },
    { id: 'settings', icon: 'ti-settings',     label: 'Pengaturan' },
  ]

  const activeModel = settings?.active_model ?? 'gemini-2.5-flash'
  const hasKey = !!(settings?.gemini_api_key || settings?.openai_api_key)

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="logo-row">
          <div className="logo-icon">📚</div>
          <span className="logo-text">StudyAI</span>
          <span className="logo-ver">v1.1.1</span>
        </div>
        <div className="search-box">
          <i className="ti ti-search" />
          <input
            placeholder="Cari rangkuman..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="search-clear">
              <i className="ti ti-x" />
            </button>
          )}
        </div>
      </div>

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

      <div className="note-list">
        {filtered.length === 0 && (
          <div className="note-empty">
            <i className={`ti ${searchQuery ? 'ti-search-off' : 'ti-notebook-off'}`} />
            {searchQuery ? 'Tidak ada hasil' : 'Belum ada rangkuman'}
          </div>
        )}
        {filtered.map((note: Note) => (
          <div
            key={note.id}
            className={`note-card ${selectedNote?.id === note.id ? 'active' : ''}`}
            onClick={() => { selectNote(note); setView('notes') }}
          >
            <div className="note-card-title">
              <i className="ti ti-file-text" />
              {note.title}
            </div>
            <div className="note-card-meta">
              <span className="note-cat"><i className="ti ti-tag" />{note.category}</span>
              <span>·</span>
              <i className="ti ti-clock" />
              <span>{timeAgo(note.updated_at)}</span>
            </div>
          </div>
        ))}
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
