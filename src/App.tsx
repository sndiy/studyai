import React, { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import Sidebar from './components/Sidebar/Sidebar'
import Editor from './components/Editor/Editor'
import Chat from './components/Chat/Chat'
import Settings from './components/Settings/Settings'
import Stats from './components/Stats/Stats'
import ExportModal from './components/ExportImport/ExportModal'
import ImportModal from './components/ExportImport/ImportModal'
import './styles/app.css'

export default function App() {
  const { currentView, loadNotes, loadSettings, loadStats } = useStore()
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    Promise.all([loadNotes(), loadSettings(), loadStats()])
  }, [])

  const renderMain = () => {
    switch (currentView) {
      case 'notes':    return <EditorLayout onExport={() => setShowExport(true)} onImport={() => setShowImport(true)} />
      case 'ai':       return <AIChatLayout />
      case 'stats':    return <Stats />
      case 'settings': return <Settings />
    }
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main className="main-area">
          {renderMain()}
        </main>
      </div>
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  )
}

function TitleBar() {
  return (
    <div className="titlebar">
      <div className="titlebar-drag" />
      <div className="titlebar-controls">
        <button className="tb-ctrl close"   onClick={() => window.api.window.close()}>
          <i className="ti ti-x" />
        </button>
        <button className="tb-ctrl min"     onClick={() => window.api.window.minimize()}>
          <i className="ti ti-minus" />
        </button>
        <button className="tb-ctrl max"     onClick={() => window.api.window.maximize()}>
          <i className="ti ti-copy" />
        </button>
      </div>
    </div>
  )
}

function EditorLayout({ onExport, onImport }: { onExport: () => void; onImport: () => void }) {
  const { selectedNote, createNote } = useStore()
  const [tab, setTab] = React.useState<'editor'|'chat'>('editor')

  return (
    <div className="editor-layout">
      <div className="editor-topbar">
        <TabBtn icon="ti-edit"           label="Editor"  active={tab==='editor'} onClick={() => setTab('editor')} />
        <TabBtn icon="ti-message-circle" label="Chat AI" active={tab==='chat'}   onClick={() => setTab('chat')} />
        <div className="topbar-right">
          <button className="topbar-btn" onClick={onImport}>
            <i className="ti ti-upload" /> Import
          </button>
          <button className="topbar-btn" onClick={onExport}>
            <i className="ti ti-download" /> Export
          </button>
          <button className="topbar-btn accent" onClick={() => createNote()}>
            <i className="ti ti-plus" /> Baru
          </button>
        </div>
      </div>
      <div className="editor-content">
        {tab === 'editor' ? (
          <Editor />
        ) : (
          <div className="chat-split">
            <Editor />
            <div className="chat-panel-split">
              <Chat noteId={selectedNote?.id ?? null} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AIChatLayout() {
  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden',minHeight:0}}>
      <div className="editor-topbar" style={{paddingLeft:16}}>
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'var(--text-secondary)'}}>
          <i className="ti ti-sparkles" style={{color:'var(--accent)'}} />
          Tanya AI — Chat Bebas
        </div>
      </div>
      <Chat noteId={null} />
    </div>
  )
}

function TabBtn({ icon, label, active, onClick }: {
  icon: string; label: string; active: boolean; onClick: ()=>void
}) {
  return (
    <button className={`topbar-tab ${active?'active':''}`} onClick={onClick}>
      <i className={`ti ${icon}`} /> {label}
    </button>
  )
}
