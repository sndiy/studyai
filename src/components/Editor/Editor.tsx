import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TurndownService from 'turndown'
import { useStore } from '../../store/useStore'
import './Editor.css'

const CATEGORIES = ['Umum','Android','RPL','Jarkom','Matdis','Basis Data','Import','Lainnya']
const turndown   = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

const TEXT_COLORS = [
  '#ffffff','#e2e8f0','#94a3b8','#475569',
  '#f87171','#fb923c','#fbbf24','#34d399',
  '#60a5fa','#a78bfa','#f472b6','#000000',
]
const HIGHLIGHT_COLORS = ['#fef08a','#bbf7d0','#bfdbfe','#fecaca','#e9d5ff','#fed7aa']

// ─── Toolbar Button ───────────────────────────────────────────────────────────
function TBtn({ active, disabled, onClick, icon, tip, shortcut }: {
  active?: boolean; disabled?: boolean; onClick: () => void
  icon: string; tip: string; shortcut?: string
}) {
  return (
    <button
      className={`tb-btn ${active ? 'active' : ''}`}
      disabled={disabled}
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={shortcut ? `${tip} (${shortcut})` : tip}
    >
      <i className={`ti ${icon}`} />
      <span className="tb-btn-label">{tip}</span>
    </button>
  )
}

// ─── Custom Floating Bubble Menu ──────────────────────────────────────────────
function FloatingMenu({ editor }: { editor: any }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editor) return

    const update = () => {
      const { from, to } = editor.state.selection
      if (from === to) { setPos(null); return }

      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) { setPos(null); return }

      const range = sel.getRangeAt(0)
      const rect  = range.getBoundingClientRect()
      if (!rect || rect.width === 0) { setPos(null); return }

      const editorEl = document.querySelector('.wysiwyg-pane') as HTMLElement
      if (!editorEl) return
      const containerRect = editorEl.getBoundingClientRect()

      const menuWidth  = 280
      const menuHeight = 38

      let left = rect.left - containerRect.left + rect.width / 2 - menuWidth / 2
      let top  = rect.top - containerRect.top - menuHeight - 8

      // Clamp agar tidak keluar area
      left = Math.max(4, Math.min(left, containerRect.width - menuWidth - 4))
      if (top < 4) top = rect.bottom - containerRect.top + 8

      setPos({ top, left })
    }

    editor.on('selectionUpdate', update)
    editor.on('blur', () => setPos(null))
    document.addEventListener('selectionchange', update)

    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur')
      document.removeEventListener('selectionchange', update)
    }
  }, [editor])

  if (!pos || !editor) return null

  const { from, to } = editor.state.selection
  if (from === to) return null

  return (
    <div
      ref={menuRef}
      className="bubble-menu"
      style={{ position: 'absolute', top: pos.top, left: pos.left, zIndex: 200 }}
      onMouseDown={e => e.preventDefault()}
    >
      <button className={`bm-btn ${editor.isActive('bold') ? 'active' : ''}`}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run() }}>
        <i className="ti ti-bold" />
      </button>
      <button className={`bm-btn ${editor.isActive('italic') ? 'active' : ''}`}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }}>
        <i className="ti ti-italic" />
      </button>
      <button className={`bm-btn ${editor.isActive('underline') ? 'active' : ''}`}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }}>
        <i className="ti ti-underline" />
      </button>
      <button className={`bm-btn ${editor.isActive('strike') ? 'active' : ''}`}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleStrike().run() }}>
        <i className="ti ti-strikethrough" />
      </button>
      <div className="bm-sep" />
      <button className={`bm-btn ${editor.isActive('highlight') ? 'active' : ''}`}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run() }}>
        <i className="ti ti-highlight" />
      </button>
      <button className={`bm-btn ${editor.isActive('code') ? 'active' : ''}`}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleCode().run() }}>
        <i className="ti ti-code" />
      </button>
      <div className="bm-sep" />
      <button className={`bm-btn ${editor.isActive({ textAlign:'left' }) ? 'active' : ''}`}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('left').run() }}>
        <i className="ti ti-align-left" />
      </button>
      <button className={`bm-btn ${editor.isActive({ textAlign:'center' }) ? 'active' : ''}`}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('center').run() }}>
        <i className="ti ti-align-center" />
      </button>
      <button className={`bm-btn ${editor.isActive({ textAlign:'right' }) ? 'active' : ''}`}
        onMouseDown={e => { e.preventDefault(); editor.chain().focus().setTextAlign('right').run() }}>
        <i className="ti ti-align-right" />
      </button>
    </div>
  )
}

// ─── Main Editor ──────────────────────────────────────────────────────────────
export default function Editor() {
  const { selectedNote, notes, createNote, saveNote, deleteNote, importNote, exportNote } = useStore()

  const [title, setTitle]                     = useState('')
  const [category, setCategory]               = useState('Umum')
  const [saved, setSaved]                     = useState(true)
  const [showCatMenu, setShowCatMenu]         = useState(false)
  const [confirmDelete, setConfirmDelete]     = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showHlPicker, setShowHlPicker]       = useState(false)

  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const colorRef   = useRef<HTMLDivElement>(null)
  const hlRef      = useRef<HTMLDivElement>(null)

  // Gunakan ref untuk state agar Tiptap onUpdate tidak menggunakan closure lama
  const stateRef = useRef({ title, category, selectedNote })
  useEffect(() => {
    stateRef.current = { title, category, selectedNote }
  }, [title, category, selectedNote])

  const scheduleSave = useCallback((t: string, c: string, cat: string) => {
    const currentNote = stateRef.current.selectedNote
    if (!currentNote) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await saveNote(String(currentNote.id), t, c, cat)
      setSaved(true)
    }, 800)
  }, [saveNote])

  const scheduleSaveRef = useRef(scheduleSave)
  useEffect(() => {
    scheduleSaveRef.current = scheduleSave
  }, [scheduleSave])

  const isBindingRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: 'Mulai tulis rangkumanmu di sini...' }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (isBindingRef.current) return
      const md = turndown.turndown(editor.getHTML())
      const { title: t, category: c } = stateRef.current
      scheduleSaveRef.current(t, md, c)
      setSaved(false)
    },
    editorProps: {
      attributes: { class: 'tiptap-editor-content', spellcheck: 'false' },
    },
  })

  // Load note ke editor
  useEffect(() => {
    if (!selectedNote || !editor) return
    setTitle(selectedNote.title)
    setCategory(selectedNote.category)
    setSaved(true)
    setConfirmDelete(false)

    const raw    = selectedNote.content || ''
    const isHTML = /<[a-z][\s\S]*>/i.test(raw)
    
    isBindingRef.current = true
    editor.commands.setContent(isHTML ? raw : mdToHtml(raw), false)
    setTimeout(() => {
      isBindingRef.current = false
    }, 50)
  }, [selectedNote?.id, editor])

  // scheduleSave telah dipindahkan ke atas untuk mengatasi bug stale closure

  // Tutup picker saat klik luar
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setShowColorPicker(false)
      if (hlRef.current   && !hlRef.current.contains(e.target as Node))     setShowHlPicker(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const wordCount = editor ? editor.getText().trim().split(/\s+/).filter(Boolean).length : 0

  // ─── Empty states ──────────────────────────────────────────────────────────
  if (!selectedNote && notes.length === 0) return (
    <div className="editor-empty">
      <div className="empty-icon">📝</div>
      <div className="empty-title">Belum ada rangkuman</div>
      <div className="empty-sub">Buat rangkuman pertamamu atau import dokumen</div>
      <div style={{ display:'flex', gap:'8px', marginTop:'16px' }}>
        <button className="btn-primary"   onClick={() => createNote()}><i className="ti ti-plus" /> Buat Baru</button>
        <button className="btn-secondary" onClick={importNote}><i className="ti ti-upload" /> Import File</button>
      </div>
    </div>
  )

  if (!selectedNote) return (
    <div className="editor-empty">
      <div className="empty-icon">👈</div>
      <div className="empty-title">Pilih rangkuman</div>
      <div className="empty-sub">Klik rangkuman di sidebar untuk mulai edit</div>
    </div>
  )

  const handleManualSave = () => {
    if (!editor) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const md = turndown.turndown(editor.getHTML())
    saveNote(String(selectedNote.id), title, md, category)
    setSaved(true)
  }

  return (
    <div className="editor-area">

      {/* Header */}
      <div className="editor-header">
        <div className="cat-row">
          <div className="cat-pill" onClick={() => setShowCatMenu(v => !v)}>
            <i className="ti ti-tag" /> {category}
            <i className="ti ti-chevron-down" style={{ fontSize:10 }} />
          </div>
          {showCatMenu && (
            <div className="cat-dropdown">
              {CATEGORIES.map(c => (
                <div key={c} className={`cat-option ${c===category?'sel':''}`}
                  onClick={() => {
                    setCategory(c)
                    scheduleSave(title, turndown.turndown(editor?.getHTML() ?? ''), c)
                    setShowCatMenu(false)
                  }}>{c}</div>
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
        </div>

        <input
          className="title-input"
          value={title}
          placeholder="Judul rangkuman..."
          onChange={e => {
            setTitle(e.target.value)
            scheduleSave(e.target.value, turndown.turndown(editor?.getHTML() ?? ''), category)
          }}
        />

        <div className="meta-row">
          <div className="meta-item"><i className="ti ti-calendar" /> {selectedNote.created_at?.split(',')[0] ?? ''}</div>
          <div className="meta-item"><i className="ti ti-letter-case" /> {wordCount} kata</div>
          <div className="meta-item"><i className="ti ti-hash" /> #{selectedNote.id}</div>
        </div>
      </div>

      <div className="divider" />

      {/* Toolbar */}
      {editor && (
        <div className="toolbar toolbar-wysiwyg">
          {/* Undo / Redo */}
          <TBtn icon="ti-arrow-back-up"    tip="Undo" shortcut="Ctrl+Z"
            disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
          <TBtn icon="ti-arrow-forward-up" tip="Redo" shortcut="Ctrl+Y"
            disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />

          <div className="tb-sep" />

          {/* Heading */}
          <select className="tb-select"
            value={
              editor.isActive('heading', { level:1 }) ? '1' :
              editor.isActive('heading', { level:2 }) ? '2' :
              editor.isActive('heading', { level:3 }) ? '3' : '0'
            }
            onChange={e => {
              const v = Number(e.target.value)
              if (v === 0) editor.chain().focus().setParagraph().run()
              else editor.chain().focus().toggleHeading({ level: v as 1|2|3 }).run()
            }}>
            <option value="0">Paragraf</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>

          <div className="tb-sep" />

          {/* Format */}
          <TBtn icon="ti-bold"          tip="Bold"        shortcut="Ctrl+B" active={editor.isActive('bold')}      onClick={() => editor.chain().focus().toggleBold().run()} />
          <TBtn icon="ti-italic"        tip="Italic"      shortcut="Ctrl+I" active={editor.isActive('italic')}    onClick={() => editor.chain().focus().toggleItalic().run()} />
          <TBtn icon="ti-underline"     tip="Underline"   shortcut="Ctrl+U" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
          <TBtn icon="ti-strikethrough" tip="Strikethrough"                 active={editor.isActive('strike')}    onClick={() => editor.chain().focus().toggleStrike().run()} />

          <div className="tb-sep" />

          {/* Alignment */}
          <TBtn icon="ti-align-left"       tip="Rata Kiri"  shortcut="Ctrl+Shift+L" active={editor.isActive({ textAlign:'left' })}    onClick={() => editor.chain().focus().setTextAlign('left').run()} />
          <TBtn icon="ti-align-center"     tip="Tengah"     shortcut="Ctrl+Shift+E" active={editor.isActive({ textAlign:'center' })}   onClick={() => editor.chain().focus().setTextAlign('center').run()} />
          <TBtn icon="ti-align-right"      tip="Rata Kanan" shortcut="Ctrl+Shift+R" active={editor.isActive({ textAlign:'right' })}    onClick={() => editor.chain().focus().setTextAlign('right').run()} />
          <TBtn icon="ti-align-justified"  tip="Justify"    shortcut="Ctrl+Shift+J" active={editor.isActive({ textAlign:'justify' })}  onClick={() => editor.chain().focus().setTextAlign('justify').run()} />

          <div className="tb-sep" />

          {/* Lists */}
          <TBtn icon="ti-list"         tip="Bullet List"   active={editor.isActive('bulletList')}  onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <TBtn icon="ti-list-numbers" tip="Ordered List"  active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />

          <div className="tb-sep" />

          {/* Quote & Code */}
          <TBtn icon="ti-quote"     tip="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
          <TBtn icon="ti-code"      tip="Inline Code" shortcut="Ctrl+E" active={editor.isActive('code')}      onClick={() => editor.chain().focus().toggleCode().run()} />
          <TBtn icon="ti-code-dots" tip="Code Block"  active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />

          <div className="tb-sep" />

          {/* Color */}
          <div className="tb-color-wrap" ref={colorRef}>
            <button className="tb-btn" title="Warna Teks"
              onMouseDown={e => { e.preventDefault(); setShowColorPicker(v => !v); setShowHlPicker(false) }}>
              <i className="ti ti-letter-a" /><span className="tb-btn-label">Warna</span>
            </button>
            {showColorPicker && (
              <div className="color-palette">
                {TEXT_COLORS.map(c => (
                  <button key={c} className="color-swatch"
                    style={{ background: c, border: c==='#ffffff' ? '1px solid #444' : 'none' }}
                    onMouseDown={e => { e.preventDefault(); editor.chain().focus().setColor(c).run(); setShowColorPicker(false) }} />
                ))}
                <button className="color-swatch color-clear"
                  onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetColor().run(); setShowColorPicker(false) }}>✕</button>
              </div>
            )}
          </div>

          {/* Highlight */}
          <div className="tb-color-wrap" ref={hlRef}>
            <button className="tb-btn" title="Highlight"
              onMouseDown={e => { e.preventDefault(); setShowHlPicker(v => !v); setShowColorPicker(false) }}>
              <i className="ti ti-highlight" /><span className="tb-btn-label">Sorot</span>
            </button>
            {showHlPicker && (
              <div className="color-palette">
                {HIGHLIGHT_COLORS.map(c => (
                  <button key={c} className="color-swatch"
                    style={{ background: c }}
                    onMouseDown={e => { e.preventDefault(); editor.chain().focus().setHighlight({ color: c }).run(); setShowHlPicker(false) }} />
                ))}
                <button className="color-swatch color-clear"
                  onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetHighlight().run(); setShowHlPicker(false) }}>✕</button>
              </div>
            )}
          </div>

          <div className="tb-sep" />

          <TBtn icon="ti-clear-formatting" tip="Hapus Format"
            onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} />
        </div>
      )}

      {/* Editor Body */}
      <div className="editor-body mode-wysiwyg">
        <div className="editor-pane edit-pane wysiwyg-pane" style={{ position: 'relative' }}>
          {editor && <FloatingMenu editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Footer */}
      <div className="editor-footer">
        <button className="btn-primary" onClick={handleManualSave}>
          <i className="ti ti-device-floppy" /> Simpan
        </button>
        <button className="btn-secondary" onClick={importNote}>
          <i className="ti ti-upload" /> Import
        </button>
        <button className="btn-secondary" onClick={() => exportNote(title, turndown.turndown(editor?.getHTML() ?? ''))}>
          <i className="ti ti-download" /> Export MD
        </button>
        {confirmDelete ? (
          <>
            <button className="btn-danger" onClick={() => { deleteNote(String(selectedNote.id)); setConfirmDelete(false) }}>
              <i className="ti ti-check" /> Yakin?
            </button>
            <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Batal</button>
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

// ─── Markdown → HTML sederhana ────────────────────────────────────────────────
function mdToHtml(md: string): string {
  if (!md.trim()) return '<p></p>'
  return md
    .split('\n\n')
    .map(block => {
      if (/^### /.test(block)) return `<h3>${block.replace(/^### /, '')}</h3>`
      if (/^## /.test(block))  return `<h2>${block.replace(/^## /, '')}</h2>`
      if (/^# /.test(block))   return `<h1>${block.replace(/^# /, '')}</h1>`
      if (/^> /.test(block))   return `<blockquote><p>${block.replace(/^> /, '')}</p></blockquote>`
      if (/^[-*] /.test(block)) {
        const items = block.split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('')
        return `<ul>${items}</ul>`
      }
      if (/^\d+\. /.test(block)) {
        const items = block.split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('')
        return `<ol>${items}</ol>`
      }
      const inline = block
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,     '<em>$1</em>')
        .replace(/`(.+?)`/g,       '<code>$1</code>')
      return `<p>${inline}</p>`
    })
    .join('')
}