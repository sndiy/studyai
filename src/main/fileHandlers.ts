import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'

function nowStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function genId(): string {
  return `imp_${Date.now()}_${Math.random().toString(36).slice(2,9)}`
}

export function setupFileHandlers() {

  // ── Import single file (untuk tombol Import di Editor) ───────────────────
  ipcMain.handle('file:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Dokumen',
      filters: [
        { name: 'Dokumen', extensions: ['pdf','docx','doc','txt','md'] },
        { name: 'PDF',  extensions: ['pdf'] },
        { name: 'Word', extensions: ['docx','doc'] },
        { name: 'Text', extensions: ['txt','md'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const ext = path.extname(filePath).toLowerCase()
    const fileName = path.basename(filePath, ext)
    try {
      let content = ''
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse')
        const buffer = fs.readFileSync(filePath)
        const data = await pdfParse(buffer)
        content = data.text
      } else if (ext === '.docx' || ext === '.doc') {
        const mammoth = require('mammoth')
        const res = await mammoth.extractRawText({ path: filePath })
        content = res.value
      } else {
        content = fs.readFileSync(filePath, 'utf-8')
      }
      content = content.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\n{3,}/g,'\n\n').trim()
      return { title: fileName, content, source_file: path.basename(filePath), word_count: content.split(/\s+/).filter(Boolean).length }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // ── Export single note as TXT ─────────────────────────────────────────────
  ipcMain.handle('file:export:txt', async (_: any, note: { title: string; content: string }) => {
    const result = await dialog.showSaveDialog({
      title: 'Export sebagai TXT',
      defaultPath: `${note.title}.txt`,
      filters: [{ name: 'Text File', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try { fs.writeFileSync(result.filePath!, note.content, 'utf-8'); return { success: true } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  // ── Export single note as MD ──────────────────────────────────────────────
  ipcMain.handle('file:export:md', async (_: any, note: { title: string; content: string }) => {
    const result = await dialog.showSaveDialog({
      title: 'Export sebagai Markdown',
      defaultPath: `${note.title}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      fs.writeFileSync(result.filePath!, `# ${note.title}\n\n${note.content}`, 'utf-8')
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  // ── Bulk Export: JSON backup ──────────────────────────────────────────────
  ipcMain.handle('file:export:json', async (_: any, notes: any[], version: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Backup JSON',
      defaultPath: 'StudyAI_Backup.json',
      filters: [{ name: 'JSON Backup', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      const backup = { version, exported_at: nowStr(), total: notes.length, notes }
      fs.writeFileSync(result.filePath!, JSON.stringify(backup, null, 2), 'utf-8')
      return { success: true, count: notes.length }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  // ── Bulk Export: Markdown single file ────────────────────────────────────
  ipcMain.handle('file:export:md:single', async (_: any, notes: any[]) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Semua Rangkuman ke Markdown',
      defaultPath: 'StudyAI_Rangkuman.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      let out = `# StudyAI — Kumpulan Rangkuman\n*Export: ${nowStr()} | ${notes.length} materi*\n\n---\n\n`
      for (const n of notes) {
        out += `## ${n.title}\n**Kategori:** ${n.category || 'Umum'}  | **Dibuat:** ${n.created_at || ''}  | **Update:** ${n.updated_at || ''}\n\n${n.content || ''}\n\n---\n\n`
      }
      fs.writeFileSync(result.filePath!, out, 'utf-8')
      return { success: true, count: notes.length }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  // ── Bulk Export: Markdown per folder ─────────────────────────────────────
  ipcMain.handle('file:export:md:folder', async (_: any, notes: any[]) => {
    const result = await dialog.showOpenDialog({
      title: 'Pilih folder untuk file .md',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false }
    const folder = result.filePaths[0]
    try {
      let count = 0
      for (const n of notes) {
        let safe = (n.title || 'rangkuman').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60).trim() || 'rangkuman'
        let fpath = path.join(folder, `${safe}.md`)
        let i = 1
        while (fs.existsSync(fpath)) { fpath = path.join(folder, `${safe}_${i++}.md`) }
        const md = `# ${n.title}\n\n**Kategori:** ${n.category || 'Umum'}  |  **Dibuat:** ${n.created_at || ''}  |  **Update:** ${n.updated_at || ''}\n\n---\n\n${n.content || ''}`
        fs.writeFileSync(fpath, md, 'utf-8')
        count++
      }
      return { success: true, count, folder }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  // ── Bulk Export: TXT ──────────────────────────────────────────────────────
  ipcMain.handle('file:export:txt:bulk', async (_: any, notes: any[]) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Semua Rangkuman ke TXT',
      defaultPath: 'StudyAI_Export.txt',
      filters: [{ name: 'Text', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      let out = `StudyAI Export — ${nowStr()} — ${notes.length} rangkuman\n${'='.repeat(60)}\n\n`
      for (const n of notes) {
        out += `[${n.category || 'Umum'}] ${n.title}\nDibuat: ${n.created_at || ''}  |  Update: ${n.updated_at || ''}\n${'-'.repeat(40)}\n${n.content || ''}\n\n${'='.repeat(60)}\n\n`
      }
      fs.writeFileSync(result.filePath!, out, 'utf-8')
      return { success: true, count: notes.length }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  // ── Bulk Import: JSON backup ──────────────────────────────────────────────
  ipcMain.handle('file:import:json', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Pilih file JSON backup StudyAI',
      filters: [{ name: 'JSON Backup', extensions: ['json'] }, { name: 'Semua file', extensions: ['*'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
      const data = JSON.parse(raw)
      const notes = Array.isArray(data) ? data : (data.notes || [])
      const cleaned = notes.map((n: any) => ({ ...n, id: n.id || genId() }))
      return { notes: cleaned }
    } catch (err: any) { return { error: err.message } }
  })

  // ── Bulk Import: Markdown files ───────────────────────────────────────────
  ipcMain.handle('file:import:md', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Pilih file .md (bisa multi-select)',
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Semua file', extensions: ['*'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const notes: any[] = []
    for (const fp of result.filePaths) {
      try {
        const content = fs.readFileSync(fp, 'utf-8')
        notes.push(...parseMd(content, fp))
      } catch {}
    }
    return { notes }
  })

  // ── Bulk Import: TXT files ────────────────────────────────────────────────
  ipcMain.handle('file:import:txt', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Pilih file TXT',
      filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'Semua file', extensions: ['*'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const notes: any[] = []
    for (const fp of result.filePaths) {
      try {
        const content = fs.readFileSync(fp, 'utf-8')
        notes.push(...parseTxt(content, fp))
      } catch {}
    }
    return { notes }
  })
}

function parseMd(content: string, filePath: string): any[] {
  const now = nowStr()
  const sections = content.split(/(?m)^## /)
  const notes: any[] = []
  if (sections.length > 1) {
    for (const sec of sections.slice(1)) {
      const lines = sec.trim().split('\n')
      const title = lines[0].trim()
      const catMatch = sec.match(/\*\*Kategori:\*\*\s*([^|\n]+)/)
      const cat = catMatch ? catMatch[1].trim() : 'Import'
      const body = lines.slice(1).filter((l: string) => !/^\*\*(Kategori|Dibuat|Update):/.test(l) && l.trim() !== '---').join('\n').trim()
      notes.push({ id: genId(), title, category: cat, content: body, created_at: now, updated_at: now })
    }
  } else {
    const name = path.basename(filePath, path.extname(filePath))
    notes.push({ id: genId(), title: name, category: 'Import', content: content.trim(), created_at: now, updated_at: now })
  }
  return notes
}

function parseTxt(content: string, filePath: string): any[] {
  const now = nowStr()
  const blocks = content.split(/={10,}/)
  const notes: any[] = []
  let parsed = false
  for (const block of blocks) {
    const b = block.trim()
    if (!b) continue
    const lines = b.split('\n')
    const m = lines[0] ? lines[0].trim().match(/^\[(.+?)\]\s*(.+)/) : null
    if (m) {
      const start = lines.length > 1 && lines[1].startsWith('Dibuat:') ? 3 : 1
      const body = lines.slice(start).join('\n').replace(/^-{10,}$/m, '').trim()
      notes.push({ id: genId(), title: m[2], category: m[1], content: body, created_at: now, updated_at: now })
      parsed = true
    }
  }
  if (!parsed) {
    const name = path.basename(filePath, path.extname(filePath))
    notes.push({ id: genId(), title: name, category: 'Import', content: content.trim(), created_at: now, updated_at: now })
  }
  return notes
}
