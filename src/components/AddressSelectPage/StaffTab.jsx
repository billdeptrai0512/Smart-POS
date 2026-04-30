import { useState } from 'react'
import { Users, Copy, Check, Loader, UserPlus, Shield, LinkIcon } from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import Skeleton from '../common/Skeleton'

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

const TABS = [
    { key: 'staff', label: 'Nhân viên', role: 'staff', icon: UserPlus },
    { key: 'co-manager', label: 'Quản lý', role: 'co-manager', icon: Shield },
]

export default function StaffTab({
    staffList, staffLoading, error,
    onGenerateInvite,
    staffInviteLink, staffInviteExpiry, generatingStaffLink,
    coManagerInviteLink, coManagerInviteExpiry, generatingCoManagerLink,
}) {
    const [subTab, setSubTab] = useState('staff')

    const staffMembers = staffList.filter(s => s.role === 'staff')
    const coManagers = staffList.filter(s => s.role === 'manager')
    const members = subTab === 'staff' ? staffMembers : coManagers

    const isStaffTab = subTab === 'staff'
    const link = isStaffTab ? staffInviteLink : coManagerInviteLink
    const expiry = isStaffTab ? staffInviteExpiry : coManagerInviteExpiry
    const generating = isStaffTab ? generatingStaffLink : generatingCoManagerLink
    const ActiveIcon = isStaffTab ? UserPlus : Shield

    return (
        <div className="space-y-3">
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
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Invite section */}
            <div className="bg-surface border border-border/60 rounded-[20px] p-2 space-y-3">

                {link ? (
                    <InviteLink link={link} expiry={expiry} />
                ) : (
                    <button
                        onClick={() => onGenerateInvite(isStaffTab ? 'staff' : 'co-manager')}
                        disabled={generating}
                        className="w-full py-3 rounded-[14px] bg-primary/10 border border-primary/20 text-primary font-black text-sm hover:bg-primary/15 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {generating
                            ? <><Loader size={14} className="animate-spin" /> Đang tạo...</>
                            : isStaffTab
                                ? 'Mời nhân viên'
                                : 'Mời quản lý'
                        }
                    </button>
                )}

                <ErrorBanner message={error} small />
            </div>
        </div>
    )
}
