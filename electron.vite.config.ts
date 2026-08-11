import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin } from 'vite'

// [S6] Renderer sebelumnya jalan tanpa Content-Security-Policy sama sekali.
// CSP hanya disuntikkan untuk build produksi — di dev, Vite butuh websocket HMR
// dan inline script yang akan diblokir oleh policy ketat ini.
function cspPlugin(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",          // panggilan AI sudah pindah ke main process
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // Sengaja TIDAK memakai frame-ancestors — Chromium mengabaikannya kalau
    // dikirim lewat <meta>, jadi mencantumkannya hanya menghasilkan warning.
    // Perlindungan setara sudah didapat dari frame-src/object-src + tiadanya webview.
    "frame-src 'none'",
  ].join('; ')

  return {
    name: 'studyai-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [{
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        }],
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: 'src',
    assetsInclude: ['**/*.woff', '**/*.woff2', '**/*.ttf'],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') }
      }
    },
    plugins: [react(), cspPlugin()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
    }
  }
})
