import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { revealTheme } from '../../lib/theme'
import './CommandPalette.css'

type Command = {
  id:    string
  label: string
  group: string
  icon:  string
  hint?: string
  run:   () => void
}

const MAX_RECENT = 6

export default function CommandPalette() {
  const {
    paletteOpen, setPaletteOpen,
    setView, newDoc, openFile, saveDoc,
    recentFiles, openRecent,
    settings, updateSetting,
    sidebarCollapsed, toggleSidebar,
    messages, clearMessages,
  } = useStore()

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const commands = useMemo<Command[]>(() => {
    const nextTheme = settings?.theme === 'light' ? 'dark' : 'light'

    const base: Command[] = [
      { id: 'view-editor',   group: 'Navigasi', icon: 'ti-edit',       label: 'Buka Editor',      run: () => setView('editor') },
      { id: 'view-ai',       group: 'Navigasi', icon: 'ti-sparkles',   label: 'Buka Tanya AI',    run: () => setView('ai') },
      { id: 'view-settings', group: 'Navigasi', icon: 'ti-settings',   label: 'Buka Pengaturan',  run: () => setView('settings') },

      // Hanya Ctrl+S yang punya hint: itu satu-satunya shortcut yang benar-benar
      // terpasang (Editor.tsx). Jangan menjanjikan shortcut yang tidak ada.
      { id: 'file-new',  group: 'File', icon: 'ti-file-plus',     label: 'File baru',   run: newDoc },
      { id: 'file-open', group: 'File', icon: 'ti-folder-open',   label: 'Buka file',   run: openFile },
      { id: 'file-save', group: 'File', icon: 'ti-device-floppy', label: 'Simpan file', hint: 'Ctrl+S', run: () => { void saveDoc() } },

      {
        id: 'theme-toggle', group: 'Tampilan',
        icon: nextTheme === 'dark' ? 'ti-moon' : 'ti-sun',
        label: nextTheme === 'dark' ? 'Ganti ke tema gelap' : 'Ganti ke tema terang',
        run: () => {
          revealTheme(nextTheme)
          void updateSetting('theme', nextTheme)
        },
      },
      {
        id: 'sidebar-toggle', group: 'Tampilan',
        icon: sidebarCollapsed ? 'ti-layout-sidebar-right-collapse' : 'ti-layout-sidebar-left-collapse',
        label: sidebarCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar',
        run: toggleSidebar,
      },
    ]

    if (messages.length > 0) {
      base.push({
        id: 'chat-clear', group: 'Chat', icon: 'ti-eraser',
        label: `Bersihkan chat (${messages.length} pesan)`,
        run: clearMessages,
      })
    }

    for (const f of recentFiles.slice(0, MAX_RECENT)) {
      base.push({
        id: `recent:${f.path}`,
        group: 'Terakhir Dibuka',
        icon: 'ti-file-text',
        label: f.title || 'Tanpa Judul',
        hint: f.path.split(/[\\/]/).pop(),
        run: () => { void openRecent(f.path, f.title) },
      })
    }

    return base
  }, [
    settings?.theme, sidebarCollapsed, recentFiles, messages.length,
    setView, newDoc, openFile, saveDoc, openRecent, updateSetting, toggleSidebar, clearMessages,
  ])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      (c.hint?.toLowerCase().includes(q) ?? false),
    )
  }, [commands, query])

  // Reset tiap kali dibuka, dan kembalikan fokus ke elemen asal saat ditutup.
  useEffect(() => {
    if (!paletteOpen) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    setQuery('')
    setActive(0)
    inputRef.current?.focus()
    return () => restoreFocusRef.current?.focus?.()
  }, [paletteOpen])

  // Jaga indeks aktif tetap valid saat hasil menyusut karena diketik
  useEffect(() => { setActive(a => Math.min(a, Math.max(0, results.length - 1))) }, [results.length])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!paletteOpen) return null

  const close = () => setPaletteOpen(false)

  const runAt = (i: number) => {
    const cmd = results[i]
    if (!cmd) return
    close()
    cmd.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':    e.preventDefault(); close(); break
      case 'ArrowDown': e.preventDefault(); setActive(a => (a + 1) % Math.max(1, results.length)); break
      case 'ArrowUp':   e.preventDefault(); setActive(a => (a - 1 + results.length) % Math.max(1, results.length)); break
      case 'Enter':     e.preventDefault(); runAt(active); break
      // Hanya ada satu kontrol fokusable di dalam kartu, jadi jebakan fokusnya
      // cukup dengan menahan Tab.
      case 'Tab':       e.preventDefault(); break
    }
  }

  let lastGroup = ''

  return (
    <div className="cmdk-overlay" onMouseDown={close} role="presentation">
      <div
        className="cmdk-card"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-search">
          <i className="ti ti-search" />
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0) }}
            placeholder="Cari perintah atau file..."
            aria-label="Cari perintah"
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>

        <div className="cmdk-list" ref={listRef} role="listbox" aria-label="Hasil">
          {results.length === 0 && (
            <div className="cmdk-empty">
              <i className="ti ti-mood-empty" /> Tidak ada yang cocok
            </div>
          )}

          {results.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup
            lastGroup = cmd.group
            return (
              <React.Fragment key={cmd.id}>
                {showGroup && <div className="cmdk-group">{cmd.group}</div>}
                <div
                  className="cmdk-item"
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  style={{ '--i': i } as React.CSSProperties}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runAt(i)}
                >
                  <i className={`ti ${cmd.icon}`} />
                  <span className="cmdk-label">{cmd.label}</span>
                  {cmd.hint && <span className="cmdk-hint">{cmd.hint}</span>}
                </div>
              </React.Fragment>
            )
          })}
        </div>

        <div className="cmdk-footer">
          <span><kbd className="cmdk-kbd">↑</kbd><kbd className="cmdk-kbd">↓</kbd> pilih</span>
          <span><kbd className="cmdk-kbd">↵</kbd> jalankan</span>
          <span className="cmdk-count">{results.length} perintah</span>
        </div>
      </div>
    </div>
  )
}
