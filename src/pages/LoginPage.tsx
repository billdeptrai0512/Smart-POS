import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import ErrorBanner from '../components/common/ErrorBanner'
import PasswordInput from '../components/common/PasswordInput'
import FloatingLabelInput from '../components/common/FloatingLabelInput'
import { errorMessage } from '../utils/errorMessage'
import { capitalizeWords } from '../utils'
import { setGuestShopName } from '../services/localRepository'
import { trackLoginPageVisit } from '../services/onboardingFunnelService'

// Supabase auth trả message tiếng Anh — dịch những lỗi login thường gặp
const AUTH_ERROR_VI: Record<string, string> = {
    'Invalid login credentials': 'Sai tài khoản hoặc mật khẩu',
    'Email not confirmed': 'Tài khoản chưa xác nhận email',
    'Too many requests': 'Thử lại quá nhiều lần, vui lòng chờ một chút',
}

const GUEST_BTN =
    'w-full py-3.5 rounded-[14px] bg-primary/5 uppercase border border-primary/40 text-primary font-black text-sm hover:bg-primary/10 hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-primary/50 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed'

export default function LoginPage() {
    const { signIn, initGuestMode, user, isGuest } = useAuth()
    const navigate = useNavigate()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [guestLoading, setGuestLoading] = useState(false)
    const [shopFormOpen, setShopFormOpen] = useState(false)
    const [shopName, setShopName] = useState('')

    useEffect(() => { trackLoginPageVisit() }, [])
    // Đã đăng nhập thì không cho vào đây: bấm "Dùng thử" khi còn phiên thật, supabase báo lại SIGNED_IN giữa chừng → app tự thoát chế độ khách (AuthContext).
    const signedIn = !!user && !isGuest

    async function handleGuest(e: FormEvent) {
        e.preventDefault()
        setGuestLoading(true)
        await initGuestMode()
        // Sau initGuestMode: lúc này mới chắc không bị dọn cùng dữ liệu guest cũ.
        setGuestShopName(shopName.trim())
        navigate('/pos')
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault()
        if (!username.trim()) { setError('Vui lòng nhập tài khoản'); return }
        setError('')
        setLoading(true)

        try {
            await signIn(username, password)
            navigate('/addresses', { replace: true })
        } catch (err) {
            const msg = errorMessage(err, '')
            setError(AUTH_ERROR_VI[msg] || msg || 'Đăng nhập thất bại')
        } finally {
            setLoading(false)
        }
    }

    if (signedIn) return <Navigate to="/addresses" replace />

    return (
        <div className="flex flex-col items-center justify-start min-h-screen bg-bg px-4 py-8">
            <div className="w-full max-w-sm space-y-6">
                <div className="text-center">
                    {/* Logo KOPOS — nền trong suốt nên hoà thẳng vào bg-bg của trang login */}
                    <img
                        src="/kopos-logo.png"
                        alt="KOPOS — Vận hành quán nhỏ dễ dàng hơn!"
                        className="mx-auto w-60 h-auto select-none"
                        draggable="false"
                    />
                </div>

                <div className="bg-surface border border-border/60 rounded-[24px] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.35)] space-y-5">
                    <ErrorBanner message={error} />

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <FloatingLabelInput
                            id="login-username"
                            label="Tài khoản"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            autoComplete="username"
                        />

                        <div>
                            <PasswordInput
                                id="login-password"
                                label="Mật khẩu"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                            />
                            {/* Chỉ hiện khi nhập sai; pl-2 → thẳng hàng với chữ trong ô */}
                            {error === AUTH_ERROR_VI['Invalid login credentials'] && (
                                <Link to="/forgot-password" className="block mt-3 pl-2 text-text-secondary text-xs hover:text-primary hover:underline">
                                    Quên mật khẩu?
                                </Link>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3.5 rounded-[14px] bg-surface-light border border-border-light text-text uppercase font-black text-sm hover:bg-primary hover:text-bg active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
                        >
                            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
                        </button>
                    </form>

                    <div className="flex items-center gap-2 ml-2 mr-2">
                        <div className="flex-1 h-px bg-border-light" />
                        <span className="text-text-secondary text-[11px] uppercase tracking-wide">hoặc</span>
                        <div className="flex-1 h-px bg-border-light" />
                    </div>

                    {/* Sử dụng thử (Guest Mode): bấm → hỏi tên quán → vào POS với menu mẫu mang tên đó */}
                    {shopFormOpen ? (
                        <form onSubmit={handleGuest} className="space-y-4">
                            <FloatingLabelInput
                                id="guest-shop-name"
                                label="Tên quán / địa chỉ"
                                value={shopName}
                                autoCapitalize="words"
                                onChange={e => setShopName(capitalizeWords(e.target.value))}
                                autoFocus
                            />
                            <button
                                id="guest-mode-btn"
                                type="submit"
                                disabled={guestLoading || !shopName.trim()}
                                className={GUEST_BTN}
                            >
                                {guestLoading ? 'Đang tải...' : 'Tạo quán'}
                            </button>
                        </form>
                    ) : (
                        <button
                            id="guest-mode-btn"
                            type="button"
                            onClick={() => setShopFormOpen(true)}
                            className={GUEST_BTN}
                        >
                            Tạo quán mới
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
