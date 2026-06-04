import React, { useState, useEffect, useRef, useCallback } from 'react'
import { marked } from 'marked'
import { useStore, type AIStatus } from '../../store/useStore'
import type { ChatMessage } from '../../types'
import './Chat.css'

marked.setOptions({ breaks: true, gfm: true } as any)

export default function Chat({ noteId }: { noteId?: number | null }) {
  const {
    settings, messages, loadHistory, sendMessage, clearHistory,
    streamingText, aiStatus, aiStatusDetail, cancelStream,
    selectedNote
  } = useStore()

  const [input, setInput]               = useState('')
  const [useContext, setUseContext]     = useState(true)
  const [useWebSearch, setWebSearch]    = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  // Konteks dari file yang dipilih user (title + content, tidak masuk DB)
  const [fileContext, setFileContext]   = useState<{ title: string; content: string } | null>(null)

  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isFreeChat = noteId === null || noteId === undefined

  // Konteks yang aktif: free chat → dari file picker, editor chat → dari selectedNote
  const contextContent = useContext
    ? (isFreeChat ? fileContext?.content ?? null : selectedNote?.content ?? null)
    : null
  const contextTitle = useContext
    ? (isFreeChat ? fileContext?.title ?? null : selectedNote?.title ?? null)
    : null

  // [Fix] Tambah loadHistory ke dependency array
  useEffect(() => {
    loadHistory(isFreeChat ? null : (noteId ? String(noteId) : null))
  }, [noteId, loadHistory])

  // Reset fileContext saat pindah ke editor chat (non-free)
  useEffect(() => {
    if (!isFreeChat) setFileContext(null)
  }, [isFreeChat])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingText])

  useEffect(() => {
    if (aiStatus === 'idle') {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [aiStatus])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [input])



  const isProcessing = aiStatus !== 'idle' && aiStatus !== 'error'

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isProcessing) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    textareaRef.current?.focus()

    // Free chat: pakai fileContext sebagai konteks (inject langsung ke systemPrompt via store)
    // Editor chat: pakai noteId seperti biasa
    const sendNoteId = useContext && !isFreeChat && noteId ? String(noteId) : null
    await sendMessage(text, sendNoteId, useContext && !!contextContent, useWebSearch, null, isFreeChat ? fileContext : null)
  }, [input, isProcessing, noteId, useContext, useWebSearch, sendMessage, isFreeChat, fileContext, contextContent])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleToggleContext = async () => {
    const next = !useContext
    setUseContext(next)
    // Kalau aktifkan konteks di free chat dan belum ada file → langsung buka picker
    if (next && isFreeChat && !fileContext) {
      const result = await window.api.file.openAsContext()
      if (result) setFileContext({ title: result.title, content: result.content })
    }
  }

  const handlePickFile = async () => {
    const result = await window.api.file.openAsContext()
    if (result) {
      setFileContext({ title: result.title, content: result.content })
      setUseContext(true)
    }
  }

  const personaName = settings?.persona_name ?? 'Mai'

  const ctxLabel = useContext
    ? (contextTitle
        ? contextTitle.length > 20 ? contextTitle.slice(0, 20) + '…' : contextTitle
        : isFreeChat ? 'Pilih File…' : 'Tanpa Catatan')
    : 'Tanpa Konteks'

  return (
    <div className="chat-container">
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isProcessing && (
            <button className="btn-danger" onClick={cancelStream}>
              <i className="ti ti-player-stop" /> Stop
            </button>
          )}
          {confirmClear ? (
            <>
              <button
                className="btn-danger"
                onClick={async () => {
                  setConfirmClear(false)
                  await clearHistory(isFreeChat ? null : (noteId ? String(noteId) : null))
                  textareaRef.current?.focus()
                }}
              >
                <i className="ti ti-check" /> Yakin?
              </button>
              <button
                className="btn-secondary"
                onClick={() => { setConfirmClear(false); textareaRef.current?.focus() }}
              >
                Batal
              </button>
            </>
          ) : (
            <button className="btn-secondary" onClick={() => setConfirmClear(true)}>
              <i className="ti ti-trash" /> Bersihkan
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !streamingText && aiStatus === 'idle' && (
          <WelcomeScreen
            personaName={personaName}
            hasContext={useContext && !!contextContent}
            noteTitle={contextTitle ?? undefined}
            webSearch={useWebSearch}
            isFreeChat={isFreeChat}
            noContextFile={useContext && isFreeChat && !fileContext}
            onPickFile={handlePickFile}
          />
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} personaName={personaName} />
        ))}
        {(streamingText || isProcessing) && (
          <StreamingBubble
            text={streamingText}
            status={aiStatus}
            statusDetail={aiStatusDetail}
            personaName={personaName}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <div className="chat-controls">

          {/* Tombol Pakai Konteks — klik buka file picker (.md/.json/.txt) */}
          <button
            className={`ctx-toggle ${useContext ? 'on' : ''} ${useContext && !contextContent && isFreeChat ? 'ctx-warn' : ''}`}
            onClick={handleToggleContext}
            title={useContext ? 'Klik untuk nonaktifkan konteks' : 'Klik untuk pilih file konteks'}
          >
            <i className="ti ti-file-text" />
            {ctxLabel}
            {isFreeChat && fileContext && useContext && (
              <i
                className="ti ti-refresh"
                style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}
                onClick={e => { e.stopPropagation(); handlePickFile() }}
                title="Ganti file konteks"
              />
            )}
          </button>

          {/* Web Search toggle */}
          <button
            className={`ctx-toggle web-toggle ${useWebSearch ? 'on-web' : ''}`}
            onClick={() => setWebSearch(v => !v)}
            title="Aktifkan referensi pengetahuan ekstra dari AI"
          >
            <i className="ti ti-world" />
            {useWebSearch ? 'Web Aktif' : 'Web Off'}
          </button>

          <AIStatusBadge status={aiStatus} detail={aiStatusDetail} />
        </div>

        {useContext && contextTitle && (
          <div className="ctx-active-bar">
            <i className="ti ti-file-text" />
            <span>Konteks: <strong>{contextTitle}</strong></span>
            {isFreeChat && (
              <button className="ctx-active-change" onClick={handlePickFile} title="Ganti file">
                <i className="ti ti-pencil" /> Ganti
              </button>
            )}
          </div>
        )}

        {useContext && isFreeChat && !fileContext && (
          <div className="ctx-warn-bar">
            <i className="ti ti-alert-circle" />
            <span>Belum ada file dipilih sebagai konteks.</span>
            <button className="ctx-active-change" onClick={handlePickFile}>
              <i className="ti ti-folder-open" /> Pilih File
            </button>
          </div>
        )}

        <div className="chat-input-box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Tanya ${personaName}... (Enter kirim, Shift+Enter baris baru)`}
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

function WelcomeScreen({ personaName, hasContext, noteTitle, webSearch, isFreeChat, noContextFile, onPickFile }: {
  personaName: string
  hasContext: boolean
  noteTitle?: string
  webSearch: boolean
  isFreeChat: boolean
  noContextFile: boolean
  onPickFile: () => void
}) {
  return (
    <div className="chat-welcome">
      <div style={{ fontSize: 38, marginBottom: 8 }}>🌸</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        Halo! Aku {personaName}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', textAlign: 'center', maxWidth: 280, lineHeight: 1.65 }}>
        Tanya apa aja soal materi yang lagi kamu pelajari. Dokumen panjang akan dipecah otomatis.
      </div>
      {hasContext && noteTitle && (
        <div className="context-badge">
          <i className="ti ti-file-text" /> Konteks: {noteTitle}
        </div>
      )}
      {noContextFile && (
        <button
          className="context-badge"
          style={{ cursor: 'pointer', border: '0.5px dashed var(--border-sub)', background: 'transparent', marginTop: 8 }}
          onClick={onPickFile}
        >
          <i className="ti ti-folder-open" /> Pilih file konteks (.md / .json / .txt)
        </button>
      )}
      {webSearch && (
        <div className="context-badge" style={{ borderColor: '#1e3820', background: 'rgba(72,200,150,0.08)', color: 'var(--green)' }}>
          <i className="ti ti-world" style={{ color: 'var(--green)' }} /> Web Search aktif
        </div>
      )}
    </div>
  )
}

function MessageBubble({ msg, personaName }: { msg: ChatMessage; personaName: string }) {
  return (
    <div className={`chat-msg ${msg.role}`}>
      <div className="chat-name">
        <i className={`ti ${msg.role === 'user' ? 'ti-user' : 'ti-sparkles'}`} />
        {msg.role === 'user' ? 'Kamu' : personaName}
      </div>
      <div className={`chat-bubble ${msg.role}`}>
        <MarkdownContent content={msg.content} />
      </div>
    </div>
  )
}

function StreamingBubble({ text, status, statusDetail, personaName }: {
  text: string; status: AIStatus; statusDetail: string; personaName: string
}) {
  return (
    <div className="chat-msg assistant">
      <div className="chat-name">
        <i className="ti ti-sparkles" />
        {personaName}
        <span className="streaming-dot" />
      </div>
      <div className="chat-bubble assistant">
        {status !== 'streaming' && status !== 'idle' && (
          <div className="status-inline">
            <i className="ti ti-loader-2 spin" />
            {getStatusLabel(status, statusDetail)}
          </div>
        )}
        {text && <MarkdownContent content={text} />}
        {status === 'streaming' && <span className="cursor-blink">▋</span>}
      </div>
    </div>
  )
}

function AIStatusBadge({ status, detail }: { status: AIStatus; detail: string }) {
  if (status === 'idle') return null
  if (status === 'error') return (
    <span className="status-badge error">
      <i className="ti ti-alert-circle" /> {detail || 'Error'}
    </span>
  )
  return (
    <span className="status-badge processing">
      <i className="ti ti-loader-2 spin" />
      {getStatusLabel(status, detail)}
    </span>
  )
}

function getStatusLabel(status: AIStatus, detail: string): string {
  const base: Record<AIStatus, string> = {
    idle: '', chunking: 'Memecah dokumen...', selecting: 'Memilih konteks relevan...',
    sending: 'Mengirim ke AI...', streaming: 'Generating...', error: 'Error'
  }
  return detail || base[status] || status
}

function MarkdownContent({ content }: { content: string }) {
  const html = marked(content || '') as string
  return (
    <div
      className="msg-content md-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
