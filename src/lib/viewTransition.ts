import { flushSync } from 'react-dom'

/**
 * Pembungkus tipis di atas View Transitions API (Chromium 111+; Electron 30
 * memakai Chromium 124, jadi tersedia — feature-guard tetap dipasang untuk
 * jaga-jaga dan untuk lingkungan test).
 *
 * Aturan animasinya sendiri ada di src/styles/motion.css.
 */

type ViewTransition = { finished: Promise<void>; ready: Promise<void> }
type DocumentWithVT = Document & {
  startViewTransition?: (cb: () => void) => ViewTransition
}

export type TransitionOptions = {
  /** Kelas sementara di <html> supaya motion.css bisa memilih varian animasi. */
  variant?: string
  /** Titik asal sapuan melingkar, dipakai varian ganti tema. */
  origin?: { x: number; y: number }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function withViewTransition(update: () => void, opts: TransitionOptions = {}): void {
  const doc = document as DocumentWithVT
  const root = document.documentElement

  // Tanpa dukungan API atau saat user minta gerak dikurangi: ubah langsung.
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    update()
    return
  }

  if (opts.origin) {
    const { x, y } = opts.origin
    // Radius terjauh dari titik asal ke salah satu sudut layar, supaya
    // sapuannya selalu menutup seluruh viewport.
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    root.style.setProperty('--vt-x', `${x}px`)
    root.style.setProperty('--vt-y', `${y}px`)
    root.style.setProperty('--vt-r', `${r}px`)
  }

  if (opts.variant) root.classList.add(opts.variant)

  const cleanup = () => {
    if (opts.variant) root.classList.remove(opts.variant)
    if (opts.origin) {
      root.style.removeProperty('--vt-x')
      root.style.removeProperty('--vt-y')
      root.style.removeProperty('--vt-r')
    }
  }

  let transition: ViewTransition
  try {
    // flushSync wajib: startViewTransition memotret DOM tepat setelah callback
    // selesai, sedangkan update state React 18 defaultnya ditunda.
    transition = doc.startViewTransition(() => flushSync(update))
  } catch {
    update()
    cleanup()
    return
  }

  // `finished` menolak kalau transisi dilewati — itu bukan kondisi error di sini.
  transition.finished.then(cleanup, cleanup)
}
