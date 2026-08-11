import React, { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import type { PendingNav } from './types'
import Titlebar from './components/Titlebar/Titlebar'
import CommandPalette from './components/CommandPalette/CommandPalette'
import Sidebar from './components/Sidebar/Sidebar'
import Editor from './components/Editor/Editor'
import Chat from './components/Chat/Chat'
import Settings from './components/Settings/Settings'
import './styles/app.css'

/** Harus sama dengan kunci yang dibaca inline script di index.html. */
const THEME_CACHE_KEY = 'studyai-theme'

export default function App() {
  // [Bug #16] Selector per-field, bukan destructure dari useStore() tanpa
  // selector — sebelumnya App berlangganan ke SELURUH store, jadi setiap token
  // stream AI (yang memperbarui streamingText puluhan kali per detik) memicu
  // re-render App dan seluruh subtree di bawahnya (Sidebar, Titlebar,
  // CommandPalette, editor) meski tidak satu pun dari mereka menampilkan
  // streamingText. Pola ini sudah dipakai Editor.tsx/Titlebar.tsx — di sini
  // cuma diperluas ke semua field yang App benar-benar baca.
  const currentView          = useStore(s => s.currentView)
  const loadSettings         = useStore(s => s.loadSettings)
  const loadRecent           = useStore(s => s.loadRecent)
  const settings             = useStore(s => s.settings)
  const openExternalFile     = useStore(s => s.openExternalFile)
  const pendingNav           = useStore(s => s.pendingNav)
  const discardAndContinue   = useStore(s => s.discardAndContinue)
  const saveAndContinue      = useStore(s => s.saveAndContinue)
  const cancelPendingNav     = useStore(s => s.cancelPendingNav)
  const requestClose         = useStore(s => s.requestClose)
  const toast                = useStore(s => s.toast)
  const toastLeaving         = useStore(s => s.toastLeaving)
  const dismissToast         = useStore(s => s.dismissToast)
  const saveBlockedByFidelity = useStore(s => s.saveBlockedByFidelity)
  const confirmLossySave     = useStore(s => s.confirmLossySave)
  const cancelLossySave      = useStore(s => s.cancelLossySave)

  // [B2] Main process perlu tahu status dirty untuk bisa membatalkan penutupan window
  const isDirty = useStore(s => !!s.doc?.isDirty)
  useEffect(() => { window.api.app.setDirty(isDirty) }, [isDirty])

  useEffect(() => {
    Promise.all([loadSettings(), loadRecent(), useStore.getState().loadVerifiedLimits()]).catch(e =>
      useStore.getState().showToast('err', `Gagal memuat data awal: ${String(e)}`)
    )

    window.api.file.getPendingOpenPath().then(path => {
      if (path) openExternalFile(path)
    })

    const offOpenExternal = window.api.file.onOpenExternal(path => openExternalFile(path))
    const offRequestClose = window.api.app.onRequestClose(() => requestClose())
    return () => { offOpenExternal(); offRequestClose() }
  }, [])

  // Ctrl/Cmd+K global. Mengikuti pola listener keydown yang sudah dipakai
  // Editor untuk Ctrl+S — keduanya beda tombol, jadi tidak saling bentrok.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const s = useStore.getState()
        s.setPaletteOpen(!s.paletteOpen)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Tema hidup di data-theme pada <html> (bukan class di <body> seperti dulu):
  // root adalah elemen yang disapu View Transition, dan inline script di
  // index.html memakai atribut yang sama untuk mencegah kedipan saat start.
  useEffect(() => {
    const theme = settings?.theme === 'light' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(THEME_CACHE_KEY, theme) } catch { /* mode privat */ }
  }, [settings?.theme])

  return (
    <div className="app-shell">
      <Titlebar />
      <div className="app-body">
        <Sidebar />
        <main className="main-area">
          {currentView === 'editor'   && <EditorLayout />}
          {currentView === 'ai'       && <StandaloneChatLayout />}
          {currentView === 'settings' && <Settings />}
        </main>
      </div>
      {pendingNav && (
        <UnsavedChangesDialog
          nav={pendingNav}
          onSave={saveAndContinue}
          onDiscard={discardAndContinue}
          onCancel={cancelPendingNav}
        />
      )}
      {saveBlockedByFidelity && (
        <LossySaveDialog
          lost={saveBlockedByFidelity}
          onConfirm={confirmLossySave}
          onCancel={cancelLossySave}
        />
      )}
      <CommandPalette />
      {toast && (
        <div
          className={`app-toast ${toast.kind}${toastLeaving ? ' leaving' : ''}`}
          role="status"
          onClick={dismissToast}
        >
          <i className={`ti ${toast.kind === 'err' ? 'ti-alert-triangle' : 'ti-check'}`} />
          <span>{toast.msg}</span>
          <i className="ti ti-x app-toast-close" />
        </div>
      )}
    </div>
  )
}

// [B1][B2] Satu dialog untuk semua aksi yang bisa membuang perubahan
function UnsavedChangesDialog({ nav, onSave, onDiscard, onCancel }: {
  nav: PendingNav
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const what =
    nav.kind === 'new'        ? 'Buat dokumen baru?'
  : nav.kind === 'openDialog' ? 'Buka file lain?'
  : nav.kind === 'close'      ? 'Tutup StudyAI?'
  :                             'Buka file ini?'

  return (
    <div className="open-external-overlay" onMouseDown={onCancel}>
      <div className="open-external-card" onMouseDown={e => e.stopPropagation()}>
        <div className="open-external-title">
          <i className="ti ti-alert-circle" /> {what}
        </div>
        <div className="open-external-body">
          Dokumen saat ini punya perubahan yang belum disimpan.
          {nav.kind === 'openPath' && (
            <>
              <br />
              <strong>{nav.filePath.split(/[\\/]/).pop()}</strong>
            </>
          )}
        </div>
        <div className="open-external-actions">
          <button className="btn-secondary" onClick={onCancel}>Batal</button>
          <button className="btn-danger" onClick={onDiscard}>
            <i className="ti ti-trash" /> Buang perubahan
          </button>
          <button className="btn-primary" onClick={onSave}>
            <i className="ti ti-device-floppy" /> Simpan &amp; lanjut
          </button>
        </div>
      </div>
    </div>
  )
}

// [Bug #1] Ditampilkan saat saveDoc() menahan penulisan karena round-trip
// editor kehilangan sebagian konten (tabel/gambar/task-list yang tidak
// dikenal schema, atau konstruksi lain di masa depan). Menyimpan tetap
// mungkin — user yang memutuskan, bukan app yang menimpa diam-diam.
function LossySaveDialog({ lost, onConfirm, onCancel }: {
  lost: string[]
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="open-external-overlay" onMouseDown={onCancel}>
      <div className="open-external-card" onMouseDown={e => e.stopPropagation()}>
        <div className="open-external-title">
          <i className="ti ti-alert-triangle" /> Sebagian konten mungkin hilang
        </div>
        <div className="open-external-body">
          Editor mendeteksi bagian berikut tidak bertahan saat dibuka: <strong>{lost.join(', ')}</strong>.
          <br />
          Menyimpan sekarang akan menimpa file dengan versi yang sudah kehilangan bagian ini.
        </div>
        <div className="open-external-actions">
          <button className="btn-secondary" onClick={onCancel}>Batal</button>
          <button className="btn-danger" onClick={onConfirm}>
            <i className="ti ti-device-floppy" /> Simpan Meski Berisiko
          </button>
        </div>
      </div>
    </div>
  )
}

// Editor + panel chat kanan (toggle)
function EditorLayout() {
  const [showChat, setShowChat] = useState(false)

  return (
    <div className="editor-layout">
      <div className="editor-topbar">
        <div className="topbar-tab active" style={{ pointerEvents:'none' }}>
          <i className="ti ti-edit" /> Editor
        </div>
        <div className="topbar-right">
          <button
            className={`topbar-btn ${showChat ? 'accent' : ''}`}
            onClick={() => setShowChat(v => !v)}
            title="Toggle panel Chat AI"
          >
            <i className="ti ti-sparkles" />
            {showChat ? 'Tutup Chat' : 'Chat AI'}
          </button>
        </div>
      </div>
      <div className="editor-content">
        <Editor />
        {showChat && (
          <div className="chat-panel-split">
            <Chat embedded />
          </div>
        )}
      </div>
    </div>
  )
}

// Tanya AI full page
function StandaloneChatLayout() {
  return (
    <div className="standalone-chat-layout">
      <Chat />
    </div>
  )
}
