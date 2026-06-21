import { useState, useEffect } from 'react'
import { STORAGE_KEYS } from '../../constants/storageKeys'

// Synchronous, mount-only environment checks — computed as lazy initial state so
// they don't trigger an extra render via setState-in-effect.
const detectStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone || document.referrer.includes('android-app://')
const detectIOS = () =>
    (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
// In-app webviews (Instagram/Facebook/Messenger/Zalo/TikTok…) can't install a PWA —
// neither beforeinstallprompt nor Add-to-Home works. Steer the user to open externally.
const detectInApp = () =>
    /Instagram|FBAN|FBAV|FB_IAB|Zalo|Line\/|MicroMessenger|TikTok|musical_ly|BytedanceWebview/i.test(navigator.userAgent)

export default function PWAInstallPrompt() {
    const [promptInstall, setPromptInstall] = useState(null)
    const [isStandalone] = useState(detectStandalone)
    const [isIOS] = useState(detectIOS)
    const [isInApp] = useState(detectInApp)
    // iOS and in-app webviews have no beforeinstallprompt event, so decide their banner
    // up front; Android flips this on in the event handler below.
    const [showPrompt, setShowPrompt] = useState(
        () =>
            !detectStandalone() &&
            (detectInApp() || detectIOS()) &&
            !localStorage.getItem(STORAGE_KEYS.PWA_PROMPT_DISMISSED)
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

    if (isStandalone || !showPrompt) {
        return null
    }

    // In-app webview: a callout bubble anchored top-right, pointing at the browser's
    // ⋮ menu. No logo/title/close — just the two steps to escape the webview.
    if (isInApp) {
        return (
            <div className="inapp-hint-bubble toast-in" role="alert">
                <div className="text-[15px] font-bold text-black">Nhấn ⋮</div>
                <div className="mt-1.5 flex items-center gap-2 text-[15px] text-black">
                    <span className="text-[17px] leading-none">↗</span>
                    <span>“Mở trong trình duyệt”</span>
                </div>
            </div>
        )
    }

    return (
        <div className="pwa-install-banner toast-in">
            <div className="pwa-install-content">
                <div className="pwa-install-header">
                    <div className="flex items-center gap-3">
                        <img src="/icons/icon-192x192.png" alt="App Icon" className="w-10 h-10 rounded-xl" />
                        <div>
                            <h3 className="text-[14px] font-bold text-text">Tải App Cà Phê Sáng</h3>
                            <p className="text-[12px] text-text-secondary">Trải nghiệm mượt mà hơn</p>
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
                            <li>Nhấn vào biểu tượng Chia sẻ (Share) ở menu trình duyệt.</li>
                            <li>Chọn <strong>Thêm vào MH chính</strong> (Add to Home Screen).</li>
                        </ol>
                    </div>
                ) : (
                    <button
                        onClick={handleInstall}
                        className="w-full mt-3 bg-primary text-bg font-bold py-2 rounded-lg text-[14px] hover:bg-primary-hover active:scale-[0.98] transition-all"
                    >
                        Cài đặt ngay
                    </button>
                )}
            </div>
        </div>
    )
}
