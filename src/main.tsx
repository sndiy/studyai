import React from 'react'
import ReactDOM from 'react-dom/client'

// Urutan import CSS = urutan cascade. Wajib berada SEBELUM import App, karena
// App menarik masuk CSS tiap komponen; kalau dibalik, style komponen justru
// dimuat lebih dulu dan global.css malah menimpanya.
import './assets/icons.css'
import './styles/tokens.css'
import './styles/motion.css'
import './styles/global.css'
import './styles/prose.css'

import App from './App'

// StrictMode cuma dipakai saat dev — di produksi ia me-render dan menjalankan
// effect dua kali (termasuk boot ProseMirror EditorView Tiptap), yang di build
// produksi cuma menambah kerja start tanpa manfaat deteksi bug.
const tree = <App />
ReactDOM.createRoot(document.getElementById('root')!).render(
  import.meta.env.DEV ? <React.StrictMode>{tree}</React.StrictMode> : tree
)

// [Perf] Diaktifkan lewat STUDYAI_PERF=1 di main — kalau tidak, console.log ini
// tidak berbahaya (cuma satu baris tambahan), tapi tetap dijaga di balik cek env
// via window.api supaya build produksi normal tidak dapat overhead sama sekali.
if (window.api.perf) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const boot = performance.getEntriesByName('boot')[0]?.startTime ?? 0
    console.log(`[perf] renderer-paint ${Math.round(performance.now() - boot)}`)
  }))
}

// Editor dimuat lewat React.lazy (App.tsx) supaya tidak ikut memberatkan
// bundle awal, tapi 'editor' adalah currentView default — begitu dua frame
// pertama selesai dicat, mulai unduh chunk-nya di latar belakang supaya saat
// React benar-benar merender <Editor/>, chunk-nya sudah/hampir siap.
requestAnimationFrame(() => requestAnimationFrame(() => {
  void import('./components/Editor/Editor')
}))
