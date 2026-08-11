// src/lib/filePath.ts — satu sumber kebenaran untuk "apa ekstensi path ini".
//
// [Bug #7/#22] `electron/main.ts` sebelumnya punya DUA cara berbeda menghitung
// ekstensi (extname() di checkFilePath vs targetPath.split('.').pop() di
// file:save), dan Editor.tsx punya salinan ketiga — ketiganya bisa menyimpang
// untuk path yang punya titik di nama FOLDER (mis. /home/u/my.notes/draft.md).
//
// Renderer tidak punya akses ke modul 'path' Node (contextIsolation + tanpa
// nodeIntegration), jadi ini reimplementasi string murni — hanya melihat
// segmen terakhir path (basename), dan titik di posisi pertama nama file
// (dotfile, mis. ".gitignore") tidak dihitung sebagai ekstensi. Perilakunya
// disamakan dengan node:path extname() untuk semua kasus yang relevan di app ini.
export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}
