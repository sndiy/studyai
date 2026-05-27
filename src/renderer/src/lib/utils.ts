export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  if (hours < 24) return `${hours} jam lalu`
  if (days === 1) return 'kemarin'
  if (days < 7) return `${days} hari lalu`
  if (days < 30) return `${Math.floor(days / 7)} minggu lalu`
  return `${Math.floor(days / 30)} bulan lalu`
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function countPages(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2000))
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric'
  })
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit'
  })
}

export function truncate(str: string, maxLen = 60): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

export function getCategoryColor(categories: { name: string; color: string }[], name: string): string {
  return categories.find(c => c.name === name)?.color || '#6a6a8a'
}

export function calculateStreak(lastActiveDate: string): { streak: number; shouldReset: boolean } {
  if (!lastActiveDate) return { streak: 0, shouldReset: false }
  const last = new Date(lastActiveDate)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const isSameDay = last.toDateString() === today.toDateString()
  const isYesterday = last.toDateString() === yesterday.toDateString()

  return {
    streak: 0,
    shouldReset: !isSameDay && !isYesterday
  }
}
