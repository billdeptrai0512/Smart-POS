import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Pencil, Trash2, ClipboardCopy, MoreHorizontal, X,
    Coffee, Loader, FileText, Package, ChevronRight, Eraser,
    Banknote, Receipt, Wallet, Boxes, TrendingUp, ChefHat, Box,
} from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import Skeleton from '../common/Skeleton'
import { formatVND } from '../../utils'
import { supabase } from '../../lib/supabaseClient'
import SubscriptionBadge from './SubscriptionBadge'
import BackupModal from './BackupModal'

const isManagerRole = (role) => (role === 'manager' || role === 'co-manager') ? 1 : 0

export default function BranchGrid({
    addresses, fetchError, cupsMap, revenueMap, prevCupsMap = {}, sessionsMap, statsLoading,
    isStaff, isAdmin, error, setError,
    onSelect, onSelectReport, onSelectHistory, onSelectIngredients, onSelectRecipes,
    onRename, onRemove, onDefaultTemplate, onSupportClick,
}) {
    const [editingAddressId, setEditingAddressId] = useState(null)
    const [editName, setEditName] = useState('')
    const [renaming, setRenaming] = useState(false)
    const [deletingAddressId, setDeletingAddressId] = useState(null)
    const [deleteConfirmName, setDeleteConfirmName] = useState('')
    const [deleting, setDeleting] = useState(false)
    const [backupAddressId, setBackupAddressId] = useState(null) // which card has the "Nhân bản cấu hình" modal open
    const [expandedActionsId, setExpandedActionsId] = useState(null) // which card has the 3-action menu open
    const [wipingAddressId, setWipingAddressId] = useState(null) // which card has the wipe-sales-data confirm modal open
    const [wipeConfirmName, setWipeConfirmName] = useState('')
    const [wiping, setWiping] = useState(false)
    const submitGuardRef = useRef(false)
    const navigate = useNavigate()

    async function handleWipeSalesData(addr) {
        if (wipeConfirmName.trim() !== addr.name || wiping) return
        setWiping(true)
        setError('')
        try {
            const { error: rpcError } = await supabase.rpc('admin_wipe_address_sales_data', { p_address_id: addr.id })
            if (rpcError) throw rpcError
            window.location.reload() // đơn giản nhất để làm mới cupsMap/revenueMap sau khi xoá
        } catch (err) {
            setError(err.message || 'Không thể xoá dữ liệu bán hàng')
            setWiping(false)
        }
    }

    async function handleRemoveAddress(addr) {
        if (deleteConfirmName.trim() !== addr.name || deleting) return
        setDeleting(true)
        setError('')
        try {
            await onRemove(addr.id)
            setDeletingAddressId(null)
            setExpandedActionsId(null)
        } catch (err) {
            setError(err.message || 'Không thể xóa địa chỉ')
        } finally {
            setDeleting(false)
        }
    }

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
            setExpandedActionsId(null)
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
                    // Số ly hôm qua tính đến cùng giờ này → delta ↑/↓%. 0 (chưa migrate
                    // RPC / hôm qua nghỉ) thì ẩn delta, tránh chia 0.
                    const prevCups = prevCupsMap[addr.id] || 0
                    const cupsDeltaPct = prevCups > 0
                        ? Math.round(((cups - prevCups) / prevCups) * 100)
                        : null
                    const sessionUsers = sessionsMap[addr.id] || []
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
                            <>
                                {/* Main click area */}
                                <button
                                    onClick={() => onSelect(addr)}
                                    className="group relative flex-1 p-3 text-left hover:bg-surface-light active:bg-border/30 transition-colors min-w-0"
                                >
                                    {/* Tên + chevron = tín hiệu "bấm card để vào quán". Báo cáo/Tồn kho chuyển vào modal thao tác (nút ⋯). */}
                                    <div className="mb-1.5 flex items-center justify-between gap-1">
                                        <span className="text-text font-black text-sm transition-colors line-clamp-2 leading-tight truncate">{addr.name}</span>
                                        <ChevronRight size={18} strokeWidth={2.5} className="text-text-secondary shrink-0 group-hover:text-primary group-active:translate-x-0.5 transition-all" />
                                    </div>

                                    {/* Uniform label:value list — số liệu vận hành */}
                                    <div className="flex flex-col gap-1.5 text-sm">
                                        {/* Skeleton giữ chỗ 2 dòng stats trong lần load đầu — card không còn trống trơn */}
                                        {statsLoading && !hasStats && (
                                            <>
                                                <Skeleton className="h-4 w-32 rounded-md" />
                                                <Skeleton className="h-4 w-44 rounded-md" />
                                            </>
                                        )}
                                        {/* Mỗi người đang trong ca một dòng — nhãn theo vai trò, quản lý trước */}
                                        {hasStats && [...sessionUsers]
                                            .sort((a, b) => isManagerRole(b.role) - isManagerRole(a.role))
                                            .map((u, i) => (
                                                <div key={i} className="flex items-baseline gap-1.5 min-w-0">
                                                    <span className="text-text-secondary shrink-0">{isManagerRole(u.role) ? 'Quản lý:' : 'Nhân viên:'}</span>
                                                    <span className="text-text truncate">{u.name}</span>
                                                </div>
                                            ))}
                                        {hasStats && (
                                            <>
                                                <div className="flex items-baseline gap-1.5">
                                                    <span className="text-text-secondary">Hôm nay bán:</span>
                                                    <span className="text-text">{cups} ly</span>
                                                    {cupsDeltaPct !== null && cupsDeltaPct !== 0 && (
                                                        <span
                                                            title="So với hôm qua cùng giờ"
                                                            className={`text-[12px] font-bold tabular-nums ${cupsDeltaPct > 0 ? 'text-success' : 'text-danger'}`}
                                                        >
                                                            {cupsDeltaPct > 0 ? '↑' : '↓'}{Math.abs(cupsDeltaPct)}%
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-baseline gap-1.5">
                                                    <span className="text-text-secondary">Tổng doanh thu:</span>
                                                    <span className="text-text">{formatVND(revenue)}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </button>

                                {/* Footer: trạng thái gói (mọi role) + menu quản lý (chỉ manager) */}
                                <div className="border-t border-border/40 px-2 py-1.5">
                                    <div className="flex items-center justify-between gap-2 px-1.5">
                                        {/* Trạng thái gói — tự ẩn khi monetization OFF (badge return null) */}
                                        <SubscriptionBadge
                                            addressId={addr.id}
                                            onRenewClick={() => navigate('/subscription', {
                                                state: { preselectAddressId: addr.id, from: '/addresses' },
                                            })}
                                        />
                                        {!isStaff && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setExpandedActionsId(addr.id) }}
                                                className="relative w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/50 text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all shrink-0 before:absolute before:-inset-1.5 before:content-['']"
                                                title="Thao tác khác"
                                                aria-label="Mở menu thao tác"
                                            >
                                                <MoreHorizontal size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </>

                            {/* Modal thao tác — Lối tắt (pill grid, điều hướng) tách riêng khỏi Quản lý (list, sửa/xoá địa chỉ). */}
                            {expandedActionsId === addr.id && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center">
                                    <div
                                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                                        onClick={() => setExpandedActionsId(null)}
                                    />
                                    <div className="relative w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
                                        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
                                            <p className="text-text font-black text-sm leading-none truncate pr-2">{addr.name}</p>
                                            <button
                                                onClick={() => setExpandedActionsId(null)}
                                                className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light shrink-0"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                        <div className="overflow-y-auto">
                                            {!isStaff && (
                                                <div className="px-3 pt-3 pb-1">
                                                    <p className="px-1 pb-2 text-[10px] font-black uppercase tracking-wider text-text-secondary">Lối tắt</p>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <ActionPill
                                                            icon={<Banknote size={15} />}
                                                            label="Thu nhập"
                                                            tone="primary"
                                                            onClick={() => { onSelectHistory?.(addr, 'orders'); setExpandedActionsId(null) }}
                                                        />
                                                        <ActionPill
                                                            icon={<Receipt size={15} />}
                                                            label="Chi phí"
                                                            tone="primary"
                                                            onClick={() => { onSelectHistory?.(addr, 'expense'); setExpandedActionsId(null) }}
                                                        />
                                                        <ActionPill
                                                            icon={<Wallet size={15} />}
                                                            label="Dòng tiền"
                                                            tone="success"
                                                            onClick={() => { onSelectReport?.(addr, 'cashflow'); setExpandedActionsId(null) }}
                                                        />
                                                        <ActionPill
                                                            icon={<TrendingUp size={15} />}
                                                            label="Lợi nhuận"
                                                            tone="success"
                                                            onClick={() => { onSelectReport?.(addr, 'profit'); setExpandedActionsId(null) }}
                                                        />
                                                        <ActionPill
                                                            icon={<Boxes size={15} />}
                                                            label="Tồn kho"
                                                            tone="warning"
                                                            onClick={() => { onSelectReport?.(addr, 'inventory'); setExpandedActionsId(null) }}
                                                        />
                                                        <ActionPill
                                                            icon={<ChefHat size={15} />}
                                                            label="Công thức"
                                                            tone="primary"
                                                            onClick={() => { onSelectRecipes?.(addr); setExpandedActionsId(null) }}
                                                        />
                                                        <ActionPill
                                                            icon={<Package size={15} />}
                                                            label="Nguyên liệu"
                                                            tone="primary"
                                                            onClick={() => { onSelectIngredients?.(addr); setExpandedActionsId(null) }}
                                                        />
                                                        <ActionPill
                                                            icon={<Box size={15} />}
                                                            label="Bao bì"
                                                            tone="warning"
                                                            onClick={() => { onSelectIngredients?.(addr, 'packaging'); setExpandedActionsId(null) }}
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            <div className="px-3 pt-2 pb-2">
                                                <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-wider text-text-secondary">Quản lý</p>
                                                <div className="flex flex-col">
                                                    <ActionRow
                                                        icon={<ClipboardCopy size={16} />}
                                                        label="Sao lưu cấu hình"
                                                        tone="primary"
                                                        onClick={() => setBackupAddressId(addr.id)}
                                                    />
                                                    <ActionRow
                                                        icon={<Pencil size={16} />}
                                                        label="Đổi tên địa chỉ"
                                                        tone="primary"
                                                        onClick={() => {
                                                            setEditingAddressId(addr.id)
                                                            setEditName(addr.name)
                                                            setError('')
                                                        }}
                                                    />
                                                    <ActionRow
                                                        icon={<Trash2 size={16} />}
                                                        label="Xóa địa chỉ"
                                                        tone="danger"
                                                        onClick={() => { setDeletingAddressId(addr.id); setDeleteConfirmName(''); setError('') }}
                                                    />
                                                    {isAdmin && (
                                                        <ActionRow
                                                            icon={<Eraser size={16} />}
                                                            label="Xoá dữ liệu bán hàng (Admin)"
                                                            tone="danger"
                                                            onClick={() => { setWipingAddressId(addr.id); setWipeConfirmName(''); setError('') }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Modal đổi tên — "Hủy" quay lại modal thao tác (expandedActionsId giữ nguyên), X/tap-outside mới thoát hẳn.
                                Render SAU modal thao tác trong DOM để đè lên (2 modal cùng z-50, phần tử sau luôn nổi lên trên). */}
                            {isEditing && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center">
                                    <div
                                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                                        onClick={() => { if (!renaming) { setEditingAddressId(null); setExpandedActionsId(null); setError('') } }}
                                    />
                                    <form
                                        onSubmit={(e) => handleRename(e, addr.id)}
                                        className="relative w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
                                    >
                                        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center">
                                                    <Pencil size={15} className="text-primary" />
                                                </div>
                                                <p className="text-text font-black text-sm leading-none">Đổi tên địa chỉ</p>
                                            </div>
                                            {!renaming && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setEditingAddressId(null); setExpandedActionsId(null); setError('') }}
                                                    className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light"
                                                >
                                                    <X size={16} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="p-5 flex flex-col gap-4">
                                            <input
                                                type="text"
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                disabled={renaming}
                                                className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                                                autoFocus
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={renaming}
                                                    onClick={() => { setEditingAddressId(null); setError('') }}
                                                    className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                                                >
                                                    Hủy
                                                </button>
                                                <button
                                                    type="submit"
                                                    disabled={renaming || !editName.trim()}
                                                    className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                                >
                                                    {renaming ? <Loader size={14} className="animate-spin" /> : 'Lưu'}
                                                </button>
                                            </div>
                                        </div>
                                    </form>
                                </div>
                            )}

                            {/* Modal sao lưu — "Hủy" quay lại modal thao tác (expandedActionsId giữ nguyên), X mới thoát hẳn. */}
                            {backupAddressId === addr.id && (
                                <BackupModal
                                    sourceAddress={addr}
                                    onClose={() => { setBackupAddressId(null); setExpandedActionsId(null) }}
                                    onBack={() => setBackupAddressId(null)}
                                />
                            )}

                            {/* Modal xoá dữ liệu bán hàng (Admin) — bắt gõ lại tên địa chỉ vì đây là hard-delete
                                không thể hoàn tác (orders/expenses/shift_closings), không đụng config/menu.
                                "Hủy" quay lại modal thao tác, X/tap-outside mới thoát hẳn. */}
                            {wipingAddressId === addr.id && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center">
                                    <div
                                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                                        onClick={() => { if (!wiping) { setWipingAddressId(null); setExpandedActionsId(null); setError('') } }}
                                    />
                                    <div className="relative w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
                                        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-[10px] bg-danger/10 flex items-center justify-center">
                                                    <Eraser size={15} className="text-danger" />
                                                </div>
                                                <p className="text-text font-black text-sm leading-none">Xoá dữ liệu bán hàng</p>
                                            </div>
                                            {!wiping && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setWipingAddressId(null); setExpandedActionsId(null); setError('') }}
                                                    className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light"
                                                >
                                                    <X size={16} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="p-5 flex flex-col gap-4">
                                            <p className="text-text-secondary text-xs leading-relaxed">
                                                Xoá toàn bộ đơn hàng, chi phí, phiếu chốt ca của <span className="font-bold text-text">{addr.name}</span>. Menu, công thức, nguyên liệu, gói đăng ký được giữ nguyên. <span className="text-danger font-bold">Không thể hoàn tác.</span>
                                            </p>
                                            <div>
                                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Gõ lại tên địa chỉ để xác nhận</label>
                                                <input
                                                    type="text"
                                                    value={wipeConfirmName}
                                                    onChange={e => setWipeConfirmName(e.target.value)}
                                                    disabled={wiping}
                                                    placeholder={addr.name}
                                                    className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger disabled:opacity-50"
                                                    autoFocus
                                                />
                                            </div>
                                            {/* Modal là overlay z-50 toàn màn hình nên ErrorBanner cuối trang bị che khuất —
                                                lỗi RPC phải hiện ngay trong modal, không thì admin không biết vì sao thất bại. */}
                                            {wipingAddressId === addr.id && error && (
                                                <p className="text-danger text-xs font-medium -mt-2">{error}</p>
                                            )}
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={wiping}
                                                    onClick={() => { setWipingAddressId(null); setError('') }}
                                                    className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                                                >
                                                    Hủy
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={wiping || wipeConfirmName.trim() !== addr.name}
                                                    onClick={() => handleWipeSalesData(addr)}
                                                    className="flex-1 py-3 rounded-[14px] bg-danger text-white font-black text-sm hover:bg-danger/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                                >
                                                    {wiping ? <Loader size={14} className="animate-spin" /> : 'Xoá vĩnh viễn'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Modal xoá địa chỉ — bắt gõ lại tên như modal xoá dữ liệu bán hàng, vì đây cũng là hard-delete
                                không thể hoàn tác. "Hủy" quay lại modal thao tác, X/tap-outside mới thoát hẳn. */}
                            {deletingAddressId === addr.id && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center">
                                    <div
                                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                                        onClick={() => { if (!deleting) { setDeletingAddressId(null); setExpandedActionsId(null); setError('') } }}
                                    />
                                    <div className="relative w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
                                        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-[10px] bg-danger/10 flex items-center justify-center">
                                                    <Trash2 size={15} className="text-danger" />
                                                </div>
                                                <p className="text-text font-black text-sm leading-none">Xóa địa chỉ</p>
                                            </div>
                                            {!deleting && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setDeletingAddressId(null); setExpandedActionsId(null); setError('') }}
                                                    className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light"
                                                >
                                                    <X size={16} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="p-5 flex flex-col gap-4">
                                            <p className="text-text-secondary text-xs leading-relaxed">
                                                Xoá toàn bộ dữ liệu của <span className="font-bold text-text">{addr.name}</span> — menu, công thức, nguyên liệu, đơn hàng, chi phí, gói đăng ký. <span className="text-danger font-bold">Không thể hoàn tác.</span>
                                            </p>
                                            <div>
                                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Gõ lại tên địa chỉ để xác nhận</label>
                                                <input
                                                    type="text"
                                                    value={deleteConfirmName}
                                                    onChange={e => setDeleteConfirmName(e.target.value)}
                                                    disabled={deleting}
                                                    placeholder={addr.name}
                                                    className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger disabled:opacity-50"
                                                    autoFocus
                                                />
                                            </div>
                                            {deletingAddressId === addr.id && error && (
                                                <p className="text-danger text-xs font-medium -mt-2">{error}</p>
                                            )}
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={deleting}
                                                    onClick={() => { setDeletingAddressId(null); setError('') }}
                                                    className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                                                >
                                                    Hủy
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={deleting || deleteConfirmName.trim() !== addr.name}
                                                    onClick={() => handleRemoveAddress(addr)}
                                                    className="flex-1 py-3 rounded-[14px] bg-danger text-white font-black text-sm hover:bg-danger/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                                >
                                                    {deleting ? <Loader size={14} className="animate-spin" /> : 'Xóa vĩnh viễn'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
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

                {/* Hỗ trợ & Góp ý */}
                <div className="flex flex-col items-center justify-center p-3">
                    <button
                        onClick={onSupportClick}
                        className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-surface-light border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-300 cursor-pointer"
                    >
                        <span className="text-[10px] font-black uppercase tracking-[0.15em] whitespace-nowrap mt-[1px] text-primary">
                            Bạn cần hỗ trợ / có góp ý?
                        </span>
                    </button>
                </div>
            </div>

            <ErrorBanner message={error} small className="mb-3" />
        </>
    )
}

// Hàng "Quản lý" trong modal thao tác — icon tròn + label, tone màu theo mức độ nguy hiểm.
const ROW_TONES = {
    primary: 'bg-primary/10 text-primary',
    danger: 'bg-danger/10 text-danger',
    success: 'bg-success/10 text-success',
}
function ActionRow({ icon, label, tone = 'primary', onClick }) {
    return (
        <button
            onClick={onClick}
            className="flex items-center gap-3 px-3 py-3 rounded-[14px] hover:bg-surface-light active:bg-border/30 transition-colors text-left w-full"
        >
            <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${ROW_TONES[tone]}`}>
                {icon}
            </span>
            <span className={`font-bold text-sm ${tone === 'danger' ? 'text-danger' : 'text-text'}`}>{label}</span>
        </button>
    )
}

// Pill lối tắt điều hướng — 2 cột, icon nhỏ + label 1 dòng, tách hẳn khỏi list "Quản lý".
const PILL_TONES = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
}
function ActionPill({ icon, label, tone = 'primary', onClick }) {
    return (
        <button
            onClick={onClick}
            className="flex items-center gap-2 px-3 py-2.5 rounded-[14px] bg-surface-light border border-border/50 hover:border-primary/40 hover:bg-border/20 active:scale-95 transition-all text-left min-w-0"
        >
            <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${PILL_TONES[tone]}`}>
                {icon}
            </span>
            <span className="text-text text-[12px] font-bold leading-tight truncate">{label}</span>
        </button>
    )
}

