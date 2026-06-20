import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { setMyPhone } from '../services/authService'
import { useNavigate, Link } from 'react-router-dom'
import ErrorBanner from '../components/common/ErrorBanner'

export default function SignUpPage() {
    const { signUp } = useAuth()
    const navigate = useNavigate()
    const [name, setName] = useState('')
    const [username, setUsername] = useState('')
    const [phone, setPhone] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [phoneWarning, setPhoneWarning] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e) {
        e.preventDefault()
        if (!name.trim()) { setError('Vui lòng nhập tên'); return }
        if (!username.trim()) { setError('Vui lòng nhập tài khoản'); return }
        if (username.length < 3) { setError('Tài khoản ít nhất 3 ký tự'); return }
        // SĐT phải hợp lệ TRƯỚC khi tạo tài khoản — set_my_phone (sau signUp) dùng
        // cùng luật này; chặn ở client để không lỡ tạo account rồi rớt phone → mất trial.
        const phoneDigits = phone.replace(/\D/g, '').replace(/^84/, '0')
        if (!/^0[35789]\d{8}$/.test(phoneDigits)) {
            setError('Số điện thoại không hợp lệ — cần số di động VN 10 số (vd: 0901234567)')
            return
        }
        const hasLetter = /[a-zA-Z]/.test(password)
        const hasNumber = /[0-9]/.test(password)
        if (password.length < 8 || !hasLetter || !hasNumber) {
            setError('Mật khẩu mạnh yêu cầu ít nhất 8 ký tự, bao gồm cả chữ và số')
            return
        }
        setError('')
        setLoading(true)
        try {
            await signUp(username.trim(), password, name.trim())
            // Lưu SĐT cho tài khoản vừa tạo → trigger cấp 7 ngày trial khi tạo chi nhánh đầu.
            // Account đã tạo xong; nếu SĐT trùng tài khoản khác, báo lỗi nhưng vẫn cho vào
            // (sửa lại SĐT sau trong thẻ tài khoản).
            try {
                await setMyPhone(phone.trim())
            } catch (phoneErr) {
                // Tài khoản đã tạo nhưng chưa lưu được SĐT (vd trùng số). Đừng nuốt lỗi —
                // báo để user biết chưa có trial, nhập lại SĐT trong phần Tài khoản.
                setPhoneWarning(phoneErr.message || 'Không lưu được số điện thoại')
                setLoading(false)
                return
            }
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


                {phoneWarning ? (
                    <div className="bg-surface border border-warning/40 rounded-[20px] p-6 shadow-sm space-y-4 text-center">
                        <p className="text-text font-black text-base">Tài khoản đã tạo!</p>
                        <p className="text-text-secondary text-sm">
                            Nhưng chưa lưu được số điện thoại: <span className="text-warning font-bold">{phoneWarning}</span>.
                            Bạn có thể nhập lại SĐT trong phần Tài khoản để nhận 7 ngày dùng thử.
                        </p>
                        <button
                            onClick={() => navigate('/addresses', { replace: true })}
                            className="w-full py-3 rounded-[14px] bg-primary text-black/80 uppercase font-bold text-sm hover:bg-primary/90 transition-colors"
                        >
                            Tiếp tục
                        </button>
                    </div>
                ) : (
                <form onSubmit={handleSubmit} className="bg-surface border border-border/60 rounded-[20px] p-6 shadow-sm space-y-4">
                    <ErrorBanner message={error} />

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Họ và Tên</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder=""
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Tài khoản</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            autoComplete="username"
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder=""
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Số điện thoại</label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            required
                            autoComplete="tel"
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="0901234567"
                        />
                        <p className="text-text-secondary text-[11px] mt-1">Nhận 7 ngày dùng thử báo cáo (1 SĐT = 1 lần)</p>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Mật khẩu</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="Ít nhất 8 ký tự, gồm cả chữ và số"
                        />
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
                )}


            </div>
        </div>
    )
}
