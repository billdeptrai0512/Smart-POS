import { useState } from 'react'
import { Shield, UserPlus, Loader, X, Check, Eye, EyeOff } from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import { capitalizeWords } from '../../utils'
import { createTeamMember } from '../../services/authService'
import { Dialog } from '../common/ModalShell'

const ROLES = [
    { key: 'staff', label: 'Nhân viên', icon: UserPlus, description: 'Đăng nhập bằng mã PIN 6 số' },
    { key: 'manager', label: 'Quản lý', icon: Shield, description: 'Đăng nhập bằng mật khẩu mạnh' },
]

export default function CreateStaffModal({ onClose, onSuccess }) {
    const [role, setRole] = useState('staff')
    const [name, setName] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [pwVisible, setPwVisible] = useState(false)
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
        <Dialog
            onClose={() => { if (!loading) onClose() }}
            zIndexClass="z-[100]"
            panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
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
                        <div className="relative">
                            <input
                                id="create-staff-name"
                                type="text"
                                autoCapitalize="words"
                                value={name}
                                onChange={e => setName(capitalizeWords(e.target.value))}
                                required
                                disabled={loading}
                                placeholder=" "
                                className="peer w-full px-3 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            />
                            <label
                                htmlFor="create-staff-name"
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-xs font-bold uppercase tracking-wider transition-all duration-150 pointer-events-none
                                    peer-focus:top-0 peer-focus:text-[10px] peer-focus:px-1 peer-focus:bg-surface peer-focus:text-primary
                                    peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:px-1 peer-[:not(:placeholder-shown)]:bg-surface"
                            >
                                Họ và Tên
                            </label>
                        </div>
                    </div>

                    {/* Tên đăng nhập */}
                    <div>
                        <div className="relative">
                            <input
                                id="create-staff-username"
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
                                required
                                disabled={loading}
                                placeholder=" "
                                className="peer w-full px-3 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            />
                            <label
                                htmlFor="create-staff-username"
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-xs font-bold uppercase tracking-wider transition-all duration-150 pointer-events-none
                                    peer-focus:top-0 peer-focus:text-[10px] peer-focus:px-1 peer-focus:bg-surface peer-focus:text-primary
                                    peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:px-1 peer-[:not(:placeholder-shown)]:bg-surface"
                            >
                                Tên đăng nhập
                            </label>
                        </div>
                    </div>

                    {/* Mật khẩu */}
                    <div>
                        <div className="relative">
                            <input
                                id="create-staff-password"
                                type={pwVisible ? 'text' : 'password'}
                                value={password}
                                onChange={e => setPassword(isCo ? e.target.value : e.target.value.replace(/\D/g, ''))}
                                required
                                disabled={loading}
                                inputMode={isCo ? 'text' : 'numeric'}
                                maxLength={isCo ? undefined : 6}
                                autoComplete="new-password"
                                placeholder=" "
                                className="peer w-full px-3 py-2.5 pr-10 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            />
                            <label
                                htmlFor="create-staff-password"
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-xs font-bold uppercase tracking-wider transition-all duration-150 pointer-events-none
                                    peer-focus:top-0 peer-focus:text-[10px] peer-focus:px-1 peer-focus:bg-surface peer-focus:text-primary
                                    peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:px-1 peer-[:not(:placeholder-shown)]:bg-surface"
                            >
                                {isCo ? 'Mật khẩu đăng nhập' : 'Mã PIN gồm 6 chữ số'}
                            </label>
                            <button
                                type="button"
                                onClick={() => setPwVisible(v => !v)}
                                tabIndex={-1}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text transition-colors"
                                aria-label={pwVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                            >
                                {pwVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                        </div>

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
        </Dialog>
    )
}
