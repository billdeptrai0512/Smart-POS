import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PWAUpdatePrompt() {
    const [updating, setUpdating] = useState(false)
    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_swUrl, r) {
            // Check for updates every 30 minutes
            if (r) {
                setInterval(() => {
                    // ponytail: nuốt lỗi mạng lúc check update, tránh unhandled rejection bắn noise lên Sentry
                    r.update().catch(() => {})
                }, 30 * 60 * 1000)
            }
        },
        onRegisterError(error) {
            console.error('SW registration error:', error)
        },
    })

    if (!needRefresh) return null

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
                        onClick={() => { setUpdating(true); updateServiceWorker(true) }}
                    >
                        {updating ? 'Đang cập nhật…' : 'Cập nhật'}
                    </button>
                </div>
            </div>
        </div>
    )
}
