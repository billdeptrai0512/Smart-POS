import { useState } from 'react'
import { Users, Copy, Check, Loader, UserPlus, Shield, MoreVertical, ArrowUp, ArrowDown, Trash2, X } from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import Skeleton from '../common/Skeleton'
import MonetizationToggle from './MonetizationToggle'
import AccountCard from './AccountCard'

function InviteLink({ link, expiry }) {
    const [copied, setCopied] = useState(false)

    async function handleCopy() {
        await navigator.clipboard.writeText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    if (!link) return null

    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <input
                    readOnly
                    value={link}
                    onFocus={e => e.target.select()}
                    className="flex-1 min-w-0 px-2 py-1 rounded-[10px] bg-bg border border-border/60 text-text-secondary text-sm font-medium focus:outline-none focus:border-primary/40 truncate"
                />
                <button
                    onClick={handleCopy}
                    className="px-2 py-1 bg-primary text-black text-xs font-black rounded-[10px] shrink-0 hover:bg-primary/90 active:scale-95 transition-all flex items-center gap-1.5"
                    title="Sao chép link"
                >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
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

// Slide-up sheet for managing one member: promote/demote + remove, each behind a confirm tap.
function MemberActionSheet({ member, onSetRole, onRemove, onClose }) {
    const [pending, setPending] = useState(null) // { type, role, message, danger }
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    const isStaff = member.role === 'staff'
    const roleAction = isStaff
        ? { type: 'promote', role: 'manager', label: 'Thăng lên quản lý', icon: ArrowUp, message: `Thăng "${member.name}" lên quản lý?` }
        : { type: 'demote', role: 'staff', label: 'Hạ xuống nhân viên', icon: ArrowDown, message: `Hạ "${member.name}" xuống nhân viên?` }

    async function handleConfirm() {
        setBusy(true)
        setErr('')
        try {
            if (pending.type === 'remove') await onRemove(member.id)
            else await onSetRole(member.id, pending.role)
            onClose()
        } catch (e) {
            setErr(e?.message || 'Thao tác thất bại')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={() => !busy && onClose()}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <span className="text-[16px] font-black text-text truncate">{member.name}</span>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all disabled:opacity-50 shrink-0"
                    >
                        <X size={16} />
                    </button>
                </div>

                {pending ? (
                    <div className="flex flex-col gap-4">
                        <p className="text-[14px] font-medium text-text-secondary">{pending.message}</p>
                        <ErrorBanner message={err} small />
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setPending(null); setErr('') }}
                                disabled={busy}
                                className="flex-1 py-3 rounded-[12px] bg-surface-light border border-border/60 text-text text-[14px] font-black hover:bg-bg transition-colors disabled:opacity-50 uppercase"
                            >
                                Huỷ
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={busy}
                                className={`flex-1 py-3 rounded-[12px] text-[14px] font-black transition-colors disabled:opacity-50 uppercase flex items-center justify-center gap-1.5 ${pending.danger
                                    ? 'bg-danger text-white hover:bg-danger/90'
                                    : 'bg-primary text-bg hover:bg-primary/90'}`}
                            >
                                {busy ? <><Loader size={13} className="animate-spin" /> Đang xử lý...</> : 'Xác nhận'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={() => setPending(roleAction)}
                            className="w-full py-3 px-3 rounded-[12px] bg-surface-light border border-border/60 text-text text-[14px] font-bold hover:bg-bg transition-colors flex items-center gap-2.5"
                        >
                            <roleAction.icon size={16} className="text-primary" />
                            {roleAction.label}
                        </button>
                        <button
                            onClick={() => setPending({ type: 'remove', danger: true, message: `Xoá "${member.name}" khỏi cửa hàng? Hành động này không thể hoàn tác.` })}
                            className="w-full py-3 px-3 rounded-[12px] bg-danger/10 border border-danger/20 text-danger text-[14px] font-bold hover:bg-danger/15 transition-colors flex items-center gap-2.5"
                        >
                            <Trash2 size={16} />
                            Xoá khỏi cửa hàng
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

const TABS = [
    { key: 'staff', label: 'Nhân viên', role: 'staff', icon: UserPlus },
    { key: 'co-manager', label: 'Quản lý', role: 'co-manager', icon: Shield },
]

export default function StaffTab({
    staffList, staffLoading, error,
    staffInviteLink, staffInviteExpiry,
    coManagerInviteLink, coManagerInviteExpiry,
    onSetMemberRole, onRemoveMember,
    subTab, setSubTab,
}) {
    const [actionMember, setActionMember] = useState(null)

    const staffMembers = staffList.filter(s => s.role === 'staff')
    const coManagers = staffList.filter(s => s.role === 'manager')
    const members = subTab === 'staff' ? staffMembers : coManagers

    const isStaffTab = subTab === 'staff'
    const link = isStaffTab ? staffInviteLink : coManagerInviteLink
    const expiry = isStaffTab ? staffInviteExpiry : coManagerInviteExpiry

    return (
        <div className="space-y-3">
            {/* SĐT tài khoản (nhập/sửa — gắn trial 1 SĐT = 1 lần) */}
            <AccountCard />

            {/* Admin-only: công tắc thu phí (server kill switch). Tự ẩn nếu không phải admin. */}
            <MonetizationToggle />

            {/* Sub-tabs */}
            <div className="flex gap-2 bg-surface border border-border/60 rounded-[16px] p-1.5">
                {TABS.map(tab => {
                    const active = subTab === tab.key
                    const count = tab.key === 'staff' ? staffMembers.length : coManagers.length
                    const Icon = tab.icon
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setSubTab(tab.key)}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[12px] text-xs font-black transition-all ${active
                                ? 'bg-primary/10 text-primary border border-primary/20'
                                : 'text-text-secondary hover:bg-bg border border-transparent'}`}
                        >
                            <Icon size={13} />
                            <span>{tab.label}</span>
                            <span className={`text-[10px] font-bold tabular-nums ${active ? 'text-primary/70' : 'text-text-secondary/70'}`}>
                                ({count})
                            </span>
                        </button>
                    )
                })}
            </div>

            {/* Member list */}
            <div className="bg-surface border border-border/60 rounded-[20px] overflow-hidden">
                {staffLoading ? (
                    <div className="p-3 flex flex-col gap-2">
                        <Skeleton className="h-12 rounded-[12px]" />
                        <Skeleton className="h-12 rounded-[12px]" />
                    </div>
                ) : members.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                        <Users size={20} className="text-text-secondary/60 mx-auto mb-2" />
                        <p className="text-text-secondary text-sm font-medium">
                            {isStaffTab ? 'Chưa có nhân viên nào' : 'Chưa có quản lý nào'}
                        </p>
                        <p className="text-text-secondary/70 text-xs mt-0.5">
                            Tạo link bên dưới để mời người mới
                        </p>
                    </div>
                ) : (
                    <div className="p-3 flex flex-col gap-2">
                        {members.map(member => (
                            <div key={member.id} className="p-2.5 flex items-center gap-2.5 bg-bg rounded-[12px] border border-border/40">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${member.role === 'manager' ? 'bg-blue-500/10' : 'bg-primary/10'}`}>
                                    <span className={`text-sm font-black ${member.role === 'manager' ? 'text-blue-500' : 'text-primary'}`}>
                                        {member.name.charAt(0).toUpperCase()}
                                    </span>
                                </div>
                                <span className="flex-1 text-text text-sm font-bold truncate">{member.name}</span>
                                <button
                                    onClick={() => setActionMember(member)}
                                    className="w-8 h-8 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-light hover:text-text active:scale-95 transition-all shrink-0"
                                    title="Tuỳ chọn"
                                >
                                    <MoreVertical size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Generated invite link (button to generate lives in the bottom bar) */}
            {(link || error) && (
                <div className="bg-surface border border-border/60 rounded-[20px] p-2 space-y-3">
                    {link && <InviteLink link={link} expiry={expiry} />}
                    <ErrorBanner message={error} small />
                </div>
            )}

            {actionMember && (
                <MemberActionSheet
                    member={actionMember}
                    onSetRole={onSetMemberRole}
                    onRemove={onRemoveMember}
                    onClose={() => setActionMember(null)}
                />
            )}
        </div>
    )
}
