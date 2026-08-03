import { useState } from 'react'
import { Check } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import ErrorBanner from '../components/common/ErrorBanner'
import FloatingLabelInput from '../components/common/FloatingLabelInput'
import PasswordInput from '../components/common/PasswordInput'
import { capitalizeWords } from '../utils'

// ponytail: bảng typo cứng thay vì thư viện (mailcheck) — email chỉ dùng để reset
// mật khẩu, gõ nhầm domain là mất luôn đường đó. Thêm dòng khi gặp ca mới.
const DOMAIN_TYPOS = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gnail.com': 'gmail.com',
    'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com',
    'hotmial.com': 'hotmail.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
}
const suggestEmailFix = (value) => {
    const [user, domain] = value.trim().split('@')
    const fixed = DOMAIN_TYPOS[domain?.toLowerCase()]
    return fixed && user ? `${user}@${fixed}` : ''
}

export default function SignUpPage() {
    const { signUp } = useAuth()
    const navigate = useNavigate()
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const emailFix = suggestEmailFix(email)

    async function handleSubmit(e) {
        e.preventDefault()
        if (!name.trim()) { setError('Vui lòng nhập tên'); return }
        // ponytail: format email để type="email" + regex trong signUp lo, không lặp lại ở đây.
        if (!email.trim()) { setError('Vui lòng nhập email'); return }
        if (!username.trim()) { setError('Vui lòng nhập tài khoản'); return }
        if (username.length < 3) { setError('Tài khoản ít nhất 3 ký tự'); return }
        const hasLetter = /[a-zA-Z]/.test(password)
        const hasNumber = /[0-9]/.test(password)
        if (password.length < 8 || !hasLetter || !hasNumber) {
            setError('Mật khẩu mạnh yêu cầu ít nhất 8 ký tự, bao gồm cả chữ và số')
            return
        }
        setError('')
        setLoading(true)
        try {
            await signUp(username.trim(), password, name.trim(), email.trim())
            navigate('/addresses', { replace: true })
        } catch (err) {
            setError(err.message || 'Đăng ký thất bại')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-4">
                    <h1 className="text-2xl font-black text-text mt-3">Đăng ký</h1>

                </div>


                <form onSubmit={handleSubmit} className="bg-surface border border-border/60 rounded-[20px] p-6 shadow-sm space-y-4">
                    <ErrorBanner message={error} />

                    <FloatingLabelInput
                        id="signup-name"
                        label="Họ và Tên"
                        autoCapitalize="words"
                        value={name}
                        onChange={e => setName(capitalizeWords(e.target.value))}
                        required
                    />

                    <div>
                        <FloatingLabelInput
                            id="signup-email"
                            label="Email"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                        />
                        {emailFix && (
                            <button
                                type="button"
                                onClick={() => setEmail(emailFix)}
                                className="mt-1.5 text-[11px] text-warning hover:underline"
                            >
                                Có phải <span className="font-bold">{emailFix}</span>? Bấm để sửa
                            </button>
                        )}
                    </div>

                    <FloatingLabelInput
                        id="signup-username"
                        label="Tài khoản"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        required
                        autoComplete="username"
                    />

                    <div>
                        <PasswordInput
                            id="signup-password"
                            label="Mật khẩu"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                        <ul className="mt-2 space-y-1">
                            {[
                                { ok: password.length >= 8, label: 'Ít nhất 8 ký tự' },
                                { ok: /[a-zA-Z]/.test(password), label: 'Có chữ cái' },
                                { ok: /[0-9]/.test(password), label: 'Có chữ số' },
                            ].map((r, i) => (
                                <li key={i} className={`flex items-center gap-1.5 text-[11px] ${r.ok ? 'text-success' : 'text-text-secondary'}`}>
                                    <Check size={12} className={r.ok ? 'opacity-100' : 'opacity-30'} />
                                    {r.label}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 rounded-[14px] bg-primary text-black/80 uppercase font-bold text-sm hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Đang tạo...' : 'Tạo tài khoản'}
                    </button>

                    <p className="text-center text-text-secondary text-xs mt-2">
                        {' '}
                        <Link to="/login" className="text-primary font-bold hover:underline">Quay lại</Link> trang đăng nhập
                    </p>
                </form>
            </div>
        </div>
    )
}
