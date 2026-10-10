import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { hasNewVersion, reloadForNewVersion } from '../../utils/staleChunk'

export default function PWAUpdatePrompt() {
    const [updating, setUpdating] = useState(false)
    const [stale, setStale] = useState(false)
    const swReg = useRef<ServiceWorkerRegistration | undefined>(undefined)
    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_swUrl, r) { swReg.current = r },
        onRegisterError(error) {
            console.error('SW registration error:', error)
        },
    })

    useEffect(() => {
        const check = () => {
            swReg.current?.update().catch(() => {}) // ponytail: nuốt lỗi mạng, tránh unhandled rejection bắn noise lên Sentry
            // Chạy cả khi không có SW (webview Zalo/FB) — SW là đường duy nhất thì máy đó không bao giờ biết có bản mới.
            hasNewVersion().then(v => v && setStale(true))
        }
        const id = setInterval(check, 30 * 60 * 1000)
        // setInterval bị iOS Safari treo khi PWA standalone chạy nền — app đóng
        // lâu rồi mở lại (không phải cold-start) sẽ không bao giờ chạm interval.
        // Bù bằng cách check lại mỗi lần app quay lại foreground.
        const onVisible = () => { if (document.visibilityState === 'visible') check() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            clearInterval(id)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [])

    if (!needRefresh && !stale) return null

    const update = () => {
        setUpdating(true)
        if (needRefresh) updateServiceWorker(true)
        // `controlling` có thể không bắn (SW chờ bị deploy mới thay / trình duyệt di động hủy) →
        // nút kẹt "Đang cập nhật…" mãi. Quá 3s mà chưa tự reload thì reload tay.
        setTimeout(reloadForNewVersion, needRefresh ? 3000 : 0)
    }

    return (
        <div className="pwa-update-banner">
            <div className="pwa-update-content">
                <div className="pwa-update-header">
                    <span className="pwa-update-text">Đã có phiên bản mới !</span>
                </div>
                <div className="pwa-update-actions">
                    <button
                        className="pwa-update-btn"
                        disabled={updating}
                        onClick={update}
                    >
                        {updating ? 'Đang cập nhật…' : 'Cập nhật'}
                    </button>
                </div>
            </div>
        </div>
    )
}
