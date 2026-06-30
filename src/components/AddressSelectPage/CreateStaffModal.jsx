import { useState } from 'react'
import { Shield, UserPlus, Loader, X, Check } from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import { capitalizeWords } from '../../utils'
import { createTeamMember } from '../../services/authService'

const ROLES = [
    { key: 'staff', label: 'Nhân viên', icon: UserPlus, description: 'Đăng nhập bằng mã PIN 6 số' },
    { key: 'manager', label: 'Quản lý', icon: Shield, description: 'Đăng nhập bằng mật khẩu mạnh' },
]

export default function CreateStaffModal({ onClose, onSuccess }) {
    const [role, setRole] = useState('staff')
    const [name, setName] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const isCo = role === 'manager'

    // Realtime check for password strength
    const pwChecks = [
        { ok: password.length >= 8, label: 'Ít nhất 8 ký tự' },
        { ok: /[a-zA-Z]/.test(password), label: 'Có chữ cái' },
        { ok: /[0-9]/.test(password), label: 'Có chữ số' },
    ]

    const pwValid = isCo
        ? password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password)
        : /^[0-9]{6}$/.test(password)

    async function handleSubmit(e) {
        e.preventDefault()
        if (!name.trim()) { setError('Vui lòng nhập tên'); return }
        if (!username.trim()) { setError('Vui lòng nhập tài khoản'); return }
        if (username.length < 3) { setError('Tài khoản ít nhất 3 ký tự'); return }
        if (!pwValid) {
            setError(isCo
                ? 'Mật khẩu quản lý yêu cầu ít nhất 8 ký tự, bao gồm cả chữ và số'
                : 'Mật khẩu nhân viên phải là mã PIN gồm đúng 6 chữ số'
            )
            return
        }

        setError('')
        setLoading(true)
        try {
            await createTeamMember(name.trim(), username.trim(), password, role)
            onSuccess()
            onClose()
        } catch (err) {
            setError(err.message || 'Tạo tài khoản thất bại')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!loading) onClose() }} />
            <div className="relative w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-4 border-b border-border/20">
                    <span className="text-[15px] font-black text-text">Thêm nhân sự mới</span>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all disabled:opacity-50 shrink-0"
                    >
                        <X size={16} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 hide-scrollbar">
                    <ErrorBanner message={error} />

                    {/* Vai trò */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider">Vai trò</label>
                        <div className="flex gap-2 bg-bg border border-border/60 rounded-[14px] p-1">
                            {ROLES.map(r => {
                                const active = role === r.key
                                const Icon = r.icon
                                const blue = r.key === 'manager'
                                return (
                                    <button
                                        key={r.key}
                                        type="button"
                                        onClick={() => {
                                            setRole(r.key)
                                            setPassword('') // Clear password on role toggle
                                            setError('')
                                        }}
                                        className={`flex-1 flex flex-col items-center justify-center py-2 rounded-[10px] text-xs font-black transition-all ${active
                                            ? (blue ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'bg-primary/10 text-primary border border-primary/20')
                                            : 'text-text-secondary hover:bg-surface-light border border-transparent'}`}
                                    >
                                        <div className="flex items-center gap-1">
                                            <Icon size={13} />
                                            <span>{r.label}</span>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Họ tên */}
                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Họ và Tên</label>
                        <input
                            type="text"
                            autoCapitalize="words"
                            value={name}
                            onChange={e => setName(capitalizeWords(e.target.value))}
                            required
                            disabled={loading}
                            className="w-full px-3 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-text-secondary/40"
                            placeholder="Nguyễn Văn A"
                        />
                    </div>

                    {/* Tên đăng nhập */}
                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Tên đăng nhập</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
                            required
                            disabled={loading}
                            className="w-full px-3 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-text-secondary/40"
                            placeholder="username"
                        />
                    </div>

                    {/* Mật khẩu */}
                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Mật khẩu</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(isCo ? e.target.value : e.target.value.replace(/\D/g, ''))}
                            required
                            disabled={loading}
                            inputMode={isCo ? 'text' : 'numeric'}
                            maxLength={isCo ? undefined : 6}
                            autoComplete="new-password"
                            className="w-full px-3 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-text-secondary/40"
                            placeholder={isCo ? 'Mật khẩu đăng nhập' : 'Mã PIN gồm 6 chữ số'}
                        />

                        {isCo ? (
                            <ul className="mt-2 space-y-1">
                                {pwChecks.map((r, i) => (
                                    <li key={i} className={`flex items-center gap-1.5 text-[11px] ${r.ok ? 'text-success font-bold' : 'text-text-secondary/60'}`}>
                                        <Check size={12} className={r.ok ? 'opacity-100' : 'opacity-30'} />
                                        {r.label}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-text-secondary/60 text-[11px] px-1 mt-1.5">
                                Mã PIN dùng để đăng nhập nhanh tại POS
                            </p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 rounded-[12px] bg-primary text-bg font-black text-sm uppercase hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader size={16} className="animate-spin" /> : null}
                        {loading ? 'Đang tạo...' : 'Tạo tài khoản'}
                    </button>
                </form>
            </div>
        </div>
    )
}
