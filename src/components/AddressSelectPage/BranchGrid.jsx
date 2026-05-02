import { useRef, useState } from 'react'
import {
    Pencil, Trash2, ClipboardCopy, ChevronRight,
    Coffee, UserCircle2, Loader, FileText, DollarSign,
    ArrowRight,
    Users,
    GlassWater,
    Landmark
} from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import { formatVND } from '../../utils'

export default function BranchGrid({
    addresses, fetchError, cupsMap, revenueMap, sessionsMap, statsLoading,
    isStaff, isAdmin, error, setError,
    onSelect, onBackup, onRename, onRemove, onDefaultTemplate,
}) {
    const [editingAddressId, setEditingAddressId] = useState(null)
    const [editName, setEditName] = useState('')
    const [renaming, setRenaming] = useState(false)
    const [deletingAddressId, setDeletingAddressId] = useState(null)
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
                                            <span className="text-text font-black text-sm group-hover:text-primary transition-colors line-clamp-2 leading-tight truncate">{addr.name}</span>
                                            <ArrowRight size={20} strokeWidth={2.5} className="text-success shrink-0" />
                                        </div>
                                        {hasStats && (
                                            <div className="flex flex-col  gap-1 mt-2">
                                                <span className="flex  items-center gap-1 text-text-secondary text-sm">
                                                    Đã bán: <span className="font-bold">{cups}</span> ly
                                                </span>
                                                <span className="flex items-center gap-1 text-text-secondary text-sm">
                                                    Doanh thu: <span className="font-bold">{formatVND(revenue)}</span>
                                                </span>

                                            </div>
                                        )}
                                    </button>

                                    {/* Action buttons */}
                                    {!isStaff && (
                                        <div className="flex items-center justify-between border-t border-border/40 px-3.5 py-1.5 gap-2">
                                            <div 
                                                className="flex text-text-secondary items-center gap-1.5 text-xs justify-start flex-1 min-w-0"
                                                title={staffNames.length > 0 ? staffNames.join(', ') : 'Không có nhân sự'}
                                            >
                                                <Users size={13} className="shrink-0" />
                                                <span className="truncate font-medium">
                                                    {staffNames.length === 0 
                                                        ? '0 nhân sự' 
                                                        : staffNames.length === 1 
                                                            ? staffNames[0] 
                                                            : `${staffNames[0]} +${staffNames.length - 1}`}
                                                </span>
                                            </div>
                                            <div className='flex gap-0.5 justify-end shrink-0'>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onBackup(addr) }}
                                                    className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                                                    title="Sao lưu cấu hình"
                                                >
                                                    <ClipboardCopy size={16} />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        setEditingAddressId(addr.id)
                                                        setEditName(addr.name)
                                                        setDeletingAddressId(null)
                                                        setError('')
                                                    }}
                                                    className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                                                    title="Đổi tên"
                                                >
                                                    <Pencil size={16} />
                                                </button>
                                                {deletingAddressId === addr.id ? (
                                                    <div className="flex gap-1 ml-auto">
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
                                                            className="px-2 py-1 bg-danger text-white text-[10px] font-black rounded-md hover:bg-danger/90 transition-colors"
                                                        >
                                                            Xóa
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setDeletingAddressId(null) }}
                                                            className="px-2 py-1 bg-bg border border-border/60 text-text-secondary text-[10px] font-bold rounded-md hover:bg-surface-light transition-colors"
                                                        >
                                                            Hủy
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setDeletingAddressId(addr.id) }}
                                                        className="p-1.5 text-text-secondary hover:text-danger transition-colors rounded-lg hover:bg-danger/10"
                                                        title="Xóa"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
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
        </>
    )
}
