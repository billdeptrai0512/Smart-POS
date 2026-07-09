import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Pencil, Trash2, ClipboardCopy, MoreHorizontal, X,
    Coffee, Loader, FileText, BarChart3, Package, ChevronRight,
    CupSoda, Wallet, Users, HelpCircle, Eraser,
} from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import Skeleton from '../common/Skeleton'
import { formatVND } from '../../utils'
import { supabase } from '../../lib/supabaseClient'
import SubscriptionBadge from './SubscriptionBadge'

const isManagerRole = (role) => (role === 'manager' || role === 'co-manager') ? 1 : 0

export default function BranchGrid({
    addresses, fetchError, cupsMap, revenueMap, prevCupsMap = {}, sessionsMap, statsLoading,
    isStaff, isAdmin, error, setError,
    onSelect, onSelectReport, onSelectIngredients, onBackup, onRename, onRemove, onDefaultTemplate,
    onSupportClick,
}) {
    const [editingAddressId, setEditingAddressId] = useState(null)
    const [editName, setEditName] = useState('')
    const [renaming, setRenaming] = useState(false)
    const [deletingAddressId, setDeletingAddressId] = useState(null)
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
                                    {/* Quick-access manager: Báo cáo + Tồn kho — absolute để cột nút (cao hơn
                                            tiêu đề) không kéo giãn chiều cao header. span role=button vì nằm TRONG
                                            button card (button lồng button gây hydration error). */}
                                    {!isStaff && onSelectReport && (
                                        <div className="absolute top-3 right-3 flex flex-col gap-3">
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={(e) => { e.stopPropagation(); onSelectReport(addr) }}
                                                title="Xem báo cáo ngày"
                                                className="relative w-8 h-8 rounded-full bg-success/10 border border-success/25 text-success flex items-center justify-center hover:bg-success/20 active:scale-95 transition-all cursor-pointer before:absolute before:-inset-1.5 before:content-['']"
                                            >
                                                <BarChart3 size={16} strokeWidth={2.5} />
                                            </span>
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={(e) => { e.stopPropagation(); onSelectIngredients?.(addr) }}
                                                title="Xem tồn kho"
                                                className="relative w-8 h-8 rounded-full bg-primary/10 border border-primary/25 text-primary flex items-center justify-center hover:bg-primary/20 active:scale-95 transition-all cursor-pointer before:absolute before:-inset-1.5 before:content-['']"
                                            >
                                                <Package size={16} strokeWidth={2.5} />
                                            </span>
                                        </div>
                                    )}
                                    {/* Tên + chevron = tín hiệu "bấm card để vào quán" (giữ 2 nút quick góc phải). */}
                                    <div className="mb-1.5 pr-12 flex items-center gap-1">
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
                                        /* Expanded: hàng nút tròn icon-only, cùng chiều cao với hàng default
                                           (không stack label nên không break height). Badge ẩn tạm (đã cache
                                           → hiện lại tức thì khi đóng). */
                                        <div className="flex items-center justify-end gap-3 px-1.5">
                                            <ActionIcon
                                                icon={<ClipboardCopy size={16} />}
                                                title="Sao lưu cấu hình"
                                                tone="primary"
                                                onClick={(e) => { e.stopPropagation(); onBackup(addr); setExpandedActionsId(null) }}
                                            />
                                            <ActionIcon
                                                icon={<Pencil size={16} />}
                                                title="Đổi tên địa chỉ"
                                                tone="primary"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setEditingAddressId(addr.id)
                                                    setEditName(addr.name)
                                                    setDeletingAddressId(null)
                                                    setExpandedActionsId(null)
                                                    setError('')
                                                }}
                                            />
                                            <ActionIcon
                                                icon={<Trash2 size={16} />}
                                                title="Xóa địa chỉ"
                                                tone="danger"
                                                onClick={(e) => { e.stopPropagation(); setDeletingAddressId(addr.id); setExpandedActionsId(null) }}
                                            />
                                            {isAdmin && (
                                                <ActionIcon
                                                    icon={<Eraser size={16} />}
                                                    title="Xoá dữ liệu bán hàng (Admin)"
                                                    tone="danger"
                                                    onClick={(e) => { e.stopPropagation(); setWipingAddressId(addr.id); setWipeConfirmName(''); setExpandedActionsId(null) }}
                                                />
                                            )}
                                            <ActionIcon
                                                icon={<X size={16} />}
                                                title="Đóng"
                                                tone="neutral"
                                                onClick={(e) => { e.stopPropagation(); setExpandedActionsId(null) }}
                                            />
                                        </div>
                                    ) : (
                                        /* Default: trạng thái gói bên trái, menu quản lý bên phải */
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
                                    )}
                                </div>
                            </>

                            {/* Modal đổi tên — đồng bộ với modal Sao lưu (BackupModal). */}
                            {isEditing && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center">
                                    <div
                                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                                        onClick={() => { if (!renaming) { setEditingAddressId(null); setError('') } }}
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
                                                    onClick={() => { setEditingAddressId(null); setError('') }}
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

                            {/* Modal xoá dữ liệu bán hàng (Admin) — bắt gõ lại tên địa chỉ vì đây là hard-delete
                                không thể hoàn tác (orders/expenses/shift_closings), không đụng config/menu. */}
                            {wipingAddressId === addr.id && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center">
                                    <div
                                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                                        onClick={() => { if (!wiping) { setWipingAddressId(null); setError('') } }}
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
                                                    onClick={() => { setWipingAddressId(null); setError('') }}
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

                {/* Hỗ trợ & Góp ý card */}
                <button
                    onClick={onSupportClick}
                    className="bg-surface border border-dashed border-border/85 rounded-[20px] overflow-hidden shadow-sm flex flex-col items-center justify-center p-4 gap-2 hover:bg-surface-light hover:border-primary/30 active:bg-border/30 transition-all min-h-[100px] text-center"
                >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <HelpCircle size={18} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                        <span className="text-text font-black text-sm">Bạn cần hỗ trợ / có góp ý?</span>
                        <span className="text-text-secondary text-[11px] font-medium">Nhấp để liên hệ với chúng tôi</span>
                    </div>
                </button>
            </div>

            <ErrorBanner message={error} small className="mb-3" />
        </>
    )
}

// Nút tròn icon-only dùng ở expanded menu — cùng kích thước/viền với Báo cáo/Tồn kho/⋯
// để mở menu không break chiều cao card. title= cho biết hành động (không còn label).
const ACTION_TONES = {
    primary: 'bg-primary/10 border-primary/25 text-primary hover:bg-primary/20',
    danger: 'bg-danger/10 border-danger/25 text-danger hover:bg-danger/20',
    neutral: 'bg-surface-light border-border/50 text-text-secondary hover:text-text hover:bg-border/40',
}
function ActionIcon({ icon, title, tone = 'primary', onClick }) {
    return (
        <button
            onClick={onClick}
            title={title}
            aria-label={title}
            // before:-inset-1.5 = mở vùng chạm ra 44px (32px + 6px mỗi phía), visual giữ 32px.
            className={`relative w-8 h-8 flex items-center justify-center rounded-full border active:scale-95 transition-all shrink-0 before:absolute before:-inset-1.5 before:content-[''] ${ACTION_TONES[tone]}`}
        >
            {icon}
        </button>
    )
}

