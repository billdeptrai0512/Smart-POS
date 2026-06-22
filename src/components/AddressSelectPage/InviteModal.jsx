import { useState } from 'react'
import { Shield, UserPlus, Loader, Copy, Check } from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'

const ROLES = [
    { key: 'co-manager', label: 'Quản lý', icon: Shield },
    { key: 'staff', label: 'Nhân viên', icon: UserPlus },
]

function InviteLink({ link, expiry }) {
    const [copied, setCopied] = useState(false)

    async function handleCopy() {
        await navigator.clipboard.writeText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <input
                    readOnly
                    value={link}
                    onFocus={e => e.target.select()}
                    className="flex-1 min-w-0 px-2 py-2 rounded-[10px] bg-bg border border-border/60 text-text-secondary text-sm font-medium focus:outline-none focus:border-primary/40 truncate"
                />
                <button
                    onClick={handleCopy}
                    className="px-3 bg-primary text-black text-xs font-black rounded-[10px] shrink-0 hover:bg-primary/90 active:scale-95 transition-all flex items-center gap-1.5"
                    title="Sao chép link"
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
            </div>
            {expiry && (
                <p className="text-text-secondary text-[11px] text-center">
                    Hết hạn lúc{' '}
                    <span className="font-bold text-text">
                        {expiry.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                </p>
            )}
        </div>
    )
}

// Modal mời nhân sự: chọn vai trò (toggle) → tạo link → hiện URL ngay trong modal.
export default function InviteModal({
    onClose,
    staffInviteLink, staffInviteExpiry,
    coManagerInviteLink, coManagerInviteExpiry,
    generatingStaff, generatingCoManager, error,
}) {
    const [role, setRole] = useState('staff')
    const isCo = role === 'co-manager'
    const link = isCo ? coManagerInviteLink : staffInviteLink
    const expiry = isCo ? coManagerInviteExpiry : staffInviteExpiry
    const generating = isCo ? generatingCoManager : generatingStaff

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!generating) onClose() }} />
            <div className="relative w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
                <div className="p-4">
                    {/* Toggle vai trò — màu khớp pill: quản lý xanh, nhân viên cam */}
                    <div className="flex gap-2 bg-bg border border-border/60 rounded-[14px] p-1.5">
                        {ROLES.map(r => {
                            const active = role === r.key
                            const Icon = r.icon
                            const blue = r.key === 'co-manager'
                            return (
                                <button
                                    key={r.key}
                                    onClick={() => setRole(r.key)}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[10px] text-xs font-black transition-all ${active
                                        ? (blue ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'bg-primary/10 text-primary border border-primary/20')
                                        : 'text-text-secondary hover:bg-surface-light border border-transparent'}`}
                                >
                                    <Icon size={13} /> {r.label}
                                </button>
                            )
                        })}
                    </div>
                </div>
                <div className="px-4 pb-5 flex flex-col gap-4">
                    {generating && !link ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-text-secondary text-sm font-medium">
                            <Loader size={14} className="animate-spin" /> Đang tạo link...
                        </div>
                    ) : link ? (
                        <InviteLink link={link} expiry={expiry} />
                    ) : (
                        <p className="text-text-secondary/70 text-xs text-center py-4">Chưa tạo được link {isCo ? 'quản lý' : 'nhân viên'}.</p>
                    )}
                    <ErrorBanner message={error} small />
                </div>
            </div>
        </div>
    )
}
