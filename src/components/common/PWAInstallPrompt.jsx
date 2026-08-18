import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { STORAGE_KEYS } from '../../constants/storageKeys'
import { trackPwaShown, trackPwaInstalled } from '../../services/pwaInstallService'

// Synchronous, mount-only environment checks — computed as lazy initial state so
// they don't trigger an extra render via setState-in-effect.
const detectStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone || document.referrer.includes('android-app://')
const detectIOS = () =>
    (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export default function PWAInstallPrompt() {
    const { pathname } = useLocation()
    const [promptInstall, setPromptInstall] = useState(null)
    const [isStandalone] = useState(detectStandalone)
    const [isIOS] = useState(detectIOS)
    const [platform] = useState(() => (isIOS ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'other'))
    const shownTracked = useRef(false)
    // iOS has no beforeinstallprompt event, so decide its banner up front; Android
    // flips this on in the event handler below.
    const [showPrompt, setShowPrompt] = useState(
        () => !detectStandalone() && detectIOS() && !localStorage.getItem(STORAGE_KEYS.PWA_PROMPT_DISMISSED)
    )

    useEffect(() => {
        if (isStandalone) return // Already installed — nothing to offer.

        // Android/Chrome: offer the banner once the browser fires the install event.
        const handler = e => {
            e.preventDefault()
            setPromptInstall(e)
            setShowPrompt(true)
        }
        window.addEventListener('beforeinstallprompt', handler)
        return () => window.removeEventListener('beforeinstallprompt', handler)
    }, [isStandalone])

    // iOS không có sự kiện xác nhận cài đặt (không beforeinstallprompt/appinstalled) — nên track
    // "đã cài" bằng cách phát hiện app đang MỞ Ở CHẾ ĐỘ STANDALONE, đúng cho cả iOS lẫn Android
    // (Android cũng vào standalone sau khi cài, kể cả cài qua menu trình duyệt thay vì nút của ta).
    // Chạy ở MỌI trang, không chỉ /addresses — app có thể được mở lại từ bất kỳ đâu.
    useEffect(() => {
        if (!isStandalone || localStorage.getItem(STORAGE_KEYS.PWA_INSTALLED_TRACKED)) return
        localStorage.setItem(STORAGE_KEYS.PWA_INSTALLED_TRACKED, 'true')
        trackPwaInstalled(platform)
    }, [isStandalone, platform])

    const handleInstall = async () => {
        if (!promptInstall) {
            return
        }
        promptInstall.prompt()
        const { outcome } = await promptInstall.userChoice
        if (outcome === 'accepted') {
            setShowPrompt(false)
        }
    }

    const dismissPrompt = () => {
        setShowPrompt(false)
        localStorage.setItem(STORAGE_KEYS.PWA_PROMPT_DISMISSED, 'true')
    }

    // CHỈ hiện ở màn chọn địa chỉ (sau khi đã có tài khoản thật): ở /login thì thừa
    // vì lần đầu vào user nên dùng thử trước, ở /pos và các màn khác thì đè lên
    // hướng dẫn onboarding. Vẫn mount ở mọi trang (listener beforeinstallprompt ở
    // trên phải chạy sớm, event chỉ bắn 1 lần) — chỉ chặn ở khâu render.
    const visible = !isStandalone && showPrompt && pathname === '/addresses'

    useEffect(() => {
        if (!shownTracked.current && visible) {
            shownTracked.current = true
            trackPwaShown(platform)
        }
    }, [visible, platform])

    // Banner fixed-position đè lên đáy danh sách địa chỉ (xem .address-scroll-list trong
    // index.css) — bật class trên <body> để list đó tự chừa chỗ cuộn, khỏi bị che nút
    // "Mẫu mặc định" / "Bạn cần hỗ trợ".
    useEffect(() => {
        document.body.classList.toggle('pwa-banner-open', visible)
        return () => document.body.classList.remove('pwa-banner-open')
    }, [visible])

    if (!visible) {
        return null
    }

    return (
        <div className="pwa-install-banner toast-in">
            <div className="pwa-install-content">
                <div className="pwa-install-header">
                    <div className="flex items-center gap-3">
                        <img src="/icons/icon-192x192.png" alt="App Icon" className="w-10 h-10 rounded-xl" />
                        <div>
                            <h3 className="text-[14px] font-bold text-text">Sử dụng KOPOS</h3>
                            <p className="text-[12px] text-text-secondary">Vận hành quán nhỏ dễ dàng hơn</p>
                        </div>
                    </div>
                    <button onClick={dismissPrompt} className="text-text-dim hover:text-text p-1" aria-label="Đóng">
                        ✕
                    </button>
                </div>

                {isIOS ? (
                    <div className="mt-3 text-[13px] text-text-secondary flex flex-col gap-1.5">
                        <p>Để cài đặt ứng dụng trên iOS:</p>
                        <ol className="list-decimal list-inside space-y-1 pl-1">
                            <li>Bấm  <strong>Chia sẻ (Share) </strong> ở menu trình duyệt.</li>
                            <li>Chọn <strong>Thêm vào màn hình chính</strong><br />(<strong>Add to Home Screen</strong>)</li>
                        </ol>
                    </div>
                ) : (
                    <button
                        onClick={handleInstall}
                        className="w-full mt-3 bg-primary text-bg font-bold py-2 rounded-lg text-[14px] hover:bg-primary-hover active:scale-[0.98] transition-all"
                    >
                        Thêm vào màn hình chính
                    </button>
                )}
            </div>
        </div>
    )
}
