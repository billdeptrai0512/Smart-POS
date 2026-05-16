import { useRef, useState } from 'react'
import {
    Pencil, Trash2, ClipboardCopy, MoreHorizontal, X,
    Coffee, Loader, FileText,
    ArrowRight,
} from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import { formatVND } from '../../utils'
import SubscriptionBadge from './SubscriptionBadge'
import UpsellSheet from '../common/UpsellSheet'

export default function BranchGrid({
    addresses, fetchError, cupsMap, revenueMap, sessionsMap, statsLoading,
    isStaff, isAdmin, error, setError,
    onSelect, onSelectReport, onSelectHistory, onSelectIngredients, onBackup, onRename, onRemove, onDefaultTemplate,
}) {
    const [editingAddressId, setEditingAddressId] = useState(null)
    const [editName, setEditName] = useState('')
    const [renaming, setRenaming] = useState(false)
    const [deletingAddressId, setDeletingAddressId] = useState(null)
    const [expandedActionsId, setExpandedActionsId] = useState(null) // which card has the 3-action menu open
    const [upsellForAddress, setUpsellForAddress] = useState(null)
    const submitGuardRef = useRef(false)

    async function handleRename(e, addrId) {
        e.preventDefault()
        if (!editName.trim()) return
        if (submitGuardRef.current) return
        submitGuardRef.current = true
        setRenaming(true)
        setError('')
        try {
            await onRename(addrId, editName.trim())
            setEditingAddressId(null)
        } catch (err) {
            setError(err.message || 'Không thể đổi tên')
        } finally {
            setRenaming(false)
            submitGuardRef.current = false
        }
    }

    return (
        <>
            <div className="grid grid-cols-1 gap-3 mb-4">
                {addresses.length === 0 && (
                    fetchError ? (
                        <div className="bg-surface border border-danger/40 rounded-[20px] p-6 text-center">
                            <p className="text-danger text-sm font-bold mb-1">Không tải được danh sách địa chỉ</p>
                            <p className="text-text-secondary text-xs">{fetchError}</p>
                        </div>
                    ) : (
                        <div className="bg-surface border border-border/60 rounded-[20px] p-6 text-center">
                            <Coffee size={24} className="text-text-secondary mx-auto mb-2" />
                            <p className="text-text-secondary text-sm">Chưa có địa chỉ nào. Tạo địa chỉ mới để bắt đầu!</p>
                        </div>
                    )
                )}

                {addresses.map(addr => {
                    const cups = cupsMap[addr.id] || 0
                    const revenue = revenueMap[addr.id] || 0
                    const staffNames = sessionsMap[addr.id] || []
                    const isEditing = editingAddressId === addr.id
                    // Stale-while-revalidate: only hide stats on initial load.
                    // Once cupsMap has any value (incl. 0), keep rendering it
                    // during background refreshes (visibilitychange refetch).
                    const hasStats = cupsMap[addr.id] !== undefined

                    return (
                        <div
                            key={addr.id}
                            className="bg-surface border border-border/60 rounded-[20px] overflow-hidden shadow-sm group hover:border-border/80 hover:shadow-[0_4px_20px_rgba(0,0,0,0.15)] transition-all flex flex-col"
                        >
                            {isEditing ? (
                                <form
                                    className="flex flex-col p-3 gap-2 h-full"
                                    onSubmit={(e) => handleRename(e, addr.id)}
                                >
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        disabled={renaming}
                                        className="w-full px-3 py-2 rounded-[10px] bg-bg border border-border/60 text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                                        autoFocus
                                    />
                                    <div className="flex gap-2 mt-auto">
                                        <button
                                            type="button"
                                            disabled={renaming}
                                            onClick={() => { setEditingAddressId(null); setError('') }}
                                            className="flex-1 py-2 bg-bg border border-border/60 text-text-secondary text-xs font-bold rounded-[10px] disabled:opacity-50"
                                        >
                                            Hủy
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={renaming || !editName.trim()}
                                            className="flex-1 py-2 bg-primary text-black text-xs font-black rounded-[10px] disabled:opacity-50 flex items-center justify-center gap-1"
                                        >
                                            {renaming ? <Loader size={12} className="animate-spin" /> : 'Lưu'}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <>
                                    {/* Main click area */}
                                    <button
                                        onClick={() => onSelect(addr)}
                                        className="flex-1 p-3.5 text-left hover:bg-surface-light active:bg-border/30 transition-colors min-w-0"
                                    >
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <span className="text-text font-black text-sm transition-colors line-clamp-2 leading-tight truncate">{addr.name}</span>
                                            <ArrowRight size={20} strokeWidth={2.5} className="text-text shrink-0" />
                                        </div>


                                        {/* Subscription status badge */}
                                        <SubscriptionBadge
                                            addressId={addr.id}
                                            onRenewClick={() => setUpsellForAddress(addr.id)}
                                        />
                                        {hasStats && (
                                            <div className="flex flex-col  gap-1 mt-2">

                                                <span className="flex  items-center gap-1 text-text-secondary text-sm">
                                                    Đã bán: <span className="font-bold">{cups}</span> ly
                                                </span>
                                                <span className="flex items-center gap-1 text-text-secondary text-sm">
                                                    Doanh thu: <span className="font-bold">{formatVND(revenue)}</span>
                                                </span>
                                                {staffNames.length > 0 && (
                                                    <div className="flex items-center gap-1 min-w-0">
                                                        <span className="text-text-secondary text-sm shrink-0">Nhân viên:</span>
                                                        <span className="text-[11px] font-bold bg-surface-light border border-border/60 rounded-full px-2 py-0.5 text-text leading-none truncate">
                                                            {staffNames[0]}
                                                        </span>
                                                        {staffNames.length > 1 && (
                                                            <span className="text-[11px] font-bold bg-surface-light border border-border/60 rounded-full px-2 py-0.5 text-text leading-none shrink-0">
                                                                +{staffNames.length - 1}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}

                                            </div>
                                        )}
                                    </button>

                                    {/* Action buttons */}
                                    {!isStaff && (
                                        <div className="border-t border-border/40 px-2 py-1.5">
                                            {deletingAddressId === addr.id ? (
                                                /* Delete-confirm: full-width 2-col grid so tap targets are clear on small screens */
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setDeletingAddressId(null) }}
                                                        className="py-2 bg-bg border border-border/60 text-text-secondary text-[12px] font-bold rounded-[10px] hover:bg-surface-light transition-colors"
                                                    >
                                                        Hủy
                                                    </button>
                                                    <button
                                                        onClick={async (e) => {
                                                            e.stopPropagation()
                                                            try {
                                                                await onRemove(addr.id)
                                                            } catch (err) {
                                                                setError(err.message || 'Không thể xóa địa chỉ')
                                                            } finally {
                                                                setDeletingAddressId(null)
                                                            }
                                                        }}
                                                        className="py-2 bg-danger text-white text-[12px] font-black rounded-[10px] hover:bg-danger/90 transition-colors"
                                                    >
                                                        Xác nhận xóa
                                                    </button>
                                                </div>
                                            ) : expandedActionsId === addr.id ? (
                                                /* Expanded: equal-width grid takes over full row. Báo cáo/Tồn kho temporarily hidden
                                                   to free space on small screens. Each cell has icon+label for discoverability and
                                                   ~44px tap target. */
                                                <div className="grid grid-cols-4 gap-1">
                                                    <ActionCell
                                                        icon={<ClipboardCopy size={16} />}
                                                        label="Sao lưu"
                                                        color="text-primary"
                                                        bg="hover:bg-primary/10 active:bg-primary/15"
                                                        onClick={(e) => { e.stopPropagation(); onBackup(addr); setExpandedActionsId(null) }}
                                                    />
                                                    <ActionCell
                                                        icon={<Pencil size={16} />}
                                                        label="Đổi tên"
                                                        color="text-primary"
                                                        bg="hover:bg-primary/10 active:bg-primary/15"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setEditingAddressId(addr.id)
                                                            setEditName(addr.name)
                                                            setDeletingAddressId(null)
                                                            setExpandedActionsId(null)
                                                            setError('')
                                                        }}
                                                    />
                                                    <ActionCell
                                                        icon={<Trash2 size={16} />}
                                                        label="Xóa"
                                                        color="text-danger"
                                                        bg="hover:bg-danger/10 active:bg-danger/15"
                                                        onClick={(e) => { e.stopPropagation(); setDeletingAddressId(addr.id); setExpandedActionsId(null) }}
                                                    />
                                                    <ActionCell
                                                        icon={<X size={16} />}
                                                        label="Đóng"
                                                        color="text-text-secondary"
                                                        bg="hover:bg-surface-light active:bg-border/30"
                                                        onClick={(e) => { e.stopPropagation(); setExpandedActionsId(null) }}
                                                    />
                                                </div>
                                            ) : (
                                                /* Default: Báo cáo / Tồn kho on left, MoreHorizontal on right */
                                                <div className="flex items-center justify-between gap-2 px-1.5">
                                                    {onSelectReport && (
                                                        <div className='flex gap-2'>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onSelectReport(addr) }}
                                                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] bg-success/5 border border-success/20 hover:bg-success/15 transition-all group"
                                                                title="Xem báo cáo ngày"
                                                            >
                                                                <span className="text-[10px] font-black text-success uppercase leading-none opacity-80 group-hover:opacity-100">Báo cáo</span>
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onSelectIngredients?.(addr) }}
                                                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] bg-primary/5 border border-primary/20 hover:bg-primary/15 transition-all group"
                                                                title="Xem tồn kho"
                                                            >
                                                                <span className="text-[10px] font-black text-primary uppercase leading-none opacity-80 group-hover:opacity-100">Tồn kho</span>
                                                            </button>
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setExpandedActionsId(addr.id) }}
                                                        className="w-9 h-9 flex items-center justify-center text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light active:bg-border/30 shrink-0"
                                                        title="Thao tác khác"
                                                        aria-label="Mở menu thao tác"
                                                    >
                                                        <MoreHorizontal size={18} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )
                })}
                {/* Admin: Mẫu mặc định card */}
                {isAdmin && (
                    <button
                        onClick={onDefaultTemplate}
                        className="bg-surface border border-dashed border-border/80 rounded-[20px] overflow-hidden shadow-sm flex flex-col items-center justify-center p-4 gap-2 hover:bg-surface-light hover:border-primary/30 active:bg-border/30 transition-all min-h-[100px]"
                    >
                        <FileText size={20} className="text-text-secondary" />
                        <span className="text-text-secondary font-bold text-sm">Mẫu mặc định</span>
                    </button>
                )}
            </div>

            <ErrorBanner message={error} small className="mb-3" />

            {/* UpsellSheet — opens when user clicks a subscription banner */}
            <UpsellSheet
                open={!!upsellForAddress}
                onClose={() => setUpsellForAddress(null)}
                required="basic"
            />
        </>
    )
}

// Equal-width action cell used in expanded mode. Mobile-friendly tap target (≥44px) with
// icon + label stacked so users immediately know each action without relying on title attr.
function ActionCell({ icon, label, color, bg, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 rounded-[10px] transition-colors ${bg}`}
        >
            <span className={color}>{icon}</span>
            <span className={`text-[10px] font-bold leading-none ${color}`}>{label}</span>
        </button>
    )
}
