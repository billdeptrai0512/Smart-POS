// Tab/SW cũ giữ index trỏ tới chunk có hash đã bị deploy mới xoá → Vercel rewrite /assets/x.js về
// index.html → trình duyệt báo "'text/html' is not a valid JavaScript MIME type" (Chrome) /
// "Failed to fetch dynamically imported module" / "Importing a module script failed" (Safari).
// Cách chữa duy nhất là tải lại bản mới.
const STALE_CHUNK_RE = /MIME type|dynamically imported module|Importing a module script failed/i
const RELOAD_KEY = 'staleChunkReloadAt'
const RELOAD_COOLDOWN_MS = 30_000

export const isStaleChunkError = (error) => STALE_CHUNK_RE.test(error?.message || '')

// Gỡ SW cũ trước khi reload — không thì nó vẫn phát index.html precache cũ và lỗi lặp lại.
// Cooldown chặn vòng lặp reload nếu server thật sự hỏng. Trả về false khi không reload.
export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch { /* sessionStorage bị chặn: reload 1 lần rồi để ErrorBoundary hiện lỗi nếu còn */ }
  const reload = () => window.location.reload()
  if (!navigator.serviceWorker) reload()
  else {
    navigator.serviceWorker.getRegistrations()
      .then(regs => Promise.all(regs.map(r => r.unregister())))
      .then(reload, reload)
  }
  return true
}
