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
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
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
      minify: 'esbuild',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: 'src',
    // Hanya woff2 — satu-satunya format font yang benar-benar dikirim (lihat
    // src/assets/icons.css, hasil scripts/gen-icons.mjs).
    assetsInclude: ['**/*.woff2'],
    build: {
      minify: 'esbuild',
      // Font ikon subset (~7.5 KB) lolos batas ini dan jadi data: URI inline —
      // font-src 'self' data: di CSP sudah mengizinkannya. Menghilangkan satu
      // request/disk-read terpisah dari jalur render pertama.
      assetsInlineLimit: 12000,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') },
        output: {
          // Editor/Chat/Settings/CommandPaletteInner sekarang dimuat lewat
          // import() dinamis (App.tsx), jadi Rollup SUDAH memisahkannya dari
          // chunk utama secara otomatis. Tugas manualChunks di sini murni
          // memastikan vendor besar yang mereka pakai bersama (Tiptap+
          // ProseMirror, marked/turndown/dompurify) mendarat di chunk vendor
          // sendiri alih-alih terduplikasi di beberapa chunk lazy yang
          // sama-sama mengimpornya.
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (/[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/.test(id)) return 'react'
            if (/[\\/](@tiptap|prosemirror-|orderedmap|rope-sequence|w3c-keyname|linkifyjs|@floating-ui|fast-equals)[\\/]/.test(id)) return 'editor-engine'
            if (/[\\/](marked|turndown|turndown-plugin-gfm|@mixmark-io|dompurify)[\\/]/.test(id)) return 'markdown'
          },
        },
      }
    },
    plugins: [react(), cspPlugin()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
    }
  }
})
