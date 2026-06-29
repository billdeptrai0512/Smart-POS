import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { validateInviteToken } from '../services/authService'
import ErrorBanner from '../components/common/ErrorBanner'
import Skeleton from '../components/common/Skeleton'
import { capitalizeWords } from '../utils'

export default function StaffInvitePage() {
    const { token } = useParams()
    const { signUpWithInvite } = useAuth()
    const navigate = useNavigate()

    const [tokenInfo, setTokenInfo] = useState(null)   // { managerId, managerName }
    const [tokenError, setTokenError] = useState('')
    const [validating, setValidating] = useState(true)

    const [name, setName] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        validateInviteToken(token).then(result => {
            if (result.valid) {
                setTokenInfo({ managerId: result.managerId, managerName: result.managerName, role: result.role })
            } else {
                setTokenError(result.error)
            }
        }).finally(() => setValidating(false))
    }, [token])

    async function handleSubmit(e) {
        e.preventDefault()
        if (!name.trim()) { setError('Vui lòng nhập tên'); return }
        if (!username.trim()) { setError('Vui lòng nhập tài khoản'); return }
        const isCoManager = tokenInfo?.role === 'co-manager'
        if (isCoManager) {
            const hasLetter = /[a-zA-Z]/.test(password)
            const hasNumber = /[0-9]/.test(password)
            if (password.length < 8 || !hasLetter || !hasNumber) {
                setError('Mật khẩu quản lý yêu cầu ít nhất 8 ký tự, bao gồm cả chữ và số')
                return
            }
        } else {
            if (!/^[0-9]{6}$/.test(password)) {
                setError('Mật khẩu nhân viên phải là mã PIN gồm đúng 6 chữ số')
                return
            }
        }
        setError('')
        setLoading(true)
        try {
            await signUpWithInvite(token, username.trim(), password, name.trim())
            navigate('/addresses', { replace: true })
        } catch (err) {
            setError(err.message || 'Đăng ký thất bại')
        } finally {
            setLoading(false)
        }
    }

    const isCoManagerInvite = tokenInfo?.role === 'co-manager'

    if (validating) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-bg">
                <div className="w-full max-w-sm px-4 space-y-3">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-10 w-3/4 mx-auto" />
                </div>
            </div>
        )
    }

    if (tokenError) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
                <div className="w-full max-w-sm text-center">
                    <p className="text-4xl mb-4">🔗</p>
                    <h1 className="text-xl font-black text-text mb-2">Link không hợp lệ</h1>
                    <p className="text-text-secondary text-sm mb-6">{tokenError}</p>
                    <Link to="/login" className="text-primary font-bold text-sm hover:underline">
                        Quay lại đăng nhập
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-4">
                    <h1 className="text-2xl font-black text-text mt-3">Tạo tài khoản</h1>
                    {tokenInfo && (
                        <div className="mt-2 flex flex-col items-center gap-1.5">
                            <span className={`text-xs font-black uppercase tracking-wide px-3 py-1 rounded-full border ${isCoManagerInvite
                                ? 'bg-blue-500/10 border-blue-500/25 text-blue-500'
                                : 'bg-primary/10 border-primary/25 text-primary'}`}>
                                {isCoManagerInvite ? 'Đồng quản lý' : 'Nhân viên'}
                            </span>
                            {tokenInfo.managerName && (
                                <p className="text-text-secondary text-xs">
                                    Được <span className="font-bold text-text">{tokenInfo.managerName}</span> mời tham gia
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="bg-surface border border-border/60 rounded-[20px] p-6 shadow-sm space-y-4">
                    <ErrorBanner message={error} />

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Họ và Tên</label>
                        <input
                            type="text"
                            autoCapitalize="words"
                            value={name}
                            onChange={e => setName(capitalizeWords(e.target.value))}
                            required
                            autoFocus
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="Nguyễn Văn B"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Tên đăng nhập</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="username"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Mật khẩu</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(isCoManagerInvite ? e.target.value : e.target.value.replace(/\D/g, ''))}
                            required
                            inputMode={isCoManagerInvite ? 'text' : 'numeric'}
                            maxLength={isCoManagerInvite ? undefined : 6}
                            autoComplete="new-password"
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder={isCoManagerInvite ? 'Ít nhất 8 ký tự, gồm cả chữ và số' : 'Mã PIN gồm 6 chữ số'}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 rounded-[14px] bg-primary text-white font-bold text-sm hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Đang tạo...' : 'Tạo tài khoản'}
                    </button>
                </form>

                {/* <p className="text-center text-text-secondary text-xs mt-4">
                    <Link to="/login" className="text-primary font-bold hover:underline">Quay lại đăng nhập</Link>
                </p> */}
            </div>
        </div>
    )
}
