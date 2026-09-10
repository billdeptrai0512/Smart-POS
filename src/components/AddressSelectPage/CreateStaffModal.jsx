import { useState } from 'react'
import { Shield, UserPlus, Loader } from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import { capitalizeWords } from '../../utils'
import { createTeamMember } from '../../services/authService'
import { Dialog, SheetHeader } from '../common/ModalShell'
import FloatingLabelInput from '../common/FloatingLabelInput'
import PasswordInput from '../common/PasswordInput'
import PasswordChecklist from '../common/PasswordChecklist'

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
                <SheetHeader title="Thêm nhân sự mới" onClose={onClose} closeDisabled={loading} className="p-4 border-b border-border/20" />

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
                    <FloatingLabelInput
                        id="create-staff-name"
                        label="Họ và Tên"
                        autoCapitalize="words"
                        value={name}
                        onChange={e => setName(capitalizeWords(e.target.value))}
                        required
                        disabled={loading}
                    />

                    {/* Tên đăng nhập */}
                    <FloatingLabelInput
                        id="create-staff-username"
                        label="Tên đăng nhập"
                        value={username}
                        onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
                        required
                        disabled={loading}
                    />

                    {/* Mật khẩu */}
                    <div>
                        <PasswordInput
                            id="create-staff-password"
                            label={isCo ? 'Mật khẩu đăng nhập' : 'Mã PIN gồm 6 chữ số'}
                            value={password}
                            onChange={e => setPassword(isCo ? e.target.value : e.target.value.replace(/\D/g, ''))}
                            required
                            disabled={loading}
                            inputMode={isCo ? 'text' : 'numeric'}
                            maxLength={isCo ? undefined : 6}
                            autoComplete="new-password"
                        />

                        {isCo ? (
                            <PasswordChecklist password={password} />
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
