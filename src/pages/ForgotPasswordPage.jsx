import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { requestPasswordReset, verifyPasswordResetCode, updateOwnPassword, signOut } from '../services/authService'
import ErrorBanner from '../components/common/ErrorBanner'
import FloatingLabelInput from '../components/common/FloatingLabelInput'
import PasswordInput from '../components/common/PasswordInput'

const CODE_TTL = 15 * 60
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// 3 bước trên cùng 1 trang: nhập tài khoản → nhập mã trong mail → đặt mật khẩu mới.
// Ô tài khoản khoá lại từ bước 2 vì mã đã gắn với đúng tài khoản đó.
export default function ForgotPasswordPage() {
    const navigate = useNavigate()
    const [step, setStep] = useState('username')  // username | code | password
    const [username, setUsername] = useState('')
    const [code, setCode] = useState('')
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [left, setLeft] = useState(0)  // giây còn lại của mã

    // Đồng hồ chỉ chạy ở bước nhập mã. CODE_TTL phải khớp OTP expiry của Supabase
    // (Authentication → Emails → Email OTP Expiration = 900s), không thì đếm 1 đằng
    // hết hạn 1 nẻo.
    useEffect(() => {
        if (step !== 'code') return
        const t = setInterval(() => setLeft(s => (s > 0 ? s - 1 : 0)), 1000)
        return () => clearInterval(t)
    }, [step])

    // Nhập đúng mã là đã có session thật của tài khoản đó. Bỏ ngang ở bước đặt
    // mật khẩu (đóng tab, bấm Quay lại) mà không dọn thì máy đó nghiễm nhiên
    // đang đăng nhập — nguy với máy dùng chung ở quán. Rời trang khi còn dở →
    // signOut. Bước 'done' thì không, lúc đó đăng nhập là đúng ý.
    const stepRef = useRef(step)
    stepRef.current = step
    useEffect(() => () => { if (stepRef.current === 'password') signOut() }, [])

    async function handleSubmit(e) {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            if (step === 'username') {
                if (!username.trim()) throw new Error('Chưa nhập tài khoản')
                await requestPasswordReset(username.trim())
                // Sang bước nhập mã kể cả khi tài khoản không tồn tại / chưa khai
                // email — server cố tình không nói, nói ra là cho dò tài khoản.
                setLeft(CODE_TTL)
                setStep('code')
            } else if (step === 'code') {
                // KHÔNG chốt cứng độ dài: độ dài mã do Supabase cấu hình (đang 8),
                // đổi trên dashboard là client hỏng ngay. Để verifyOtp phán.
                if (!code.trim()) throw new Error('Chưa nhập mã xác nhận')
                await verifyPasswordResetCode(username.trim(), code)
                setStep('password')
            } else {
                const hasLetter = /[a-zA-Z]/.test(password)
                const hasNumber = /[0-9]/.test(password)
                // Danh sách điều kiện ngay dưới ô đã chỉ rõ thiếu gì → câu lỗi khỏi lặp lại.
                if (password.length < 8 || !hasLetter || !hasNumber) {
                    throw new Error('Mật khẩu chưa đủ điều kiện')
                }
                if (password !== confirm) throw new Error('Hai mật khẩu chưa khớp')
                await updateOwnPassword(password)
                setStep('done')
            }
        } catch (err) {
            setError(err.message || 'Có lỗi xảy ra')
        } finally {
            setLoading(false)
        }
    }

    // Server chặn gửi lại trong 60s (im lặng trả ok) → đếm lại từ đầu vẫn đúng
    // với mã cũ vì mã cũ chưa hết hạn, nhập cái nào cũng được.
    async function handleResend() {
        setError('')
        setLoading(true)
        try {
            await requestPasswordReset(username.trim())
            setCode('')
            setLeft(CODE_TTL)
        } catch (err) {
            setError(err.message || 'Không gửi lại được mã')
        } finally {
            setLoading(false)
        }
    }

    const buttonLabel = {
        username: loading ? 'Đang gửi...' : 'Gửi mã xác nhận',
        code: loading ? 'Đang kiểm tra...' : 'Xác nhận',
        password: loading ? 'Đang lưu...' : 'Đổi mật khẩu',
    }[step]

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
            <div className="w-full max-w-sm">
                <h1 className="text-2xl font-black text-text text-center mb-4">Quên mật khẩu</h1>

                <div className="bg-surface border border-border/60 rounded-[20px] p-6 shadow-sm">
                    {step === 'done' ? (
                        <div className="space-y-4 text-center">
                            <div className="mx-auto w-11 h-11 rounded-full bg-success/15 flex items-center justify-center">
                                <Check size={22} className="text-success" />
                            </div>
                            <p className="text-text font-black text-base">Đã đổi mật khẩu</p>
                            <p className="text-text-secondary text-xs">
                                Lần sau đăng nhập <span className="font-bold text-text">{username}</span> bằng mật khẩu mới.
                            </p>
                            <button
                                type="button"
                                onClick={() => navigate('/addresses', { replace: true })}
                                className="w-full py-3 rounded-[14px] bg-primary text-black/80 uppercase font-bold text-sm hover:bg-primary/90 transition-colors"
                            >
                                Vào ứng dụng
                            </button>
                        </div>
                    ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <ErrorBanner message={error} />

                        <FloatingLabelInput
                            id="forgot-username"
                            label="Nhập tài khoản"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            autoComplete="username"
                            disabled={step !== 'username'}
                            className="disabled:opacity-50"
                        />

                        {step === 'code' && (
                            <div>
                                <FloatingLabelInput
                                    id="forgot-code"
                                    label="Mã xác nhận"
                                    value={code}
                                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                    required
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    className="tracking-[0.4em]"
                                />
                                {/* Nút gửi lại luôn hiện nhưng khoá tới khi mã cũ hết hạn — còn
                                    hạn thì mã trong mail vẫn dùng được, gửi thêm chỉ tổ rối. */}
                                <div className="mt-2 pl-2 flex items-center justify-between gap-2">
                                    {left > 0 ? (
                                        <p className="text-[11px] text-text-secondary">
                                            Hết hạn sau: <span className="font-bold text-text">{mmss(left)}</span>
                                        </p>
                                    ) : (
                                        <p className="text-[11px] text-warning font-bold">Mã xác nhận đã hết hạn.</p>
                                    )}
                                    <button
                                        type="button"
                                        disabled={loading || left > 0}
                                        onClick={handleResend}
                                        className="text-[11px] text-primary font-bold hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
                                    >
                                        Gửi lại mã
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 'password' && (
                            <>
                                <PasswordInput
                                    id="forgot-new-password"
                                    label="Mật khẩu mới"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    autoComplete="new-password"
                                />
                                <div>
                                    <PasswordInput
                                        id="forgot-confirm-password"
                                        label="Nhập lại mật khẩu"
                                        value={confirm}
                                        onChange={e => setConfirm(e.target.value)}
                                        required
                                        autoComplete="new-password"
                                    />
                                    <ul className="mt-2 space-y-1">
                                        {[
                                            { ok: password.length >= 8, label: 'Ít nhất 8 ký tự' },
                                            { ok: /[a-zA-Z]/.test(password), label: 'Có chữ cái' },
                                            { ok: /[0-9]/.test(password), label: 'Có chữ số' },
                                            { ok: !!password && password === confirm, label: 'Hai mật khẩu khớp nhau' },
                                        ].map((r, i) => (
                                            <li key={i} className={`flex items-center gap-1.5 text-[11px] ${r.ok ? 'text-success' : 'text-text-secondary'}`}>
                                                <Check size={12} className={r.ok ? 'opacity-100' : 'opacity-30'} />
                                                {r.label}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 rounded-[14px] bg-primary text-black/80 uppercase font-bold text-sm hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {buttonLabel}
                        </button>

                        <p className="text-center text-text-secondary text-xs">
                            <Link to="/login" className="text-primary font-bold hover:underline">Quay lại</Link> trang đăng nhập
                        </p>
                    </form>
                    )}
                </div>
            </div>
        </div>
    )
}
