import React, { useEffect } from 'react'
import { useStore } from '../../store/useStore'
import './Stats.css'

export default function Stats() {
  const { stats, streak, loadStats } = useStore()

  useEffect(() => { loadStats() }, [])

  if (!stats) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--text-dim)'}}>
      <i className="ti ti-loader-2 spin" style={{marginRight:8}} /> Memuat statistik...
    </div>
  )

  const cats = stats.categories

  return (
    <div className="stats-panel">
      <div className="stats-title">
        <i className="ti ti-chart-line" /> Statistik Belajar
      </div>

      <div className="stat-grid">
        <StatCard icon="ti-books" label="Total Rangkuman" value={stats.totalNotes} color="var(--accent-soft)" sub={`${cats.length} kategori`} />
        <StatCard icon="ti-message-circle" label="Chat Hari Ini" value={stats.todayChats} color="var(--green)" sub="pesan terkirim" />
        <StatCard icon="ti-flame" label="Streak Belajar" value={streak} color="var(--red)" sub="hari berturut-turut" unit="hari" />
        <StatCard icon="ti-folder" label="Kategori Aktif" value={cats.length} color="var(--yellow)" sub="topik berbeda" />
      </div>

      {cats.length > 0 && (
        <div className="stats-section">
          <div className="stats-section-title">Distribusi Kategori</div>
          <div className="category-bars">
            {cats.map(c => {
              const pct = stats.totalNotes > 0 ? Math.round((c.c / stats.totalNotes) * 100) : 0
              return (
                <div key={c.category} className="cat-bar-row">
                  <span className="cat-bar-label"><i className="ti ti-folder" />{c.category}</span>
                  <div className="cat-bar-track">
                    <div className="cat-bar-fill" style={{width:`${pct}%`}} />
                  </div>
                  <span className="cat-bar-count">{c.c}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {stats.recentNotes.length > 0 && (
        <div className="stats-section">
          <div className="stats-section-title">Rangkuman Terbaru</div>
          {stats.recentNotes.map(n => (
            <div key={n.id} className="recent-note-row">
              <div className="recent-note-title"><i className="ti ti-file-text" />{n.title}</div>
              <div className="recent-note-meta">
                <span className="note-cat"><i className="ti ti-tag" />{n.category}</span>
                <i className="ti ti-calendar" /><span>{n.updated_at}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="stats-tip">
        <i className="ti ti-bulb" /> Tip: Konsisten belajar setiap hari untuk mempertahankan streak-mu!
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color, sub, unit = '' }: {
  icon: string; label: string; value: number; color: string; sub: string; unit?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon"><i className={`ti ${icon}`} /></div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{color}}>{value}{unit && <span className="stat-unit"> {unit}</span>}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  )
}
