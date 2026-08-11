import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TurndownService from 'turndown'
import { tables as turndownTables, taskListItems as turndownTaskListItems } from 'turndown-plugin-gfm'
import { marked } from 'marked'
import { useStore } from '../../store/useStore'
import { markWriting, clearWriting } from '../../lib/writingMode'
import { compareFidelity } from '../../lib/mdFidelity'
import { extensionOf } from '../../lib/filePath'
import './Editor.css'

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
// Tabel GFM (```| a | b |```) dan `- [ ] task` — dua dari tiga konstruksi yang
// hilang di Bug #1. Hanya dua rule ini yang diambil dari plugin, BUKAN bundel
// `gfm` penuhnya: bundel itu juga menimpa strikethrough dengan sintaks tilde
// tunggal non-standar (`~teks~`), berbeda dari `~~teks~~` yang dipetakan balik
// oleh Strike node TipTap (lihat keepStrikethrough di bawah).
turndown.use([turndownTables, turndownTaskListItems])

// [A1] Markdown murni tidak punya sintaks untuk underline, warna teks, highlight,
// maupun perataan teks. Turndown default membuang keempatnya TANPA peringatan,
// jadi format yang dipakai user hilang permanen begitu file disimpan — sementara
// di layar masih terlihat utuh selama sesi berjalan.
//
// HTML inline di dalam Markdown itu legal, marked meneruskannya apa adanya, dan
// TipTap bisa mem-parsing-nya kembali menjadi mark yang sama. Jadi keempat node
// ini dipertahankan sebagai HTML alih-alih dibuang.
const attr = (node: Node, name: string) => (node as HTMLElement).getAttribute?.(name) ?? ''
const esc  = (v: string) => v.replace(/"/g, '&quot;')

turndown.addRule('keepUnderline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`,
})

turndown.addRule('keepHighlight', {
  filter: ['mark'],
  replacement: (content, node) => {
    const color = attr(node, 'data-color')
    const style = attr(node, 'style')
    const attrs = [
      color ? ` data-color="${esc(color)}"` : '',
      style ? ` style="${esc(style)}"`      : '',
    ].join('')
    return `<mark${attrs}>${content}</mark>`
  },
})

// Warna teks dari extension Color dirender sebagai <span style="color: …">
turndown.addRule('keepTextStyle', {
  filter: (node) => node.nodeName === 'SPAN' && !!attr(node, 'style'),
  replacement: (content, node) => `<span style="${esc(attr(node, 'style'))}">${content}</span>`,
})

// Perataan teks ada sebagai style di blok, bukan sebagai mark. Isinya dipertahankan
// sebagai HTML utuh supaya format di dalamnya (bold, warna, dst.) ikut selamat.
turndown.addRule('keepAlignedBlock', {
  filter: (node) =>
    /^(P|H1|H2|H3)$/.test(node.nodeName) && /text-align/i.test(attr(node, 'style')),
  replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`,
})

// [Ditemukan saat mengerjakan Bug #1] Strike (tombol Strikethrough di toolbar)
// merender <s>, tapi turndown TIDAK punya rule bawaan untuk <s>/<del>/<strike> —
// isinya lolos tanpa tanda formatnya hilang, sama persis seperti empat kasus
// di atas. `~~teks~~` dipilih (bukan `~teks~`) karena itu yang dipetakan balik
// ke <del> oleh marked (gfm:true) dan diterima parseHTML Strike node TipTap.
turndown.addRule('keepStrikethrough', {
  // Filter fungsi, bukan array tag — 'strike' bukan key valid di
  // HTMLElementTagNameMap (tag lawas, tidak ada di lib.dom.d.ts).
  filter: (node) => /^(S|DEL|STRIKE)$/.test(node.nodeName),
  replacement: (content) => `~~${content}~~`,
})

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

/** Ilustrasi empty state — SVG inline supaya ikut warna tema lewat CSS variable.
 *  Animasinya di Editor.css (dan otomatis mati saat prefers-reduced-motion). */
function EmptyIllustration() {
  return (
    <svg className="empty-art" viewBox="0 0 120 120" width="112" height="112" aria-hidden="true">
      <defs>
        <linearGradient id="ea-line" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="var(--accent-soft)" />
          <stop offset="100%" stopColor="var(--mint)" />
        </linearGradient>
      </defs>

      <circle className="empty-orb" cx="60" cy="58" r="33" fill="var(--accent)" opacity="0.16" />

      <g className="empty-page">
        <rect x="38" y="29" width="45" height="60" rx="8"
          fill="var(--surface-raised)" stroke="var(--hairline-strong)" strokeWidth="1" />
        <rect x="47" y="42" width="27" height="4"   rx="2"   fill="url(#ea-line)" />
        <rect x="47" y="53" width="21" height="3.5" rx="1.75" fill="var(--text-dim)" opacity=".55" />
        <rect x="47" y="62" width="26" height="3.5" rx="1.75" fill="var(--text-dim)" opacity=".38" />
        <rect x="47" y="71" width="15" height="3.5" rx="1.75" fill="var(--text-dim)" opacity=".26" />
      </g>

      <g className="empty-spark">
        <path d="M93 32 l2.3 5.6 5.6 2.3 -5.6 2.3 -2.3 5.6 -2.3 -5.6 -5.6 -2.3 5.6 -2.3z"
          fill="var(--mint)" />
      </g>
    </svg>
  )
}

function FloatingMenu({ editor }: { editor: any }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const updateRef = useRef<() => void>(() => {})

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
    updateRef.current = update
    const onBlur = () => setPos(null)
    // Use a stable wrapper to avoid stale closure for selectionchange
    const stableUpdate = () => updateRef.current()
    editor.on('selectionUpdate', update)
    editor.on('blur', onBlur)
    document.addEventListener('selectionchange', stableUpdate)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur', onBlur)
      document.removeEventListener('selectionchange', stableUpdate)
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
  const doc = useStore(s => s.doc)
  const newDoc = useStore(s => s.newDoc)
  const openFile = useStore(s => s.openFile)
  const saveDoc = useStore(s => s.saveDoc)
  const updateContent = useStore(s => s.updateContent)
  const updateTitle = useStore(s => s.updateTitle)
  const setContentWarning = useStore(s => s.setContentWarning)

  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showHlPicker, setShowHlPicker]       = useState(false)
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [imageUrl, setImageUrl]               = useState('')
  const [justSaved, setJustSaved]             = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const colorRef  = useRef<HTMLDivElement>(null)
  const hlRef     = useRef<HTMLDivElement>(null)
  const imgRef    = useRef<HTMLDivElement>(null)
  const isBinding = useRef(false)
  const lastContentRef = useRef<string | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1,2,3] } }),
      TextAlign.configure({ types: ['heading','paragraph'] }),
      // [B12] Underline TIDAK didaftarkan di sini — @tiptap/starter-kit v3 sudah
      // memaketkannya. Mendaftar ulang memicu warning "Duplicate extension names"
      // (terbukti di runtime) dan mendaftarkan schema dua kali.
      TextStyle, Color,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: 'Mulai tulis di sini...' }),
      // [Bug #1] Tabel/gambar/task-list TIDAK dipaketkan StarterKit v3 — tanpa
      // ketiganya, marked menghasilkan <table>/<img>/<input type=checkbox> yang
      // ProseMirror buang karena tidak ada di schema, lalu onUpdate menulis-balik
      // HTML yang sudah telanjur bersih itu ke doc.content. Hilang permanen dari
      // file begitu user mengetik satu karakter.
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (isBinding.current) return
      markWriting()
      const md = turndown.turndown(editor.getHTML())
      lastContentRef.current = md
      updateContent(md)
    },
    onFocus: () => markWriting(),
    onBlur:  () => clearWriting(),
    editorProps: { attributes: { class: 'tiptap-editor-content', spellcheck: 'false' } },
  })

  // Jangan tinggalkan aurora dalam keadaan redup kalau editor dilepas saat fokus
  useEffect(() => clearWriting, [])

  // Load konten saat doc berubah secara eksternal
  useEffect(() => {
    if (!editor || !doc) return
    if (doc.content === lastContentRef.current) return // Prevent reset on user typing

    isBinding.current = true
    lastContentRef.current = doc.content
    const raw    = doc.content || ''
    editor.chain().setContent(marked.parse(raw, { breaks: true }) as string, { emitUpdate: false }).run()

    // Unlock after TipTap finishes its update cycle (not a fragile fixed timeout)
    let raf1: number
    let raf2: number
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        isBinding.current = false
        // [Bug #1 — jaring pengaman akar] Bandingkan apa yang BENAR-BENAR
        // bertahan di editor terhadap apa yang tadinya masuk. Ini menangkap
        // konstruksi APA PUN yang schema tidak kenal — bukan cuma tabel/
        // gambar/task-list yang sudah ditambal lewat extension di atas —
        // supaya celah berikutnya yang belum diketahui tidak lolos senyap.
        const roundTripped = turndown.turndown(editor.getHTML())
        const { lossy, lost } = compareFidelity(raw, roundTripped)
        setContentWarning(lossy ? lost : null)
      })
    })
    
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [doc?.content, editor])

  // Simpan + konfirmasi visual singkat. Hanya berubah kalau penulisan benar-benar
  // berhasil — saveDoc() mengembalikan false saat dibatalkan atau gagal.
  const handleSave = useCallback(async () => {
    if (!await saveDoc()) return
    setJustSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setJustSaved(false), 1600)
  }, [saveDoc])

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  const insertImage = useCallback(() => {
    const url = imageUrl.trim()
    if (!url || !editor) return
    editor.chain().focus().setImage({ src: url }).run()
    setImageUrl('')
    setShowImagePicker(false)
  }, [imageUrl, editor])

  // Tutup picker saat klik luar
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setShowColorPicker(false)
      if (hlRef.current    && !hlRef.current.contains(e.target as Node))    setShowHlPicker(false)
      if (imgRef.current   && !imgRef.current.contains(e.target as Node))   setShowImagePicker(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const wordCount = editor ? editor.getText().trim().split(/\s+/).filter(Boolean).length : 0

  // Empty state
  if (!doc) return (
    <div className="editor-empty">
      <EmptyIllustration />
      <div className="empty-title">Tidak ada file dibuka</div>
      <div className="empty-sub">Buat file baru atau buka file yang sudah ada</div>
      <div className="empty-actions">
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
            <div className="cat-pill path" title={doc.filePath}>
              <i className="ti ti-file-symlink" />
              <span>{doc.filePath}</span>
            </div>
          ) : (
            <div className="cat-pill warn">
              <i className="ti ti-alert-circle" /> Belum disimpan
            </div>
          )}
          {doc.isDirty && (
            <div className="cat-pill warn">
              <i className="ti ti-circle-dot" /> Ada perubahan
            </div>
          )}
          {!doc.isDirty && doc.filePath && (
            <div className="cat-pill green">
              <i className="ti ti-check" /> Tersimpan
            </div>
          )}
          {doc.contentWarning && doc.contentWarning.length > 0 && (
            <div className="cat-pill warn" title={`Terdeteksi hilang saat parsing: ${doc.contentWarning.join(', ')}`}>
              <i className="ti ti-alert-triangle" /> Sebagian konten mungkin hilang
            </div>
          )}
        </div>

        <input
          className="title-input"
          value={doc.title}
          placeholder="Judul..."
          onChange={e => {
            updateTitle(e.target.value)
          }}
        />

        <div className="meta-row">
          <div className="meta-item"><i className="ti ti-letter-case" /> {wordCount} kata</div>
          {doc.filePath && (
            <div className="meta-item">
              <i className="ti ti-file" />
              {extensionOf(doc.filePath).toUpperCase()}
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
          <TBtn icon="ti-list-check"   tip="Task List"    active={editor.isActive('taskList')}    onClick={() => editor.chain().focus().toggleTaskList().run()} />
          <div className="tb-sep" />

          <TBtn icon="ti-quote"     tip="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
          <TBtn icon="ti-code"      tip="Inline Code" active={editor.isActive('code')}      onClick={() => editor.chain().focus().toggleCode().run()} />
          <TBtn icon="ti-code-dots" tip="Code Block"  active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
          <div className="tb-sep" />

          <TBtn icon="ti-table-plus" tip="Sisipkan Tabel"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
          {editor.isActive('table') && (
            <>
              <TBtn icon="ti-row-insert-bottom"   tip="Tambah Baris" onClick={() => editor.chain().focus().addRowAfter().run()} />
              <TBtn icon="ti-column-insert-right" tip="Tambah Kolom" onClick={() => editor.chain().focus().addColumnAfter().run()} />
              <TBtn icon="ti-row-remove"          tip="Hapus Baris"  onClick={() => editor.chain().focus().deleteRow().run()} />
              <TBtn icon="ti-column-remove"       tip="Hapus Kolom"  onClick={() => editor.chain().focus().deleteColumn().run()} />
              <TBtn icon="ti-table-off"           tip="Hapus Tabel"  onClick={() => editor.chain().focus().deleteTable().run()} />
            </>
          )}

          <div className="tb-color-wrap" ref={imgRef}>
            <button className="tb-btn" title="Sisipkan Gambar" onMouseDown={e => {
              e.preventDefault(); setShowImagePicker(v => !v); setShowColorPicker(false); setShowHlPicker(false)
            }}>
              <i className="ti ti-photo" /><span className="tb-btn-label">Gambar</span>
            </button>
            {showImagePicker && (
              <div className="image-url-popover">
                <input
                  className="image-url-input"
                  type="text"
                  placeholder="URL gambar…"
                  value={imageUrl}
                  onChange={e => setImageUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertImage() } }}
                  autoFocus
                />
                <button className="image-url-btn" onMouseDown={e => { e.preventDefault(); insertImage() }} title="Sisipkan">
                  <i className="ti ti-check" />
                </button>
              </div>
            )}
          </div>
          <div className="tb-sep" />

          <div className="tb-color-wrap" ref={colorRef}>
            <button className="tb-btn" title="Warna Teks" onMouseDown={e => { e.preventDefault(); setShowColorPicker(v=>!v); setShowHlPicker(false); setShowImagePicker(false) }}>
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
            <button className="tb-btn" title="Highlight" onMouseDown={e => { e.preventDefault(); setShowHlPicker(v=>!v); setShowColorPicker(false); setShowImagePicker(false) }}>
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
        <div className="editor-pane wysiwyg-pane">
          {editor && <FloatingMenu editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Footer */}
      <div className="editor-footer">
        <button className={`btn-save-file ${justSaved ? 'saved' : ''}`} onClick={handleSave}>
          <i className={`ti ${justSaved ? 'ti-check' : 'ti-device-floppy'}`} />
          {justSaved ? 'Tersimpan' : 'Simpan'}
          <span className="save-hint">Ctrl+S</span>
        </button>
        {/* [B1] Konfirmasi perubahan belum disimpan sekarang ditangani terpusat di store */}
        <button className="btn-secondary" onClick={newDoc}>
          <i className="ti ti-file-plus" /> Baru
        </button>
        <button className="btn-secondary" onClick={openFile}>
          <i className="ti ti-folder-open" /> Buka
        </button>
        <span className="word-count">{wordCount} kata</span>
      </div>
    </div>
  )
}
