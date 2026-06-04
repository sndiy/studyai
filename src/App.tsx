import React, { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import Sidebar from './components/Sidebar/Sidebar'
import Editor from './components/Editor/Editor'
import Chat from './components/Chat/Chat'
import Settings from './components/Settings/Settings'
import './styles/app.css'

export default function App() {
  const { currentView, loadSettings, loadRecent, settings } = useStore()

  useEffect(() => {
    Promise.all([loadSettings(), loadRecent()])
  }, [])

  useEffect(() => {
    const theme = settings?.theme === 'light' ? 'light-theme' : ''
    if (theme) {
      document.body.classList.add(theme)
    } else {
      document.body.classList.remove('light-theme')
    }
  }, [settings?.theme])

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar />
        <main className="main-area">
          {currentView === 'editor'   && <EditorLayout />}
          {currentView === 'ai'       && <StandaloneChatLayout />}
          {currentView === 'settings' && <Settings />}
        </main>
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
