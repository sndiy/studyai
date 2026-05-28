import React, { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import { useStore } from '../../store/useStore'
import './Editor.css'

const CATEGORIES = ['Umum','Android','RPL','Jarkom','Matdis','Basis Data','Import','Lainnya']

marked.setOptions({ breaks: true, gfm: true } as any)

type ViewMode = 'edit' | 'preview' | 'split'

export default function Editor() {
  const { selectedNote, notes, createNote, saveNote, deleteNote, importNote, exportNote } = useStore()
  const [title, setTitle]                 = useState('')
  const [content, setContent]             = useState('')
  const [category, setCategory]           = useState('Umum')
  const [saved, setSaved]                 = useState(true)
  const [showCatMenu, setShowCatMenu]     = useState(false)
  const [viewMode, setViewMode]           = useState<ViewMode>('split')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (selectedNote) {
      setTitle(selectedNote.title)
      setContent(selectedNote.content)
      setCategory(selectedNote.category)
      setSaved(true)
      setConfirmDelete(false)
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

  // ─── Core insert: pakai execCommand supaya Ctrl+Z native undo tetap jalan ───
  const insertMarkdown = useCallback((syntax: string) => {
    const ta = document.getElementById('main-editor') as HTMLTextAreaElement
    if (!ta) return
    ta.focus()

    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const sel   = ta.value.slice(start, end)

    let before = ''
    let after  = ''
    let placeholder = ''

    switch (syntax) {
      case 'bold':
        before = '**'; after = '**'; placeholder = 'teks'
        break
      case 'italic':
        before = '*'; after = '*'; placeholder = 'teks'
        break
      case 'code':
        before = '`'; after = '`'; placeholder = 'kode'
        break
      case 'heading':
        before = '## '; after = ''; placeholder = 'Judul'
        break
      case 'list':
        before = '\n- '; after = ''; placeholder = 'item'
        break
      case 'ol':
        before = '\n1. '; after = ''; placeholder = 'item'
        break
      case 'quote':
        before = '\n> '; after = ''; placeholder = 'kutipan'
        break
      case 'codeblock':
        before = '\n```\n'; after = '\n```'; placeholder = 'kode'
        break
    }

    const inner   = sel || placeholder
    const inserted = before + inner + after

    // execCommand masukkan ke undo stack browser
    document.execCommand('insertText', false, inserted)

    // posisi cursor: wrap selection → setelah closing; tidak ada sel → dalam placeholder
    const newCursorPos = sel
      ? start + inserted.length
      : start + before.length + inner.length

    ta.setSelectionRange(
      sel ? start + before.length : start + before.length,
      sel ? start + before.length + sel.length : start + before.length + inner.length
    )

    // sync React state dari textarea (execCommand sudah update .value)
    const newContent = ta.value
    setContent(newContent)
    triggerSave(title, newContent, category)
  }, [title, category, triggerSave])

  // ─── Keyboard shortcut handler ───────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ctrl = e.ctrlKey || e.metaKey
    if (!ctrl) return

    const map: Record<string, string> = {
      b: 'bold',
      i: 'italic',
      k: 'code',
      h: 'heading',
      // Ctrl+Shift+K → codeblock
    }

    if (e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      insertMarkdown('codeblock')
      return
    }

    if (e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      insertMarkdown('list')
      return
    }

    if (e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      insertMarkdown('ol')
      return
    }

    if (e.shiftKey && e.key.toLowerCase() === 'q') {
      e.preventDefault()
      insertMarkdown('quote')
      return
    }

    const act = map[e.key.toLowerCase()]
    if (act) {
      e.preventDefault()
      insertMarkdown(act)
    }
  }, [insertMarkdown])

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

  // ─── Shortcut hints untuk toolbar tooltip ────────────────────────────────
  const TOOLBAR_BTNS = [
    { icon:'ti-heading',      tip:'Heading',    act:'heading',   shortcut:'Ctrl+H'       },
    { icon:'ti-bold',         tip:'Bold',       act:'bold',      shortcut:'Ctrl+B'       },
    { icon:'ti-italic',       tip:'Italic',     act:'italic',    shortcut:'Ctrl+I'       },
    null,
    { icon:'ti-list',         tip:'List',       act:'list',      shortcut:'Ctrl+Shift+L' },
    { icon:'ti-list-numbers', tip:'Ordered',    act:'ol',        shortcut:'Ctrl+Shift+O' },
    { icon:'ti-quote',        tip:'Quote',      act:'quote',     shortcut:'Ctrl+Shift+Q' },
    null,
    { icon:'ti-code',         tip:'Kode',       act:'code',      shortcut:'Ctrl+K'       },
    { icon:'ti-code-dots',    tip:'Blok Kode',  act:'codeblock', shortcut:'Ctrl+Shift+K' },
  ]

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
              { mode: 'preview', icon: 'ti-eye',            label: 'Preview' },
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
          {TOOLBAR_BTNS.map((btn, i) =>
            btn === null
              ? <div key={i} className="tb-sep" />
              : (
                <button
                  key={i}
                  className="tb-btn"
                  onClick={() => insertMarkdown(btn.act)}
                  title={`${btn.tip} (${btn.shortcut})`}
                >
                  <i className={`ti ${btn.icon}`} />
                  <span className="tb-btn-label">{btn.tip}</span>
                </button>
              )
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
              onKeyDown={handleKeyDown}
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
        {confirmDelete ? (
          <>
            <button className="btn-danger" onClick={() => {
              deleteNote(String(selectedNote.id))
              setConfirmDelete(false)
            }}>
              <i className="ti ti-check" /> Yakin?
            </button>
            <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>
              Batal
            </button>
          </>
        ) : (
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
            <i className="ti ti-trash" /> Hapus
          </button>
        )}
        <span className="word-count">{wordCount} kata</span>
      </div>
    </div>
  )
}