import React, { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import logoUrl from '../../assets/studyai-logo.png'
import './Titlebar.css'

/**
 * Chrome window custom. Window dibuat dengan `frame: false` di electron/main.ts,
 * jadi komponen inilah satu-satunya cara user memindahkan, memaksimalkan, dan
 * menutup app.
 *
 * Tombol tutup memanggil window.api.window.close() → win.close() di main, jadi
 * guard "perubahan belum disimpan" tetap terpicu persis seperti tombol X bawaan
 * OS sebelumnya.
 */
export default function Titlebar() {
  const doc = useStore(s => s.doc)
  const setPaletteOpen = useStore(s => s.setPaletteOpen)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.window.isMaximized().then(v => { if (alive) setMaximized(v) })
    const off = window.api.window.onMaximizedChange(setMaximized)
    return () => { alive = false; off() }
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img className="titlebar-logo" src={logoUrl} alt="" />
        <span className="titlebar-app">StudyAI</span>
      </div>

      <div className="titlebar-doc">
        <span className="titlebar-doc-title">{doc ? (doc.title || 'Tanpa Judul') : 'Tidak ada file dibuka'}</span>
        {doc?.isDirty && <span className="titlebar-dot" title="Belum disimpan" />}
      </div>

      <div className="titlebar-controls">
        <button
          className="titlebar-cmdk"
          onClick={() => setPaletteOpen(true)}
          title="Buka command palette"
          aria-label="Buka command palette"
        >
          <i className="ti ti-search" />
          <kbd>Ctrl</kbd><kbd>K</kbd>
        </button>
        <span className="titlebar-sep" aria-hidden="true" />

        <button
          className="titlebar-win-btn"
          onClick={() => window.api.window.minimize()}
          title="Minimalkan"
          aria-label="Minimalkan"
        >
          <i className="ti ti-minus" />
        </button>
        <button
          className="titlebar-win-btn"
          onClick={() => window.api.window.maximize()}
          title={maximized ? 'Pulihkan ukuran' : 'Maksimalkan'}
          aria-label={maximized ? 'Pulihkan ukuran' : 'Maksimalkan'}
        >
          <i className={`ti ${maximized ? 'ti-squares-diagonal' : 'ti-square'}`} />
        </button>
        <button
          className="titlebar-win-btn danger"
          onClick={() => window.api.window.close()}
          title="Tutup"
          aria-label="Tutup"
        >
          <i className="ti ti-x" />
        </button>
      </div>
    </header>
  )
}
