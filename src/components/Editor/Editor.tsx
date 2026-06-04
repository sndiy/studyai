import React, { useState, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TurndownService from 'turndown'
import { marked } from 'marked'
import { useStore } from '../../store/useStore'
import './Editor.css'

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

const TEXT_COLORS      = ['#ffffff','#e2e8f0','#94a3b8','#475569','#f87171','#fb923c','#fbbf24','#34d399','#60a5fa','#a78bfa','#f472b6','#000000']
const HIGHLIGHT_COLORS = ['#fef08a','#bbf7d0','#bfdbfe','#fecaca','#e9d5ff','#fed7aa']

function TBtn({ active, disabled, onClick, icon, tip }: {
  active?: boolean; disabled?: boolean; onClick: () => void; icon: string; tip: string
}) {
  return (
    <button
      className={`tb-btn ${active ? 'active' : ''}`}
      disabled={disabled}
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={tip}
    >
      <i className={`ti ${icon}`} />
      <span className="tb-btn-label">{tip}</span>
    </button>
  )
}

function FloatingMenu({ editor }: { editor: any }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { from, to } = editor.state.selection
      if (from === to) { setPos(null); return }
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) { setPos(null); return }
      const rect        = sel.getRangeAt(0).getBoundingClientRect()
      if (!rect || rect.width === 0) { setPos(null); return }
      const container   = document.querySelector('.wysiwyg-pane') as HTMLElement
      if (!container) return
      const cr = container.getBoundingClientRect()
      const mw = 280, mh = 38
      let left = rect.left - cr.left + rect.width / 2 - mw / 2
      let top  = rect.top  - cr.top  - mh - 8
      left = Math.max(4, Math.min(left, cr.width - mw - 4))
      if (top < 4) top = rect.bottom - cr.top + 8
      setPos({ top, left })
    }
    const onBlur = () => setPos(null)
    editor.on('selectionUpdate', update)
    editor.on('blur', onBlur)
    document.addEventListener('selectionchange', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur', onBlur)
      document.removeEventListener('selectionchange', update)
    }
  }, [editor])

  if (!pos || !editor || editor.state.selection.from === editor.state.selection.to) return null

  const bm = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); fn() }
  return (
    <div className="bubble-menu" style={{ position:'absolute', top: pos.top, left: pos.left, zIndex: 200 }} onMouseDown={e => e.preventDefault()}>
      <button className={`bm-btn ${editor.isActive('bold')      ? 'active':''}`} onMouseDown={bm(() => editor.chain().focus().toggleBold().run())}><i className="ti ti-bold"/></button>
      <button className={`bm-btn ${editor.isActive('italic')    ? 'active':''}`} onMouseDown={bm(() => editor.chain().focus().toggleItalic().run())}><i className="ti ti-italic"/></button>
      <button className={`bm-btn ${editor.isActive('underline') ? 'active':''}`} onMouseDown={bm(() => editor.chain().focus().toggleUnderline().run())}><i className="ti ti-underline"/></button>
      <button className={`bm-btn ${editor.isActive('strike')    ? 'active':''}`} onMouseDown={bm(() => editor.chain().focus().toggleStrike().run())}><i className="ti ti-strikethrough"/></button>
      <div className="bm-sep"/>
      <button className={`bm-btn ${editor.isActive('highlight') ? 'active':''}`} onMouseDown={bm(() => editor.chain().focus().toggleHighlight({ color:'#fef08a' }).run())}><i className="ti ti-highlight"/></button>
      <button className={`bm-btn ${editor.isActive('code')      ? 'active':''}`} onMouseDown={bm(() => editor.chain().focus().toggleCode().run())}><i className="ti ti-code"/></button>
      <div className="bm-sep"/>
      <button className={`bm-btn ${editor.isActive({textAlign:'left'})    ? 'active':''}`} onMouseDown={bm(() => editor.chain().focus().setTextAlign('left').run())}><i className="ti ti-align-left"/></button>
      <button className={`bm-btn ${editor.isActive({textAlign:'center'})  ? 'active':''}`} onMouseDown={bm(() => editor.chain().focus().setTextAlign('center').run())}><i className="ti ti-align-center"/></button>
      <button className={`bm-btn ${editor.isActive({textAlign:'right'})   ? 'active':''}`} onMouseDown={bm(() => editor.chain().focus().setTextAlign('right').run())}><i className="ti ti-align-right"/></button>
    </div>
  )
}

export default function Editor() {
  const { doc, newDoc, openFile, saveDoc, updateContent, updateTitle } = useStore()

  const [localTitle, setLocalTitle]           = useState('')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showHlPicker, setShowHlPicker]       = useState(false)
  const [confirmNew, setConfirmNew]           = useState(false)

  const colorRef  = useRef<HTMLDivElement>(null)
  const hlRef     = useRef<HTMLDivElement>(null)
  const isBinding = useRef(false)

  // Sync localTitle dengan doc.title
  useEffect(() => {
    if (doc) setLocalTitle(doc.title)
  }, [doc?.filePath])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1,2,3] } }),
      TextAlign.configure({ types: ['heading','paragraph'] }),
      Underline, TextStyle, Color,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: 'Mulai tulis di sini...' }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (isBinding.current) return
      const md = turndown.turndown(editor.getHTML())
      updateContent(md)
    },
    editorProps: { attributes: { class: 'tiptap-editor-content', spellcheck: 'false' } },
  })

  // Load konten saat doc berubah
  useEffect(() => {
    if (!editor || !doc) return
    isBinding.current = true
    const raw    = doc.content || ''
    const isHTML = /<[a-z][\s\S]*>/i.test(raw)
    editor.chain().clearContent(false).setContent(isHTML ? raw : marked.parse(raw) as string, false).run()
    setLocalTitle(doc.title)
    setTimeout(() => { isBinding.current = false }, 100)
  }, [doc?.filePath, editor])

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveDoc()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveDoc])

  // Tutup picker saat klik luar
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setShowColorPicker(false)
      if (hlRef.current    && !hlRef.current.contains(e.target as Node))    setShowHlPicker(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const wordCount = editor ? editor.getText().trim().split(/\s+/).filter(Boolean).length : 0

  // Empty state
  if (!doc) return (
    <div className="editor-empty">
      <div className="empty-icon">📝</div>
      <div className="empty-title">Tidak ada file dibuka</div>
      <div className="empty-sub">Buat file baru atau buka file yang sudah ada</div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button className="btn-primary"   onClick={newDoc}><i className="ti ti-file-plus"/> Baru</button>
        <button className="btn-secondary" onClick={openFile}><i className="ti ti-folder-open"/> Buka File</button>
      </div>
    </div>
  )

  return (
    <div className="editor-area">

      {/* Header */}
      <div className="editor-header">
        <div className="cat-row">
          {doc.filePath ? (
            <div className="cat-pill">
              <i className="ti ti-file-symlink" />
              <span style={{ maxWidth: 280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {doc.filePath}
              </span>
            </div>
          ) : (
            <div className="cat-pill" style={{ color:'var(--yellow)', borderColor:'#3a3210' }}>
              <i className="ti ti-alert-circle" /> Belum disimpan
            </div>
          )}
          {doc.isDirty && (
            <div className="cat-pill" style={{ color:'var(--yellow)', borderColor:'#3a3210' }}>
              <i className="ti ti-circle-dot" /> Ada perubahan
            </div>
          )}
          {!doc.isDirty && doc.filePath && (
            <div className="cat-pill green">
              <i className="ti ti-check" /> Tersimpan
            </div>
          )}
        </div>

        <input
          className="title-input"
          value={localTitle}
          placeholder="Judul..."
          onChange={e => {
            setLocalTitle(e.target.value)
            updateTitle(e.target.value)
          }}
        />

        <div className="meta-row">
          <div className="meta-item"><i className="ti ti-letter-case" /> {wordCount} kata</div>
          {doc.filePath && (
            <div className="meta-item">
              <i className="ti ti-file" />
              {doc.filePath.split('.').pop()?.toUpperCase()}
            </div>
          )}
        </div>
      </div>

      <div className="divider" />

      {/* Toolbar */}
      {editor && (
        <div className="toolbar toolbar-wysiwyg">
          <TBtn icon="ti-arrow-back-up"    tip="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
          <TBtn icon="ti-arrow-forward-up" tip="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
          <div className="tb-sep" />

          <select className="tb-select"
            value={editor.isActive('heading',{level:1})?'1':editor.isActive('heading',{level:2})?'2':editor.isActive('heading',{level:3})?'3':'0'}
            onChange={e => {
              const v = Number(e.target.value)
              if (v===0) editor.chain().focus().setParagraph().run()
              else editor.chain().focus().toggleHeading({ level: v as 1|2|3 }).run()
            }}>
            <option value="0">Paragraf</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>
          <div className="tb-sep" />

          <TBtn icon="ti-bold"          tip="Bold"          active={editor.isActive('bold')}      onClick={() => editor.chain().focus().toggleBold().run()} />
          <TBtn icon="ti-italic"        tip="Italic"        active={editor.isActive('italic')}    onClick={() => editor.chain().focus().toggleItalic().run()} />
          <TBtn icon="ti-underline"     tip="Underline"     active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
          <TBtn icon="ti-strikethrough" tip="Strikethrough" active={editor.isActive('strike')}    onClick={() => editor.chain().focus().toggleStrike().run()} />
          <div className="tb-sep" />

          <TBtn icon="ti-align-left"      tip="Rata Kiri"  active={editor.isActive({textAlign:'left'})}    onClick={() => editor.chain().focus().setTextAlign('left').run()} />
          <TBtn icon="ti-align-center"    tip="Tengah"     active={editor.isActive({textAlign:'center'})}  onClick={() => editor.chain().focus().setTextAlign('center').run()} />
          <TBtn icon="ti-align-right"     tip="Rata Kanan" active={editor.isActive({textAlign:'right'})}   onClick={() => editor.chain().focus().setTextAlign('right').run()} />
          <TBtn icon="ti-align-justified" tip="Justify"    active={editor.isActive({textAlign:'justify'})} onClick={() => editor.chain().focus().setTextAlign('justify').run()} />
          <div className="tb-sep" />

          <TBtn icon="ti-list"         tip="Bullet List"  active={editor.isActive('bulletList')}  onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <TBtn icon="ti-list-numbers" tip="Ordered List" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
          <div className="tb-sep" />

          <TBtn icon="ti-quote"     tip="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
          <TBtn icon="ti-code"      tip="Inline Code" active={editor.isActive('code')}      onClick={() => editor.chain().focus().toggleCode().run()} />
          <TBtn icon="ti-code-dots" tip="Code Block"  active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
          <div className="tb-sep" />

          <div className="tb-color-wrap" ref={colorRef}>
            <button className="tb-btn" title="Warna Teks" onMouseDown={e => { e.preventDefault(); setShowColorPicker(v=>!v); setShowHlPicker(false) }}>
              <i className="ti ti-letter-a"/><span className="tb-btn-label">Warna</span>
            </button>
            {showColorPicker && (
              <div className="color-palette">
                {TEXT_COLORS.map(c => (
                  <button key={c} className="color-swatch" style={{ background:c, border:c==='#ffffff'?'1px solid #444':'none' }}
                    onMouseDown={e => { e.preventDefault(); editor.chain().focus().setColor(c).run(); setShowColorPicker(false) }} />
                ))}
                <button className="color-swatch color-clear" onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetColor().run(); setShowColorPicker(false) }}>✕</button>
              </div>
            )}
          </div>

          <div className="tb-color-wrap" ref={hlRef}>
            <button className="tb-btn" title="Highlight" onMouseDown={e => { e.preventDefault(); setShowHlPicker(v=>!v); setShowColorPicker(false) }}>
              <i className="ti ti-highlight"/><span className="tb-btn-label">Sorot</span>
            </button>
            {showHlPicker && (
              <div className="color-palette">
                {HIGHLIGHT_COLORS.map(c => (
                  <button key={c} className="color-swatch" style={{ background:c }}
                    onMouseDown={e => { e.preventDefault(); editor.chain().focus().setHighlight({ color:c }).run(); setShowHlPicker(false) }} />
                ))}
                <button className="color-swatch color-clear" onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetHighlight().run(); setShowHlPicker(false) }}>✕</button>
              </div>
            )}
          </div>
          <div className="tb-sep" />
          <TBtn icon="ti-clear-formatting" tip="Hapus Format" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} />
        </div>
      )}

      {/* Body */}
      <div className="editor-body mode-wysiwyg">
        <div className="editor-pane edit-pane wysiwyg-pane" style={{ position:'relative' }}>
          {editor && <FloatingMenu editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Footer */}
      <div className="editor-footer">
        <button className="btn-save-file" onClick={saveDoc}>
          <i className="ti ti-device-floppy" /> Simpan
          <span style={{ fontSize:10, opacity:0.7, marginLeft:4 }}>Ctrl+S</span>
        </button>
        {confirmNew ? (
          <>
            <button className="btn-danger" onClick={() => { newDoc(); setConfirmNew(false) }}>
              <i className="ti ti-check" /> Yakin? (perubahan hilang)
            </button>
            <button className="btn-secondary" onClick={() => setConfirmNew(false)}>Batal</button>
          </>
        ) : (
          <button className="btn-secondary" onClick={() => doc.isDirty ? setConfirmNew(true) : newDoc()}>
            <i className="ti ti-file-plus" /> Baru
          </button>
        )}
        <button className="btn-secondary" onClick={openFile}>
          <i className="ti ti-folder-open" /> Buka
        </button>
        <span className="word-count">{wordCount} kata</span>
      </div>
    </div>
  )
}
