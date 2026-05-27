import React, { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import { useStore } from '../../store/useStore'
import './Editor.css'

const CATEGORIES = ['Umum','Android','RPL','Jarkom','Matdis','Basis Data','Import','Lainnya']

marked.setOptions({ breaks: true, gfm: true } as any)

type ViewMode = 'edit' | 'preview' | 'split'

export default function Editor() {
  const { selectedNote, notes, createNote, saveNote, deleteNote, importNote, exportNote } = useStore()
  const [title, setTitle]           = useState('')
  const [content, setContent]       = useState('')
  const [category, setCategory]     = useState('Umum')
  const [saved, setSaved]           = useState(true)
  const [showCatMenu, setShowCatMenu] = useState(false)
  const [viewMode, setViewMode]     = useState<ViewMode>('split')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (selectedNote) {
      setTitle(selectedNote.title)
      setContent(selectedNote.content)
      setCategory(selectedNote.category)
      setSaved(true)
    }
  }, [selectedNote?.id])

  const triggerSave = useCallback((t: string, c: string, cat: string) => {
    if (!selectedNote) return
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await saveNote(String(selectedNote.id), t, c, cat)
      setSaved(true)
    }, 800)
  }, [selectedNote, saveNote])

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0

  const insertMarkdown = (syntax: string) => {
    const ta = document.getElementById('main-editor') as HTMLTextAreaElement
    if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const sel   = content.slice(start, end)
    let inserted = ''
    if (syntax === 'bold')      inserted = `**${sel || 'teks'}**`
    if (syntax === 'italic')    inserted = `*${sel || 'teks'}*`
    if (syntax === 'code')      inserted = `\`${sel || 'kode'}\``
    if (syntax === 'heading')   inserted = `## ${sel || 'Judul'}`
    if (syntax === 'list')      inserted = `\n- ${sel || 'item'}`
    if (syntax === 'ol')        inserted = `\n1. ${sel || 'item'}`
    if (syntax === 'quote')     inserted = `\n> ${sel || 'kutipan'}`
    if (syntax === 'codeblock') inserted = `\n\`\`\`\n${sel || 'kode'}\n\`\`\``
    const next = content.slice(0, start) + inserted + content.slice(end)
    setContent(next)
    triggerSave(title, next, category)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + inserted.length, start + inserted.length)
    }, 0)
  }

  const renderedHtml = marked(content || '') as string

  if (!selectedNote && notes.length === 0) {
    return (
      <div className="editor-empty">
        <div className="empty-icon">📝</div>
        <div className="empty-title">Belum ada rangkuman</div>
        <div className="empty-sub">Buat rangkuman pertamamu atau import dokumen</div>
        <div style={{display:'flex',gap:'8px',marginTop:'16px'}}>
          <button className="btn-primary" onClick={() => createNote()}>
            <i className="ti ti-plus" /> Buat Baru
          </button>
          <button className="btn-secondary" onClick={importNote}>
            <i className="ti ti-upload" /> Import File
          </button>
        </div>
      </div>
    )
  }

  if (!selectedNote) {
    return (
      <div className="editor-empty">
        <div className="empty-icon">👈</div>
        <div className="empty-title">Pilih rangkuman</div>
        <div className="empty-sub">Klik rangkuman di sidebar untuk mulai edit</div>
      </div>
    )
  }

  return (
    <div className="editor-area">
      <div className="editor-header">
        <div className="cat-row">
          <div className="cat-pill" onClick={() => setShowCatMenu(v => !v)}>
            <i className="ti ti-tag" /> {category}
            <i className="ti ti-chevron-down" style={{fontSize:10}} />
          </div>
          {showCatMenu && (
            <div className="cat-dropdown">
              {CATEGORIES.map(c => (
                <div key={c} className={`cat-option ${c===category?'sel':''}`}
                  onClick={() => { setCategory(c); triggerSave(title,content,c); setShowCatMenu(false) }}>
                  {c}
                </div>
              ))}
            </div>
          )}
          <div className="cat-pill green">
            <i className="ti ti-clock" /> {selectedNote.updated_at?.split(',')[1]?.trim() ?? selectedNote.updated_at}
          </div>
          <div className={`save-indicator ${saved ? 'saved' : 'unsaved'}`}>
            <i className={`ti ${saved ? 'ti-check' : 'ti-loader-2 spin'}`} />
            {saved ? 'Tersimpan' : 'Menyimpan...'}
          </div>
          <div className="view-toggle">
            {([
              { mode: 'edit',    icon: 'ti-pencil',         label: 'Edit'    },
              { mode: 'split',   icon: 'ti-layout-columns', label: 'Split'   },
              { mode: 'preview', icon: 'ti-eye',             label: 'Preview' },
            ] as const).map(b => (
              <button key={b.mode} className={`vt-btn ${viewMode === b.mode ? 'active' : ''}`}
                onClick={() => setViewMode(b.mode)}>
                <i className={`ti ${b.icon}`} />
                <span className="vt-btn-label">{b.label}</span>
              </button>
            ))}
          </div>
        </div>
        <input
          className="title-input"
          value={title}
          placeholder="Judul rangkuman..."
          onChange={e => { setTitle(e.target.value); triggerSave(e.target.value, content, category) }}
        />
        <div className="meta-row">
          <div className="meta-item"><i className="ti ti-calendar" /> {selectedNote.created_at?.split(',')[0] ?? ''}</div>
          <div className="meta-item"><i className="ti ti-letter-case" /> {wordCount} kata</div>
          <div className="meta-item"><i className="ti ti-hash" /> #{selectedNote.id}</div>
        </div>
      </div>

      <div className="divider" />

      {viewMode !== 'preview' && (
        <div className="toolbar">
          {[
            { icon:'ti-heading',      tip:'Heading',     act:'heading'   },
            { icon:'ti-bold',         tip:'Bold',        act:'bold'      },
            { icon:'ti-italic',       tip:'Italic',      act:'italic'    },
            null,
            { icon:'ti-list',         tip:'List',        act:'list'      },
            { icon:'ti-list-numbers', tip:'Ordered',     act:'ol'        },
            { icon:'ti-quote',        tip:'Quote',       act:'quote'     },
            null,
            { icon:'ti-code',         tip:'Kode',        act:'code'      },
            { icon:'ti-code-dots',    tip:'Blok Kode',   act:'codeblock' },
          ].map((btn, i) =>
            btn === null
              ? <div key={i} className="tb-sep" />
              : <button key={i} className="tb-btn" onClick={() => insertMarkdown(btn.act)}>
                  <i className={`ti ${btn.icon}`} />
                  <span className="tb-btn-label">{btn.tip}</span>
                </button>
          )}
        </div>
      )}

      <div className={`editor-body mode-${viewMode}`}>
        {viewMode !== 'preview' && (
          <div className="editor-pane edit-pane">
            <textarea
              id="main-editor"
              value={content}
              placeholder="Mulai tulis rangkumanmu di sini..."
              onChange={e => { setContent(e.target.value); triggerSave(title, e.target.value, category) }}
            />
          </div>
        )}
        {viewMode !== 'edit' && (
          <div className="editor-pane preview-pane">
            {viewMode === 'split' && <div className="pane-label">Preview</div>}
            <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
          </div>
        )}
      </div>

      <div className="editor-footer">
        <button className="btn-primary" onClick={() => {
          if (saveTimer.current) clearTimeout(saveTimer.current)
          saveNote(String(selectedNote.id), title, content, category)
          setSaved(true)
        }}>
          <i className="ti ti-device-floppy" /> Simpan
        </button>
        <button className="btn-secondary" onClick={importNote}>
          <i className="ti ti-upload" /> Import
        </button>
        <button className="btn-secondary" onClick={() => exportNote(title, content)}>
          <i className="ti ti-download" /> Export MD
        </button>
        <button className="btn-danger" onClick={() => {
          if (confirm(`Hapus "${title}"?`)) deleteNote(String(selectedNote.id))
        }}>
          <i className="ti ti-trash" /> Hapus
        </button>
        <span className="word-count">{wordCount} kata</span>
      </div>
    </div>
  )
}