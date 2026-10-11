import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { hasNewVersion, reloadForNewVersion } from '../../utils/staleChunk'

export default function PWAUpdatePrompt() {
    const [updating, setUpdating] = useState(false)
    const [stale, setStale] = useState(false)
    useRegisterSW({
        // autoUpdate: SW mới tự skipWaiting + claim, plugin mặc định reload ngay giữa phiên → mất giỏ
        // hàng chưa gửi. Chỉ báo banner, để nhân viên tự bấm lúc rảnh.
        onNeedReload: () => setStale(true),
        onRegisterError(error) {
            console.error('SW registration error:', error)
        },
    })

    useEffect(() => {
        const check = () => {
            navigator.serviceWorker?.getRegistration().then(r => r?.update()).catch(() => {}) // ponytail: nuốt lỗi mạng, tránh unhandled rejection bắn noise lên Sentry
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

    if (!stale) return null

    return (
        <div className="pwa-update-banner">
            <div className="pwa-update-content">
                <span className="pwa-update-text">Đã có phiên bản mới !</span>
                {/* reloadForNewVersion false = đang cooldown, không reload → trả nút về bấm lại được */}
                <button
                    className="pwa-update-btn"
                    disabled={updating}
                    onClick={() => setUpdating(reloadForNewVersion())}
                >
                    {updating ? 'Đang cập nhật…' : 'Cập nhật'}
                </button>
            </div>
        </div>
    )
}
