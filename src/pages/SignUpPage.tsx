import { useEffect, useState, type FormEvent } from 'react'
import { CircleAlert } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import ErrorBanner from '../components/common/ErrorBanner'
import FloatingLabelInput from '../components/common/FloatingLabelInput'
import PasswordInput from '../components/common/PasswordInput'
import PasswordChecklist from '../components/common/PasswordChecklist'
import { capitalizeWords } from '../utils'
import { errorMessage } from '../utils/errorMessage'
import { isStrongPassword } from '../utils/password'
import { trackSignupPageVisit } from '../services/onboardingFunnelService'

// ponytail: bảng typo cứng thay vì thư viện (mailcheck) — email chỉ dùng để reset
// mật khẩu, gõ nhầm domain là mất luôn đường đó. Thêm dòng khi gặp ca mới.
const DOMAIN_TYPOS: Record<string, string> = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gnail.com': 'gmail.com',
    'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com',
    'hotmial.com': 'hotmail.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
}
const suggestEmailFix = (value: string) => {
    const [user, domain] = value.trim().split('@')
    const fixed = DOMAIN_TYPOS[domain?.toLowerCase() ?? '']
    return fixed && user ? `${user}@${fixed}` : ''
}

export default function SignUpPage() {
    const { signUp, isGuest } = useAuth()
    const navigate = useNavigate()
    const [name, setName] = useState('')
    const [branch, setBranch] = useState('')
    // Có link ?clone=MÃ → chi nhánh đầu tiên do modal "Tạo địa chỉ" ở /addresses lo (chép cấu hình
    // từ mã), nên ở đây không hỏi tên quán.
    const hasCloneCode = !!sessionStorage.getItem('pending_clone_code')
    const [email, setEmail] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    // field: ô gây lỗi → viền đỏ (aria-invalid); gõ bất kỳ ô nào thì bỏ viền, giữ câu báo (onChange của form).
    const [error, setError] = useState<{ msg: string; field?: string } | null>(null)
    const [loading, setLoading] = useState(false)
    const emailFix = suggestEmailFix(email)
    useEffect(trackSignupPageVisit, [])

    async function handleSubmit(e: FormEvent) {
        e.preventDefault()
        if (!name.trim()) return setError({ msg: 'Vui lòng nhập tên', field: 'name' })
        if (!hasCloneCode && !branch.trim()) return setError({ msg: 'Vui lòng nhập tên quán', field: 'branch' })
        // ponytail: format email để type="email" + regex trong signUp lo, không lặp lại ở đây.
        if (!email.trim()) return setError({ msg: 'Vui lòng nhập email', field: 'email' })
        if (!username.trim()) return setError({ msg: 'Vui lòng nhập tài khoản', field: 'username' })
        if (username.length < 3) return setError({ msg: 'Tài khoản ít nhất 3 ký tự', field: 'username' })
        if (!isStrongPassword(password)) return setError({ msg: 'Mật khẩu mạnh yêu cầu ít nhất 8 ký tự, bao gồm cả chữ và số', field: 'password' })
        setError(null)
        setLoading(true)
        try {
            const { address } = await signUp(username.trim(), password, name.trim(), email.trim(), hasCloneCode ? '' : branch)
            // Có chi nhánh → y như tạo địa chỉ ở /addresses (AddressSelectPage.handleCreate): địa chỉ mới chưa có gói nên qua
            // cổng gói trước rồi vào Danh mục — vào thẳng /category thì SubscriptionGuard đá ngược về /addresses.
            // Không tự quyết theo cờ thu phí ở đây: trang này đọc cờ lúc còn là khách (anon → RLS trả [] → "tắt" sai);
            // /subscription đọc lại sau khi đã đăng nhập, tắt thì tự cho qua. Không có chi nhánh → tự tạo ở /addresses.
            if (address) navigate('/subscription', { replace: true, state: { preselectAddressId: address.id, from: '/addresses', locked: true, skipTo: '/category/overall', skipState: { from: '/addresses' } } })
            else navigate('/addresses', { replace: true })
        } catch (err) {
            const msg = errorMessage(err, 'Đăng ký thất bại')
            // Supabase trả nguyên câu tiếng Anh khi trùng tên tài khoản (tài khoản = email nội bộ, formatUsernameToEmail).
            if (/already registered|already exists/i.test(msg)) setError({ msg: 'Tên tài khoản này đã có người dùng', field: 'username' })
            else setError({ msg })
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


                <form onSubmit={handleSubmit} onChange={() => error?.field && setError({ msg: error.msg })} className="bg-surface border border-border/60 rounded-[20px] p-6 shadow-sm space-y-4">
                    <ErrorBanner message={error?.msg} />

                    <FloatingLabelInput
                        id="signup-name"
                        aria-invalid={error?.field === 'name'}
                        label="Họ và Tên"
                        autoCapitalize="words"
                        value={name}
                        onChange={e => setName(capitalizeWords(e.target.value))}
                        required
                        autoComplete="name"
                    />

                    {!hasCloneCode && (
                        <FloatingLabelInput
                            id="signup-branch"
                        aria-invalid={error?.field === 'branch'}
                            label="Tên quán / chi nhánh"
                            autoCapitalize="words"
                            value={branch}
                            onChange={e => setBranch(e.target.value)}
                            required
                            autoComplete="organization"
                        />
                    )}

                    <FloatingLabelInput
                        id="signup-username"
                        aria-invalid={error?.field === 'username'}
                        label="Tài khoản"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        required
                        autoComplete="username"
                    />

                    <div>
                        <PasswordInput
                            id="signup-password"
                        aria-invalid={error?.field === 'password'}
                            label="Mật khẩu"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                        <PasswordChecklist password={password} />
                    </div>

                    {/* Email cuối form: ô duy nhất đổi bàn phím, và chỉ phục vụ khôi phục mật khẩu. */}
                    <div>
                        <FloatingLabelInput
                            id="signup-email"
                        aria-invalid={error?.field === 'email'}
                            label="Email"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                        />
                        {emailFix ? (
                            <button
                                type="button"
                                onClick={() => setEmail(emailFix)}
                                className="mt-1.5 text-[11px] text-warning hover:underline"
                            >
                                Có phải <span className="font-bold">{emailFix}</span>? Bấm để sửa
                            </button>
                        ) : (
                            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-text-secondary">
                                <CircleAlert size={12} className="shrink-0" />
                                Dùng để khôi phục mật khẩu
                            </p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 rounded-[14px] bg-primary text-black/80 uppercase font-bold text-sm hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Đang tạo...' : 'Tạo tài khoản'}
                    </button>

                    {/* Khách dùng thử: không có lối "Tiếp tục dùng thử" — trang này là CTA cuối của demo (phiên dùng thử vẫn
                        còn nguyên tới khi đăng ký thành công, nút Back của máy vẫn quay lại được). */}
                    {/* !loading: đăng ký xong isGuest tắt TRƯỚC khi chuyển trang — khỏi chớp dòng này. */}
                    {!isGuest && !loading && (
                        <p className="text-center text-text-secondary text-xs mt-2">
                            <Link to="/login" className="text-primary font-bold hover:underline">Quay lại</Link> trang đăng nhập
                        </p>
                    )}
                </form>
            </div>
        </div>
    )
}
