import { withViewTransition } from './viewTransition'

export type Theme = 'light' | 'dark'

/**
 * Ganti tema dengan sapuan melingkar dari titik klik (aturan animasinya di
 * styles/motion.css, varian `vt-theme`).
 *
 * Atribut di <html> disetel langsung di dalam callback transisi supaya
 * pergantiannya ikut terpotret — menunggu efek React akan datang terlambat.
 * App.tsx nanti menyetel nilai yang sama sekali lagi saat settings tersimpan;
 * operasinya idempoten, jadi tidak ada kedipan.
 *
 * Persistensinya BUKAN urusan fungsi ini — pemanggil yang memanggil
 * updateSetting('theme', …).
 */
export function revealTheme(next: Theme, origin?: { x: number; y: number }): void {
  withViewTransition(
    () => { document.documentElement.dataset.theme = next },
    {
      variant: 'vt-theme',
      origin: origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    },
  )
}
