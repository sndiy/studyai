import React from 'react'
import ReactDOM from 'react-dom/client'

// Urutan import CSS = urutan cascade. Wajib berada SEBELUM import App, karena
// App menarik masuk CSS tiap komponen; kalau dibalik, style komponen justru
// dimuat lebih dulu dan global.css malah menimpanya.
import './assets/tabler-icons.min.css'
import './styles/tokens.css'
import './styles/motion.css'
import './styles/global.css'
import './styles/prose.css'

import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
