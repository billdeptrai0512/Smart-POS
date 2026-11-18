import { useState } from 'react'
import { Mail, Loader2, Check, X, Bell, MessageCircleQuestion, LogOut, User } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { NAV_ICON_BTN } from '../../constants/navStyles'
import { useAuth } from '../../contexts/AuthContext'
import { setMyEmail } from '../../services/authService'
import AddressNotice from './AddressNotice'
import Delta from '../common/Delta'
import { deltaPct } from '../../utils/deltaPct'
import { formatVND } from '../../utils'
import { Dialog, ModalHeader } from '../common/ModalShell'
import type { Profile } from '../../types/domain'
import { errorMessage } from '../../utils/errorMessage'

interface Props {
    isStaff?: boolean
    isGuest?: boolean
    activeTab: string
    setActiveTab: (tab: string) => void
    profile?: Profile | null
    setError: (message: string) => void
    addressCount: number
    staffCount: number
    managerCount: number
    onSupportClick: () => void
    onSignOut: () => void
    today: { cups: number; revenue: number; prevCups: number; prevRevenue: number; actual: number | null; prevActual: number } | null
}

export default function AddressHeader({ isStaff, isGuest, activeTab, setActiveTab, profile, setError, addressCount, staffCount, managerCount, onSupportClick, onSignOut, today }: Props) {
    const showTabs = !isStaff && !isGuest;
    const [emailOpen, setEmailOpen] = useState(false)
    // ?reopen=<kho> (Back từ trang chi tiết nguyên liệu) → mở lại sheet; AddressNotice tự mở dòng kho đó.
    const { search } = useLocation()
    const [bellOpen, setBellOpen] = useState(() => new URLSearchParams(search).get('reopen') !== null)
    const [pending, setPending] = useState(0) // AddressNotice báo số kho còn việc (đọc cache ngay, rồi cập nhật nền)
    const email = profile?.email
    const actual = today?.actual ?? null

    const tabs = [
        { id: 'branches', label: 'Địa chỉ', count: addressCount },
        { id: 'staff', label: 'Nhân sự', count: managerCount + staffCount },
    ]

    return (
        <header className="shrink-0 pt-3 pb-3 bg-surface border-b border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.03)] relative z-20">
            {/* Hàng nav (cùng kiểu TopNav của POS): pill tên (→ tài khoản) · hỗ trợ · chuông "Việc cần làm" */}
            <div className="px-6 flex items-center gap-2">
                {/* Bấm vào tên → modal Tài khoản (email + đăng xuất) */}
                <button
                    type="button"
                    aria-label="Tài khoản"
                    onClick={() => setEmailOpen(true)}
                    className="flex-1 min-w-0 h-10 px-3.5 flex items-center rounded-[14px] bg-bg border border-border/60 overflow-hidden text-left active:bg-border/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                    <span className="text-[15px] font-black tracking-tight truncate text-text">{profile?.name || '...'}</span>
                    {showTabs && !email && <Mail size={16} className="ml-auto shrink-0 text-warning" aria-hidden />}
                </button>
                <button type="button" aria-label="Hỗ trợ / góp ý" onClick={onSupportClick} className={NAV_ICON_BTN}>
                    <MessageCircleQuestion size={19} />
                </button>
                {showTabs && (
                    <button type="button" aria-label="Việc cần làm" onClick={() => setBellOpen(true)} className={NAV_ICON_BTN}>
                        <Bell size={19} className={pending > 0 ? 'text-primary' : ''} />
                        {pending > 0 && (
                            <span className={`absolute -top-1.5 -right-1.5 h-5 ${pending > 9 ? 'px-1.5' : 'w-5 pl-px'} rounded-full bg-primary text-white text-[11px] font-black flex items-center justify-center leading-none pt-px tabular-nums ring-2 ring-surface`}>{pending}</span>
                        )}
                    </button>
                )}
            </div>

            {showTabs && (
                <>
                    {/* Tổng hôm nay — thẻ cùng kiểu "Nhật ký" của POS */}
                    <div className="px-6 mt-3">
                        <div className="bg-bg rounded-[20px] p-3 sm:p-3.5 border border-border/60 shadow-sm flex flex-col gap-1">
                            <Stat label="Hôm nay bán:" value={today && `${today.cups} ly`} pct={today && deltaPct(today.cups, today.prevCups)} />
                            <Stat label="Doanh thu:" value={today && formatVND(today.revenue)} pct={today && deltaPct(today.revenue, today.prevRevenue)} />
                            <Stat label="Tổng thực thu:" value={actual != null ? formatVND(actual) : null} pct={actual != null && today ? deltaPct(actual, today.prevActual) : null} />
                        </div>
                    </div>
                    {/* Tab — cùng kiểu ReportViewFilter của trang Báo cáo */}
                    <div className="px-6 mt-3">
                        <div className="bg-surface border border-border/60 rounded-[14px] p-1 shadow-sm flex gap-1">
                            {tabs.map(({ id, label, count }) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => { setActiveTab(id); setError('') }}
                                    className={`flex-1 py-2 rounded-[10px] text-[11px] font-black uppercase tracking-wider transition-all duration-150 ${activeTab === id
                                        ? 'bg-primary text-bg shadow-sm'
                                        : 'text-text-secondary hover:text-text hover:bg-border/30'}`}
                                >
                                    <span className="tabular-nums">{count}</span> {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {showTabs && <AddressNotice bell={{ open: bellOpen, onClose: () => setBellOpen(false), onCount: setPending }} />}
            {emailOpen && <AccountModal email={email} canEditEmail={showTabs} onSignOut={onSignOut} onClose={() => setEmailOpen(false)} />}
        </header>
    )
}

// value null = chưa có số (lần tải đầu) → "—", không hiện "0".
function Stat({ label, value, pct }: { label: string; value: string | null; pct: number | null }) {
    return (
        <div className="flex items-baseline gap-1.5 text-sm">
            <span className="text-text-secondary">{label}</span>
            <span className="text-text">{value ?? '—'}</span>
            <Delta pct={pct} />
        </div>
    )
}

const INLINE_BTN = 'w-9 h-9 flex items-center justify-center rounded-[10px] disabled:opacity-50' // nút icon trong ô email

// Modal Tài khoản: email (chỉ quản lý — lưu qua RPC set_my_email) + Đăng xuất (mọi vai trò). Email là đường duy nhất để đặt
// lại mật khẩu, nên tài khoản cũ (email NULL) khai bổ sung ở đây.
function AccountModal({ email, canEditEmail, onSignOut, onClose }: { email?: string | null; canEditEmail: boolean; onSignOut: () => void; onClose: () => void }) {
    const { refreshProfile } = useAuth()
    const [value, setValue] = useState(email || '')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    const changed = value.trim() !== (email || '')

    async function handleSave() {
        if (!value.trim() || busy) return
        setBusy(true)
        setErr('')
        try {
            await setMyEmail(value.trim())
            refreshProfile()
            onClose()
        } catch (e) {
            setErr(errorMessage(e, 'Không lưu được email'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog
            onClose={() => { if (!busy) onClose() }}
            panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
                <ModalHeader icon={User} title="Tài khoản" onClose={onClose} hideClose={busy} />
                <div className="p-5 flex flex-col gap-4">
                    {canEditEmail && (
                        <>
                            {/* Hủy/Lưu nằm trong ô, chỉ hiện khi email đã đổi: ✕ trả về giá trị cũ, ✓ lưu. */}
                            <div className="relative">
                                <Mail size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" aria-hidden />
                                <input
                                    type="email"
                                    placeholder="Email (dùng để đặt lại mật khẩu)"
                                    value={value}
                                    onChange={e => setValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                                    disabled={busy}
                                    className={`w-full pl-11 ${changed ? 'pr-[88px]' : 'pr-4'} py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50`}
                                />
                                {changed && (
                                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-1">
                                        <button type="button" aria-label="Hủy thay đổi" disabled={busy} onClick={() => { setValue(email || ''); setErr('') }} className={`${INLINE_BTN} text-text-secondary hover:bg-surface-light`}>
                                            <X size={16} />
                                        </button>
                                        <button type="button" aria-label="Lưu email" disabled={busy || !value.trim()} onClick={handleSave} className={`${INLINE_BTN} bg-primary text-bg hover:bg-primary/90`}>
                                            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                        </button>
                                    </div>
                                )}
                            </div>
                            {err && <p className="text-danger text-xs font-medium px-1">{err}</p>}
                            <div className="h-px bg-border/60" />
                        </>
                    )}
                    <button
                        type="button"
                        disabled={busy}
                        onClick={onSignOut}
                        className="w-full py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light hover:text-danger transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        <LogOut size={15} className="-scale-x-100" /> Đăng xuất
                    </button>
                </div>
        </Dialog>
    )
}
