import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PWAUpdatePrompt() {
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(swUrl, r) {
            // Check for updates every 30 minutes
            if (r) {
                setInterval(() => {
                    r.update()
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
                <span className="pwa-update-icon">🔄</span>
                <span className="pwa-update-text">Cập nhật phiên bản mới nhất nhé !</span>
                <button
                    className="pwa-update-btn"
                    onClick={() => updateServiceWorker(true)}
                >
                    Cập nhật
                </button>
                <button
                    className="pwa-dismiss-btn"
                    onClick={() => setNeedRefresh(false)}
                    aria-label="Đóng"
                >
                    ✕
                </button>
            </div>
        </div>
    )
}
