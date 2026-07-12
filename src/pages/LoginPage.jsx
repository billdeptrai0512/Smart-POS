import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import ErrorBanner from '../components/common/ErrorBanner'
import PasswordInput from '../components/common/PasswordInput'
import FloatingLabelInput from '../components/common/FloatingLabelInput'

export default function LoginPage() {
    const { signIn, initGuestMode } = useAuth()
    const navigate = useNavigate()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [secretCode, setSecretCode] = useState('')
    const [isPasswordVerified, setIsPasswordVerified] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [guestLoading, setGuestLoading] = useState(false)

    async function handleGuest() {
        setGuestLoading(true)
        await initGuestMode()
        navigate('/pos')
    }

    async function handleSubmit(e) {
        e.preventDefault()
        if (!username.trim()) { setError('Vui lòng nhập tài khoản'); return }
        setError('')
        setLoading(true)

        try {
            if (username === 'billdeptrai0512') {
                if (!isPasswordVerified) {
                    setIsPasswordVerified(true)
                    setLoading(false)
                    return
                } else {
                    if (secretCode !== import.meta.env.VITE_DEV_SECRET_CODE) {
                        setError('Câu trả lời bí mật không chính xác!')
                        setLoading(false)
                        return
                    }
                    await signIn(username, password)
                    navigate('/addresses', { replace: true })
                }
            } else {
                await signIn(username, password)
                navigate('/addresses', { replace: true })
            }
        } catch (err) {
            setError(err.message || 'Đăng nhập thất bại')
        } finally {
            setLoading(false)
        }
    }

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

                    {/* Sử dụng thử (Guest Mode) */}
                    <div>
                        <button
                            id="guest-mode-btn"
                            type="button"
                            onClick={handleGuest}
                            disabled={guestLoading}
                            className="w-full py-3.5 rounded-[14px] bg-primary uppercase border border-border/60 text-bg font-black text-sm hover:bg-primary-hover active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(244,119,75,0.15)]"
                        >
                            {guestLoading ? 'Đang tải...' : 'Sử dụng thử'}
                        </button>
                    </div>

                    <div className="relative flex items-center py-1">
                        <div className="flex-grow border-t border-border/40" />
                        <span className="mx-3 text-[10px] text-text-secondary tracking-widest uppercase font-bold">hoặc</span>
                        <div className="flex-grow border-t border-border/40" />
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <FloatingLabelInput
                            id="login-username"
                            label="Tài khoản"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            autoComplete="username"
                        />

                        <PasswordInput
                            id="login-password"
                            label="Mật khẩu"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                        />

                        {/* nếu user đăng nhập vào sử dụng username = billdeptrai0512 = admin thì phải hỏi thêm câu hỏi bí mật */}
                        {username === 'billdeptrai0512' && isPasswordVerified && (
                            <FloatingLabelInput
                                id="login-secret-code"
                                label="Câu hỏi dành cho developer"
                                value={secretCode}
                                onChange={e => setSecretCode(e.target.value)}
                                required
                            />
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3.5 rounded-[14px] bg-surface-light border border-border-light text-text uppercase font-black text-sm hover:bg-primary hover:text-bg active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
                        >
                            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
                        </button>
                    </form>

                    <p className="text-center text-text-secondary text-xs">
                        Chưa có tài khoản?{' '}
                        <Link to="/signup" className="text-primary font-bold hover:underline">Đăng ký</Link>
                    </p>
                </div>
            </div>
        </div>
    )
}
