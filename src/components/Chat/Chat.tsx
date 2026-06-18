import React, { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useStore, type AIStatus } from '../../store/useStore'
import type { ChatMessage } from '../../types'
import './Chat.css'

// Configure marked for synchronous use
marked.setOptions({ breaks: true, gfm: true, async: false } as any)

// (configured above at module level)

// Sanitize markdown HTML to prevent XSS (critical in Electron context)
function renderMarkdown(content: string): string {
  const rawHtml = marked.parse(content || '', { async: false }) as string
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
  const {
    settings, messages, sendMessage, clearMessages,
    streamingText, aiStatus, aiStatusDetail, cancelStream,
    doc,
  } = useStore()

  const [input, setInput]               = useState('')
  const [useContext, setUseContext]      = useState(embedded)  // embedded mode defaults to true
  const [useWebSearch, setWebSearch]    = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [fileContext, setFileContext]   = useState<{ title: string; content: string } | null>(null)

  const bottomRef    = useRef<HTMLDivElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const messagesRef  = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [copiedIdx, setCopiedIdx]         = useState<number | null>(null)

  const isProcessing = aiStatus !== 'idle' && aiStatus !== 'error'

  // Konteks aktif
  const activeContext = useContext
    ? (doc ? { title: doc.title, content: doc.content } : fileContext)
    : null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingText])

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
    if (aiStatus === 'idle') setTimeout(() => textareaRef.current?.focus(), 50)
  }, [aiStatus])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [input])

  const handlePickContextFile = async () => {
    const result = await window.api.file.openAsContext()
    if (result) {
      setFileContext({ title: result.title, content: result.content })
      setUseContext(true)
    }
  }

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isProcessing) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    textareaRef.current?.focus()
    await sendMessage(text, useContext, useWebSearch, useContext && !doc ? fileContext : null)
  }, [input, isProcessing, useContext, useWebSearch, sendMessage, doc, fileContext])

  const handleCopy = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    })
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
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom */}
      {showScrollBtn && (
        <button
          className="scroll-bottom-btn"
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
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
            style={{ opacity: 0.5, cursor: 'not-allowed' }}
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
            <button key={i} className="suggestion-chip" onClick={() => onSuggestion(s)}>
              <i className="ti ti-sparkles" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBubble({ msg, personaName, index, copiedIdx, onCopy }: {
  msg: ChatMessage; personaName: string; index: number;
  copiedIdx: number | null; onCopy: (text: string, idx: number) => void;
}) {
  const isUser = msg.role === 'user'
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
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
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
}

function StreamingBubble({ text, status, detail, personaName }: {
  text: string; status: AIStatus; detail: string; personaName: string
}) {
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
          {text && (
            <div className="md-preview"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
          )}
          {status === 'streaming' && <span className="cursor-blink">▋</span>}
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
