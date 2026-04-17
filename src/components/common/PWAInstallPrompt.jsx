import { useState, useEffect } from 'react'

export default function PWAInstallPrompt() {
    const [supportsPWA, setSupportsPWA] = useState(false)
    const [promptInstall, setPromptInstall] = useState(null)
    const [isIOS, setIsIOS] = useState(false)
    const [isStandalone, setIsStandalone] = useState(false)
    const [showPrompt, setShowPrompt] = useState(false)

    useEffect(() => {
        // Check if already installed
        const isAppStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone || document.referrer.includes('android-app://')
        setIsStandalone(isAppStandalone)

        if (isAppStandalone) {
            return // Don't show anything if already installed
        }

        // Detect iOS (iPad, iPhone, iPod)
        const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        // Also check for new iPads on iOS 13+
        const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const iosEnv = isIOSDevice || isIPadOS;

        setIsIOS(iosEnv)

        // Handle Android/Chrome beforeinstallprompt
        const handler = e => {
            e.preventDefault()
            setSupportsPWA(true)
            setPromptInstall(e)
            setShowPrompt(true)
        }

        window.addEventListener('beforeinstallprompt', handler)

        // If it's iOS and not standalone, we can automatically show the prompt
        // Or we might want to delay it or only show if they haven't dismissed it
        // Check local storage so we don't annoy users constantly
        const dismissed = localStorage.getItem('pwa_prompt_dismissed')
        if (iosEnv && !dismissed) {
            setShowPrompt(true)
        } else if (!iosEnv && !dismissed && supportsPWA) {
            setShowPrompt(true)
        }

        return () => window.removeEventListener('beforeinstallprompt', handler)
    }, [supportsPWA])

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
        localStorage.setItem('pwa_prompt_dismissed', 'true')
    }

    if (isStandalone || !showPrompt) {
        return null
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
