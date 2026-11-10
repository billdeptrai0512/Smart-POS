import { useEffect } from 'react'

// Giữ màn hình sáng khi app ở foreground. Trình duyệt tự nhả lock khi tab bị ẩn
// → xin lại khi tab hiện lại. Trình duyệt không hỗ trợ / bị từ chối thì bỏ qua.
export default function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return
      try { lock = await navigator.wakeLock.request('screen') } catch { /* pin yếu / bị chặn */ }
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      document.removeEventListener('visibilitychange', acquire)
      lock?.release().catch(() => {})
    }
  }, [])
}
