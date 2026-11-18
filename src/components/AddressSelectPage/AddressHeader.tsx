import { useState, type ReactNode } from 'react'
import { Mail, Loader2, Check, X, Bell, MessageCircleQuestion, LogOut, User, LayoutDashboard, ChevronDown } from 'lucide-react'
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
    onAdminClick?: () => void // chỉ admin mới truyền
    today: { cups: number; revenue: number; prevCups: number; prevRevenue: number; actual: number | null; prevActual: number } | null
    rangeDays: number
    onRangeChange: (days: number) => void
}

const RANGES = [{ days: 1, label: 'Hôm nay' }, { days: 7, label: 'Tổng 7 ngày' }, { days: 30, label: 'Tổng 30 ngày' }]

export default function AddressHeader({ isStaff, isGuest, activeTab, setActiveTab, profile, setError, addressCount, staffCount, managerCount, onSupportClick, onSignOut, onAdminClick, today, rangeDays, onRangeChange }: Props) {
    const showTabs = !isStaff && !isGuest;
    const vs = rangeDays === 1 ? undefined : `So với ${rangeDays} ngày liền trước`
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
            {/* Hàng nav (cùng kiểu TopNav của POS): pill tên (→ tài khoản) · hỗ trợ · chuông · admin "Việc cần làm" */}
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
                {onAdminClick && (
                    <button type="button" aria-label="Admin Dashboard" onClick={onAdminClick} className={NAV_ICON_BTN}>
                        <LayoutDashboard size={19} />
                    </button>
                )}
            </div>

            {showTabs && (
                <>
                    {/* Tổng hôm nay — thẻ cùng kiểu "Nhật ký" của POS */}
                    <div className="px-6 mt-3">
                        <div className="relative bg-bg rounded-[20px] p-3 sm:p-3.5 border border-border/60 shadow-sm flex flex-col gap-1">
                            <RangeRow days={rangeDays} onChange={onRangeChange}>
                                <Stat label="bán:" value={today && `${today.cups.toLocaleString('vi-VN')} ly`} pct={today && deltaPct(today.cups, today.prevCups)} vs={vs} />
                            </RangeRow>
                            <Stat label="Doanh thu:" value={today && formatVND(today.revenue)} pct={today && deltaPct(today.revenue, today.prevRevenue)} vs={vs} />
                            <Stat label="Tổng thực thu:" value={actual != null ? formatVND(actual) : null} pct={actual != null && today ? deltaPct(actual, today.prevActual) : null} vs={rangeDays === 1 ? 'So với cả ngày hôm qua' : vs} />
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
function Stat({ label, value, pct, vs }: { label: string; value: string | null; pct: number | null; vs?: string }) {
    return (
        <div className="flex items-baseline gap-1.5 text-sm whitespace-nowrap">
            <span className="text-text-secondary">{label}</span>
            <span className="text-text">{value ?? '—'}</span>
            <Delta pct={pct} title={vs} />
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

// Dòng đầu thẻ tổng: bấm cả dòng (mũi tên ở mép phải) để chọn khoảng thời gian; menu thả xuống, backdrop trong suốt để bấm ra ngoài là đóng.
function RangeRow({ days, onChange, children }: { days: number; onChange: (days: number) => void; children: ReactNode }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="relative z-30">
            <div
                role="button"
                tabIndex={0}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}
                className="flex items-center gap-1 cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"            >
                <span className="text-sm text-text-secondary whitespace-nowrap">{RANGES.find(r => r.days === days)?.label}</span>
                {children}
                <ChevronDown size={16} className={`ml-auto shrink-0 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
            </div>
            {open && (
                <>
                    <div className="fixed inset-0" onClick={() => setOpen(false)} />
                    <ul role="listbox" className="absolute right-0 top-full mt-2 w-44 p-1 rounded-[14px] bg-surface border border-border/60 shadow-xl">
                        {RANGES.map(r => (
                            <li key={r.days} role="option" aria-selected={r.days === days}>
                                <button
                                    type="button"
                                    onClick={() => { onChange(r.days); setOpen(false) }}
                                    className={`w-full h-9 px-3 flex items-center justify-between rounded-[10px] text-xs font-bold ${r.days === days ? 'bg-primary/10 text-primary' : 'text-text hover:bg-border/30'}`}
                                >
                                    {r.label}
                                    {r.days === days && <Check size={14} aria-hidden />}
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    )
}
