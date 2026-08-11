import React, { lazy, Suspense } from 'react'
import { useStore } from '../../store/useStore'

// Implementasi sebenarnya (hook, useMemo daftar command, langganan store
// penuh) dipisah ke CommandPaletteInner — lazy-loaded, dan hanya di-mount
// selagi command palette benar-benar terbuka. Sebelum ini, komponen (tanpa
// selector) berlangganan ke SELURUH store dan tetap mount terus meski
// tertutup, jadi ikut re-render pada setiap ketukan editor / token AI.
const CommandPaletteInner = lazy(() => import('./CommandPaletteInner'))

export default function CommandPalette() {
  const open = useStore(s => s.paletteOpen)   // SATU langganan boolean
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <CommandPaletteInner />
    </Suspense>
  )
}
