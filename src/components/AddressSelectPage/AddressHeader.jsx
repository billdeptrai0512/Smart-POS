import { useState } from 'react'
import { Building2, Users, Phone, Loader2, Check, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { setMyPhone } from '../../services/authService'

// Hiển thị SĐT dạng nội địa: +84902822193 → 0902 822 193 (DB vẫn giữ E.164).
function formatPhoneVN(p) {
    let d = (p || '').replace(/\D/g, '')
    if (d.startsWith('84')) d = '0' + d.slice(2)
    return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : (p || '')
}

export default function AddressHeader({ isStaff, isGuest, activeTab, setActiveTab, profile, setError, addressCount, staffCount, managerCount }) {
    const showTabs = !isStaff && !isGuest;
    const [phoneOpen, setPhoneOpen] = useState(false)
    const phone = profile?.phone

    // Value: focus → text-text 85%, không focus → secondary. Icon: focus → primary (accent), không focus → secondary.
    const valColor = (on) => on ? 'text-text opacity-[0.85]' : 'text-text-secondary'
    const iconColor = (on) => on ? 'text-primary' : 'text-text-secondary'

    return (
        <header className="shrink-0 pt-6 pb-6 bg-surface border-b border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.03)] relative z-20">
            <div className="px-6">
                {showTabs ? (
                    <div className="grid grid-cols-2 gap-3">
                        {/* Card trái: user + Cơ sở tab */}
                        <button
                            onClick={() => { setActiveTab('branches'); setError('') }}
                            className={`rounded-[20px] p-3 sm:p-3.5 border text-left flex flex-col justify-between gap-[2px] relative overflow-hidden transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${activeTab === 'branches'
                                ? 'bg-primary/5 border-primary/20 shadow-[0_4px_20px_rgba(242,119,77,0.08)]'
                                : 'bg-bg border-border/60 hover:bg-surface-light'}`}
                        >
                            <div className="flex flex-col justify-between items-start relative z-10 mb-[8px] gap-[3px]">
                                <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">Xin chào</span>
                                <span className={`text-[15px] sm:text-[16px] font-black tracking-tight leading-tight ${valColor(activeTab === 'branches')}`}>
                                    {profile?.name || '...'}
                                </span>
                            </div>
                            <div className={`w-full h-[1px] rounded-full relative z-10 my-[3px] mt-[4px] ${activeTab === 'branches' ? 'bg-primary/20' : 'bg-border/60'}`} />
                            <div className="flex flex-col justify-between items-start relative z-10 mt-[2px] w-full gap-[3px]">
                                <span className="text-[12px] sm:text-[13px] text-text-secondary font-black uppercase tracking-wider">Địa chỉ</span>
                                <div className="flex items-center gap-1.5">
                                    <Building2 size={15} className={iconColor(activeTab === 'branches')} />
                                    <span className={`text-[14px] sm:text-[14px] font-black uppercase tracking-wider ${valColor(activeTab === 'branches')}`}>
                                        {addressCount}
                                    </span>
                                </div>
                            </div>


                            {activeTab === 'branches' && (
                                <div className="absolute bottom-0 right-0 w-20 h-20 bg-primary/10 rounded-full blur-2xl -mr-8 -mb-8 pointer-events-none" />
                            )}
                        </button>

                        {/* Card phải: SĐT (mở modal) + Nhân sự tab */}
                        <button
                            onClick={() => { setActiveTab('staff'); setError('') }}
                            className={`rounded-[20px] p-3 sm:p-3.5 border text-left flex flex-col justify-between gap-[2px] relative overflow-hidden transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${activeTab === 'staff'
                                ? 'bg-primary/5 border-primary/20 shadow-[0_4px_20px_rgba(242,119,77,0.08)]'
                                : 'bg-bg border-border/60 hover:bg-surface-light'}`}
                        >
                            {/* SĐT — span role=button (tránh button lồng button gây hydration error) */}
                            <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); setPhoneOpen(true) }}
                                className="flex flex-col items-start relative z-10 mb-[8px] w-full cursor-pointer gap-[3px]"
                            >
                                <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider truncate w-full">Điện thoại</span>
                                <span className={`text-[14px] sm:text-[14px] font-black tracking-tight leading-tight truncate w-full ${phone ? valColor(activeTab === 'staff') : 'text-text-secondary/60'}`}>
                                    {phone ? formatPhoneVN(phone) : '—'}
                                </span>
                            </span>
                            <div className={`w-full h-[1px] rounded-full relative z-10 my-[2px]  ${activeTab === 'staff' ? 'bg-primary/20' : 'bg-border/60'}`} />
                            <div className="flex flex-col justify-between items-start relative z-10 mt-[2px] w-full gap-[3px]">
                                <span className="text-[12px] sm:text-[13px] text-text-secondary font-black uppercase tracking-wider">Nhân sự</span>
                                <div className="flex items-center gap-1.5">
                                    <Users size={15} className={iconColor(activeTab === 'staff')} />
                                    <span className={`text-[14px] sm:text-[14px] font-black uppercase tracking-wider ${valColor(activeTab === 'staff')}`}>
                                        {managerCount + staffCount}
                                    </span>
                                </div>
                            </div>
                            {activeTab === 'staff' && (
                                <div className="absolute bottom-0 right-0 w-20 h-20 bg-primary/10 rounded-full blur-2xl -mr-8 -mb-8 pointer-events-none" />
                            )}
                        </button>
                    </div>
                ) : (
                    /* Staff: simple header, no tab */
                    <div className="bg-bg border border-border/60 rounded-[20px] p-3 sm:p-3.5">
                        <div className="flex flex-col justify-between items-start">
                            <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">Xin chào</span>
                            <span className="text-[15px] sm:text-[16px] text-text font-black tracking-tight leading-none">{profile?.name || '...'}</span>
                        </div>
                        <div className="w-full h-[1px] bg-border/60 rounded-full my-[3px] mt-[4px]" />
                        <div className="flex items-center gap-1.5 mt-[6px]">
                            <Building2 size={13} className="text-text-secondary" />
                            <span className="text-[12px] sm:text-[13px] font-black text-text-secondary uppercase tracking-wider">Chọn địa chỉ</span>
                        </div>
                    </div>
                )}
            </div>

            {phoneOpen && <PhoneModal phone={phone} onClose={() => setPhoneOpen(false)} />}
        </header>
    )
}

// CRUD SĐT tài khoản — lưu qua RPC set_my_phone (1 SĐT = 1 lần được cấp trial).
function PhoneModal({ phone, onClose }) {
    const { refreshProfile } = useAuth()
    const [value, setValue] = useState(formatPhoneVN(phone))
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState('')
    const [err, setErr] = useState('')

    async function handleSave() {
        if (!value.trim() || busy) return
        setBusy(true)
        setErr('')
        setNotice('')
        try {
            const result = await setMyPhone(value.trim())
            refreshProfile()
            if (result === 'trial_granted') {
                setNotice('Đã kích hoạt 7 ngày dùng thử báo cáo 🎉')
            } else {
                onClose()
            }
        } catch (e) {
            setErr(e.message || 'Không thể lưu số điện thoại')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!busy) onClose() }} />
            <div className="relative w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center">
                            <Phone size={15} className="text-primary" />
                        </div>
                        <p className="text-text font-black text-sm leading-none">Số điện thoại</p>
                    </div>
                    {!busy && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div className="p-5 flex flex-col gap-4">
                    <input
                        type="tel"
                        autoFocus
                        placeholder="Số điện thoại (vd: 0901234567)"
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                        disabled={busy}
                        className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                    />
                    {notice && <p className="text-primary text-xs font-bold px-1">{notice}</p>}
                    {err && <p className="text-danger text-xs font-medium px-1">{err}</p>}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={onClose}
                            className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                        >
                            {notice ? 'Đóng' : 'Hủy'}
                        </button>
                        <button
                            type="button"
                            disabled={busy || !value.trim()}
                            onClick={handleSave}
                            className="flex-1 py-3 rounded-[14px] bg-primary text-bg font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Lưu</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
