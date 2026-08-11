import React, { useState, useEffect, useRef, useCallback, useDeferredValue } from 'react'
import DOMPurify from 'dompurify'
import { useStore, selectActiveModelMissing, type AIStatus } from '../../store/useStore'
import { RETRYABLE_ERROR_KINDS, type ChatMessage } from '../../types'
import { parseMarkdown } from '../../lib/mdSerialize'
import './Chat.css'

// Sanitize markdown HTML to prevent XSS (critical in Electron context)
function renderMarkdown(content: string): string {
  const rawHtml = parseMarkdown(content || '')
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: ['p','br','strong','em','del','ul','ol','li','h1','h2','h3',
                   'h4','h5','h6','blockquote','pre','code','a','table','thead',
                   'tbody','tr','th','td','hr','span','img','sup','sub'],
    ALLOWED_ATTR: ['href','target','rel','class','alt','src'],
    ALLOW_DATA_ATTR: false,
  })
}


interface ChatProps {
  embedded?: boolean  // true = panel kanan editor, false = full page
}

export default function Chat({ embedded = false }: ChatProps) {
  // [Bug #16] Selector per-field — sebelumnya destructure dari useStore()
  // tanpa selector membuat Chat berlangganan ke SELURUH store. Saat dipakai
  // sebagai panel tersemat di samping Editor, itu berarti Chat ikut re-render
  // pada SETIAP ketukan tombol di editor (doc.content berubah tiap keystroke)
  // dan setiap perubahan state lain yang sama sekali tidak dibaca komponen ini.
  const settings        = useStore(s => s.settings)
  const messages        = useStore(s => s.messages)
  const sendMessage     = useStore(s => s.sendMessage)
  const clearMessages   = useStore(s => s.clearMessages)
  const streamingText   = useStore(s => s.streamingText)
  const aiStatus        = useStore(s => s.aiStatus)
  const aiStatusDetail  = useStore(s => s.aiStatusDetail)
  const cancelStream    = useStore(s => s.cancelStream)
  const doc             = useStore(s => s.doc)
  const lastErrorKind   = useStore(s => s.lastErrorKind)
  const lastAttempt     = useStore(s => s.lastAttempt)
  const retryLast       = useStore(s => s.retryLast)
  const setView         = useStore(s => s.setView)
  // [Celah 3] Sama seperti peringatan di Pengaturan, tapi ditampilkan di sini
  // juga — supaya user yang tidak pernah membuka Pengaturan tetap tahu SEBELUM
  // mengirim pesan, bukan setelah request gagal.
  const activeModelMissing = useStore(selectActiveModelMissing)

  const [input, setInput]               = useState('')
  const [useContext, setUseContext]      = useState(embedded)  // embedded mode defaults to true
  const [useWebSearch, setWebSearch]    = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [fileContext, setFileContext]   = useState<{ title: string; content: string } | null>(null)

  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const messagesRef  = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [copiedIdx, setCopiedIdx]         = useState<number | null>(null)

  const isProcessing = aiStatus !== 'idle' && aiStatus !== 'error'

  // [L2] Sebelumnya `doc` truthy saja sudah cukup — dokumen baru yang masih
  // kosong membuat bar "konteks aktif" tampil hijau padahal store menjaga
  // `doc?.content` dan tidak menyuntikkan apa pun ke prompt. Sekarang harus
  // benar-benar ada isi, sama dengan syarat yang dipakai sendMessage().
  const activeContext = useContext
    ? (doc?.content ? { title: doc.title, content: doc.content } : fileContext)
    : null

  // [UI-1] `bottomRef.current.scrollIntoView()` sebelumnya dipakai di sini.
  // Bug nyata: `scrollIntoView()` menyusuri ANCESTOR CHAIN mencari kontainer
  // yang overflow — kalau `.chat-messages` (kontainer yang SEHARUSNYA discroll,
  // `overflow-y:auto`) kebetulan belum overflow saat efek ini jalan (persis
  // kondisi mount pertama / baru pindah dari view lain lewat View Transition,
  // sebelum layout benar-benar settle), browser terus naik mencari kontainer
  // scrollable BERIKUTNYA dan bisa salah mengunci ke `.app-shell` (yang
  // technically scrollable karena `overflow:hidden` tetap membentuk scrollport,
  // cuma tidak menampilkan scrollbar) kalau elemen itu KEBETULAN sedang
  // overflow sesaat. Begitu terjadi, `.app-shell` tertinggal ter-scroll
  // permanen — SELURUH app bergeser ke atas, dan area di bawah input jadi
  // ruang kosong yang tidak pernah balik ke 0 lagi. Terverifikasi lewat
  // Playwright: `.app-shell.scrollTop` macet di 200px setelah membuka view
  // "Tanya AI"; me-reset ke 0 langsung memperbaiki layout.
  //
  // Fix: scroll LANGSUNG kontainer yang dimaksud (`messagesRef`, sudah ada
  // untuk tracking tombol scroll-to-bottom) lewat scrollTop/scrollTo — tidak
  // pernah bisa salah mengenai ancestor lain sama sekali.
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: aiStatus === 'streaming' ? 'auto' : 'smooth' })
  }, [messages.length, streamingText, aiStatus])

  // Track scroll position for scroll-to-bottom button
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollBtn(distFromBottom > 120)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    // [Bug #21] Timer sebelumnya tidak pernah di-clear saat unmount/re-run —
    // efek yang berjalan lagi sebelum timer lama sempat fires membiarkan
    // beberapa timer menumpuk, dan unmount di tengah 50ms itu memanggil
    // .focus() pada textarea yang sudah lenyap dari DOM.
    if (aiStatus !== 'idle') return
    const tid = setTimeout(() => textareaRef.current?.focus(), 50)
    return () => clearTimeout(tid)
  }, [aiStatus])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [input])

  const handlePickContextFile = async () => {
    const result = await window.api.file.openAsContext()
    if (!result) return                      // dialog dibatalkan user
    if (!result.ok) {
      useStore.getState().showToast('err', `Gagal membuka file konteks: ${result.error}`)
      return
    }
    setFileContext({ title: result.title, content: result.content })
    setUseContext(true)
  }

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isProcessing) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    textareaRef.current?.focus()
    const accepted = await sendMessage(text, useContext, useWebSearch, useContext && !doc ? fileContext : null)
    // [C4] Pesan ditolak SEBELUM masuk transkrip (mis. API key belum diset) —
    // kembalikan teksnya ke textarea alih-alih membiarkannya hilang begitu saja.
    if (!accepted) setInput(text)
  }, [input, isProcessing, useContext, useWebSearch, sendMessage, doc, fileContext])

  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopy = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx)
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current)
      copyResetTimerRef.current = setTimeout(() => setCopiedIdx(null), 2000)
    }).catch(() => {
      // [Bug #20] Penolakan izin clipboard sebelumnya jadi unhandled promise
      // rejection — tombol diam saja tanpa umpan balik apa pun ke user.
      useStore.getState().showToast('err', 'Gagal menyalin ke clipboard')
    })
  }, [])

  // [Bug #21] Timer reset "Tersalin!" tidak pernah di-clear saat unmount.
  useEffect(() => () => {
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current)
  }, [])

  const handleSuggestion = useCallback((text: string) => {
    setInput(text)
    textareaRef.current?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const personaName = settings?.persona_name ?? 'Mai'

  const ctxLabel = !useContext
    ? 'Konteks'
    : doc
      ? (doc.title.length > 16 ? doc.title.slice(0, 16) + '…' : doc.title)
      : fileContext
        ? (fileContext.title.length > 16 ? fileContext.title.slice(0, 16) + '…' : fileContext.title)
        : 'Pilih File…'

  return (
    <div className={`chat-wrap ${embedded ? 'embedded' : 'standalone'}`}>

      {/* Header */}
      <div className="chat-header">
        <div className="chat-persona">
          <div className="persona-avatar">🌸</div>
          <div>
            <div className="persona-name">{personaName}</div>
            <div className="persona-sub">
              {settings?.active_model ?? '—'} · {messages.length} pesan
            </div>
          </div>
        </div>

        <div className="chat-header-actions">
          {isProcessing && (
            <button className="hdr-btn danger" onClick={cancelStream} title="Hentikan">
              <i className="ti ti-player-stop" />
            </button>
          )}
          {confirmClear ? (
            <>
              <button className="hdr-btn danger" onClick={() => { clearMessages(); setConfirmClear(false) }}>
                <i className="ti ti-check" /> Yakin?
              </button>
              <button className="hdr-btn" onClick={() => setConfirmClear(false)}>Batal</button>
            </>
          ) : (
            <button className="hdr-btn" onClick={() => setConfirmClear(true)} title="Bersihkan chat">
              <i className="ti ti-trash" />
              {!embedded && <span>Bersihkan</span>}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages" ref={messagesRef}>
        {messages.length === 0 && !streamingText && aiStatus === 'idle' && (
          <WelcomeScreen
            personaName={personaName}
            activeContext={activeContext}
            embedded={embedded}
            onPickFile={handlePickContextFile}
            useContext={useContext}
            onSuggestion={handleSuggestion}
          />
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            msg={msg}
            personaName={personaName}
            index={i}
            copiedIdx={copiedIdx}
            onCopy={handleCopy}
          />
        ))}

        {(streamingText || isProcessing) && (
          <StreamingBubble
            text={streamingText}
            status={aiStatus}
            detail={aiStatusDetail}
            personaName={personaName}
          />
        )}

        {/* [Aturan 7] Retry TIDAK pernah otomatis — kalau kuota sedang habis,
            retry di background cuma memperparah. Kontrolnya di tangan user. */}
        {!isProcessing && lastAttempt && lastErrorKind && RETRYABLE_ERROR_KINDS.includes(lastErrorKind) && (
          <div className="retry-row">
            <button className="retry-btn" onClick={retryLast}>
              <i className="ti ti-refresh" /> Coba lagi
            </button>
            <span className="retry-hint">
              {lastErrorKind === 'quota'   && 'Tunggu sebentar sebelum mencoba — kuota provider sedang habis.'}
              {lastErrorKind === 'network' && 'Periksa koneksi internet dulu.'}
              {lastErrorKind === 'server'  && 'Server provider sedang bermasalah.'}
            </span>
          </div>
        )}
      </div>

      {/* Scroll to bottom */}
      {showScrollBtn && (
        <button
          className="scroll-bottom-btn"
          onClick={() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })}
        >
          <i className="ti ti-arrow-down" />
        </button>
      )}

      {/* Input area */}
      <div className="chat-input-area">

        {/* Context + status bar */}
        <div className="chat-controls">
          <button
            className={`pill-btn ${useContext ? 'on' : ''}`}
            onClick={async () => {
              const next = !useContext
              setUseContext(next)
              if (next && !doc && !fileContext) await handlePickContextFile()
            }}
            title={useContext ? 'Nonaktifkan konteks' : 'Aktifkan konteks file'}
          >
            <i className={`ti ${useContext && activeContext ? 'ti-file-check' : 'ti-file-text'}`} />
            {ctxLabel}
          </button>

          {useContext && !doc && (
            <button className="pill-btn" onClick={handlePickContextFile} title="Ganti file konteks">
              <i className="ti ti-refresh" />
            </button>
          )}

          <button
            className={`pill-btn ${useWebSearch ? 'on-web' : ''}`}
            onClick={() => setWebSearch(v => !v)}
            title="Web search (segera hadir)"
            disabled
          >
            <i className="ti ti-world" />
            {!embedded && 'Web (soon)'}
          </button>

          {aiStatus !== 'idle' && (
            <span className={`status-pill ${aiStatus === 'error' ? 'err' : 'proc'}`}>
              <i className={`ti ${aiStatus === 'error' ? 'ti-alert-circle' : 'ti-loader-2 spin'}`} />
              {!embedded && (aiStatusDetail || getStatusLabel(aiStatus))}
            </span>
          )}
        </div>

        {/* Active context bar */}
        {useContext && activeContext && (
          <div className="ctx-bar active">
            <i className="ti ti-file-check" />
            <span className="ctx-bar-title">{activeContext.title}</span>
            {!doc && (
              <button className="ctx-bar-btn" onClick={handlePickContextFile}>
                <i className="ti ti-pencil" />
              </button>
            )}
          </div>
        )}

        {/* Warning: no file selected */}
        {useContext && !activeContext && (
          <div className="ctx-bar warn">
            <i className="ti ti-alert-circle" />
            <span>Belum ada file dipilih</span>
            <button className="ctx-bar-btn" onClick={handlePickContextFile}>
              <i className="ti ti-folder-open" /> Pilih
            </button>
          </div>
        )}

        {/* [Celah 3][Aturan 4] Model aktif tidak ada di daftar terverifikasi provider ini */}
        {activeModelMissing && (
          <div className="ctx-bar warn">
            <i className="ti ti-alert-circle" />
            <span>Model aktif "{settings?.active_model}" tidak tersedia untuk key ini</span>
            <button className="ctx-bar-btn" onClick={() => setView('settings')}>
              <i className="ti ti-settings" /> Pengaturan
            </button>
          </div>
        )}

        {/* Textarea + send */}
        <div className="input-row">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Tanya ${personaName}…`}
            rows={1}
            disabled={isProcessing}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={isProcessing || !input.trim()}
          >
            <i className={`ti ${isProcessing ? 'ti-loader-2 spin' : 'ti-send'}`} />
          </button>
        </div>

      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Jelaskan konsep ini secara sederhana',
  'Buatkan ringkasan materi ini',
  'Berikan contoh kode untuk topik ini',
  'Apa kelebihan dan kekurangan?',
]

function WelcomeScreen({ personaName, activeContext, embedded, onPickFile, useContext, onSuggestion }: {
  personaName: string
  activeContext: { title: string; content: string } | null
  embedded: boolean
  onPickFile: () => void
  useContext: boolean
  onSuggestion: (text: string) => void
}) {
  return (
    <div className="chat-welcome">
      <div className="welcome-avatar">🌸</div>
      <div className="welcome-name">Halo! Aku {personaName}</div>
      {!embedded && (
        <div className="welcome-sub">
          Tanya apa aja. Aktifkan konteks untuk analisis file yang dibuka.
        </div>
      )}
      {activeContext && (
        <div className="ctx-badge">
          <i className="ti ti-file-check" /> {activeContext.title}
        </div>
      )}
      {useContext && !activeContext && (
        <button className="ctx-badge pick" onClick={onPickFile}>
          <i className="ti ti-folder-open" /> Pilih file konteks
        </button>
      )}
      {!embedded && (
        <div className="suggestion-chips">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              className="suggestion-chip"
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => onSuggestion(s)}
            >
              <i className="ti ti-sparkles" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// [Perf sesi panjang] React.memo di sini yang sebenarnya menghentikan
// transkrip terus-menerus di-re-sanitize: tanpanya, Chat re-render tiap kali
// streamingText berubah (setiap frame yang di-commit rAF-coalescer di
// useStore.ts) membuat SEMUA bubble pesan lama ikut re-render dan
// menjalankan ulang marked.parse+DOMPurify.sanitize walau kontennya tidak
// berubah. useMemo di dalam adalah jaring pengaman kedua terhadap
// renderMarkdown itu sendiri kalau suatu saat props lain berubah tanpa
// content-nya berubah.
const MessageBubble = React.memo(function MessageBubble({ msg, personaName, index, copiedIdx, onCopy }: {
  msg: ChatMessage; personaName: string; index: number;
  copiedIdx: number | null; onCopy: (text: string, idx: number) => void;
}) {
  const isUser = msg.role === 'user'
  const html = React.useMemo(() => renderMarkdown(msg.content), [msg.content])
  return (
    <div className={`msg-row ${isUser ? 'user' : 'ai'}`}>
      {!isUser && (
        <div className="msg-avatar ai-avatar">🌸</div>
      )}
      <div className="msg-col">
        <div className="msg-name">
          {isUser ? 'Kamu' : personaName}
        </div>
        <div className={`bubble ${isUser ? 'user' : 'ai'}`}>
          <div className="md-preview"
            dangerouslySetInnerHTML={{ __html: html }} />
          {!isUser && (
            <div className="bubble-actions">
              <button
                className={`copy-btn ${copiedIdx === index ? 'copied' : ''}`}
                onClick={() => onCopy(msg.content, index)}
                title="Salin respons"
              >
                <i className={`ti ${copiedIdx === index ? 'ti-check' : 'ti-copy'}`} />
                {copiedIdx === index ? 'Tersalin!' : 'Salin'}
              </button>
            </div>
          )}
        </div>
      </div>
      {isUser && (
        <div className="msg-avatar user-avatar">
          <i className="ti ti-user" />
        </div>
      )}
    </div>
  )
})

function StreamingBubble({ text, status, detail, personaName }: {
  text: string; status: AIStatus; detail: string; personaName: string
}) {
  // [Perf sesi panjang] renderMarkdown() mem-parse ULANG SELURUH teks
  // terakumulasi pada setiap update — O(n) per token, O(n²) totalnya untuk
  // satu jawaban panjang. useDeferredValue membiarkan React menjatuhkan
  // parse yang sudah usang saat token baru datang lebih cepat dari React
  // sempat mem-parse & commit yang sebelumnya, alih-alih memaksa render tiap
  // satu commit streamingText memicu satu parse penuh.
  const deferredText = useDeferredValue(text)
  return (
    <div className="msg-row ai">
      <div className="msg-avatar ai-avatar streaming">🌸</div>
      <div className="msg-col">
        <div className="msg-name">
          {personaName}
          <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
        </div>
        <div className="bubble ai">
          {status !== 'streaming' && status !== 'idle' && (
            <div className="status-line">
              <i className="ti ti-loader-2 spin" />
              {detail || getStatusLabel(status)}
            </div>
          )}
          {/* Selagi menunggu token pertama, tampilkan rangka berkilau —
              lebih informatif daripada bubble kosong yang diam. */}
          {!deferredText && status !== 'error' && (
            <div className="stream-skeleton" aria-hidden="true">
              <span className="skeleton-line" />
              <span className="skeleton-line" />
              <span className="skeleton-line" />
            </div>
          )}
          {deferredText && (
            <div className="md-preview"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(deferredText) }} />
          )}
          {status === 'streaming' && <span className="stream-caret" aria-hidden="true" />}
        </div>
      </div>
    </div>
  )
}

function getStatusLabel(status: AIStatus): string {
  const map: Record<AIStatus, string> = {
    idle: '', chunking: 'Memecah dokumen...', selecting: 'Memilih konteks...',
    sending: 'Mengirim...', streaming: 'Generating...', error: 'Error',
  }
  return map[status] || status
}
