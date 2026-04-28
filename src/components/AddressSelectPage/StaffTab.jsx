import { useState } from 'react'
import { Users, Copy, Check, Loader } from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import Skeleton from '../common/Skeleton'

export default function StaffTab({
    staffList, staffLoading, error,
    onGenerateInvite, generatingLink, inviteLink, inviteExpiry,
}) {
    const [copied, setCopied] = useState(false)

    async function handleCopy() {
        await navigator.clipboard.writeText(inviteLink)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className="space-y-3">
            {/* Staff list */}
            <div className="bg-surface border border-border/60 rounded-[20px] overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40">
                    <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Danh sách nhân viên</p>
                </div>
                {staffLoading ? (
                    <div className="p-4 grid grid-cols-2 gap-3">
                        <Skeleton className="h-12 rounded-[12px]" />
                        <Skeleton className="h-12 rounded-[12px]" />
                    </div>
                ) : staffList.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                        <Users size={20} className="text-text-secondary mx-auto mb-2" />
                        <p className="text-text-secondary text-sm">Chưa có nhân viên nào</p>
                    </div>
                ) : (
                    <div className="p-3 grid grid-cols-2 gap-2">
                        {staffList.map(staff => (
                            <div key={staff.id} className="p-2.5 flex items-center gap-2.5 bg-bg rounded-[12px] border border-border/40">
                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                    <span className="text-primary text-xs font-black">{staff.name.charAt(0).toUpperCase()}</span>
                                </div>
                                <span className="text-text text-sm font-medium truncate">{staff.name}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Invite section */}
            <div className="bg-surface border border-border/60 rounded-[20px] p-4 space-y-3">
                <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Mời nhân viên mới</p>
                <button
                    onClick={onGenerateInvite}
                    disabled={generatingLink}
                    className="w-full py-3 rounded-[14px] bg-primary/10 border border-primary/20 text-primary font-black text-sm hover:bg-primary/15 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {generatingLink ? <><Loader size={14} className="animate-spin" /> Đang tạo...</> : 'Tạo link mời'}
                </button>

                {inviteLink && (
                    <div className="space-y-2">
                        <div className="flex gap-2">
                            <input
                                readOnly
                                value={inviteLink}
                                className="flex-1 min-w-0 px-3 py-2 rounded-[10px] bg-bg border border-border/60 text-text-secondary text-xs font-medium focus:outline-none truncate"
                            />
                            <button
                                onClick={handleCopy}
                                className="px-3 py-2 bg-primary text-black text-xs font-black rounded-[10px] shrink-0 hover:bg-primary/90 transition-colors flex items-center gap-1.5"
                            >
                                {copied ? <><Check size={13} /> Đã sao chép</> : <><Copy size={13} /> Sao chép</>}
                            </button>
                        </div>
                        {inviteExpiry && (
                            <p className="text-text-secondary text-xs text-center">
                                Hết hạn: {inviteExpiry.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </p>
                        )}
                    </div>
                )}

                <ErrorBanner message={error} small />
            </div>
        </div>
    )
}
