import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import ErrorBanner from '../components/common/ErrorBanner'

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
                    if (secretCode !== '22082005') {
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
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4 py-8">
            <div className="w-full max-w-sm">
                <div className="text-center mb-5">
                    <h1 className="text-2xl font-black text-text uppercase">Smart POS</h1>
                    <p className="text-center text-text-secondary text-[14px] mt-2">
                        Công cụ quản lý bán hàng thông minh
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="bg-surface border border-border/60 rounded-[20px] p-6 shadow-sm space-y-4">
                    <ErrorBanner message={error} />

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Tài khoản</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            autoFocus
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="username"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Mật khẩu</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="••••••••"
                        />
                    </div>

                    {/* nếu user đăng nhập vào sử dụng username = billdeptrai0512 = admin thì phải hỏi thêm câu hỏi bí mật */}
                    {username === 'billdeptrai0512' && isPasswordVerified && (
                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Câu hỏi dành cho developer</label>
                            <input
                                type="text"
                                value={secretCode}
                                onChange={e => setSecretCode(e.target.value)}
                                required
                                className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                                placeholder="********"
                            />
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 rounded-[14px] bg-primary uppercase border border-border/60 text-black/80 font-bold text-sm hover:bg-bg active:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
                    </button>

                    <p className="text-center text-text-secondary text-xs mt-2">
                        Chưa có tài khoản?{' '}
                        <Link to="/signup" className="text-primary font-bold hover:underline">Đăng ký</Link>
                    </p>
                </form>

                <div className="mt-4 relative flex items-center">
                    <div className="flex-grow border-t border-border/40" />
                    <span className="mx-3 text-[10px] text-text-secondary tracking-wider">hoặc</span>
                    <div className="flex-grow border-t border-border/40" />
                </div>

                <div className='pt-4 px-6 shadow-sm'>
                    <button
                        id="guest-mode-btn"
                        type="button"
                        onClick={handleGuest}
                        disabled={guestLoading}
                        className="w-full py-3.5 rounded-[14px] bg-surface-light items-center text-text uppercase font-black text-sm hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_20px_rgba(245,158,11,0.25)]"
                    >
                        {guestLoading ? 'Đang tải...' : 'Sử dụng thử'}
                    </button>
                </div>


            </div>
        </div>
    )
}
