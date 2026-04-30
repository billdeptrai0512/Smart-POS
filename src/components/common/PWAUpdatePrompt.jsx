import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PWAUpdatePrompt() {
    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_swUrl, r) {
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
                <div className="pwa-update-header">
                    <span className="pwa-update-text">Đã có phiên bản mới !</span>
                </div>
                {/* <div className="pwa-update-log">
                    {updateLog}
                </div> */}
                <div className="pwa-update-actions">
                    {/* <button
                        className="pwa-dismiss-btn"
                        onClick={() => setNeedRefresh(false)}
                    >
                        Để sau
                    </button> */}
                    <button
                        className="pwa-update-btn"
                        onClick={() => updateServiceWorker(true)}
                    >
                        Cập nhật
                    </button>
                </div>
            </div>
        </div>
    )
}
