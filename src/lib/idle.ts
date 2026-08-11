/**
 * Jadwalkan kerja non-visual (fetch model AI, verified limits) untuk jalan
 * saat browser benar-benar idle, bukan langsung di frame pertama setelah
 * mount — supaya tidak ikut menyaingi main thread/IPC channel saat render
 * pertama.
 */
export function whenIdle(cb: () => void, timeoutMs = 3000): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => cb(), { timeout: timeoutMs })
  } else {
    setTimeout(cb, 300)
  }
}
