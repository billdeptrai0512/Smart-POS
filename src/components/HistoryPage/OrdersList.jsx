import { useState } from 'react'
import { Percent, Trash2 } from 'lucide-react'
import { formatVND, computeDiscount } from '../../utils'
import { useConfirm } from '../../contexts/ConfirmContext'
import DiscountModal from '../POSPage/DiscountModal'

export default function OrdersList({
    orders, runningTotals, isLoading, isTodayScope,
    pendingOrders, isSyncing, onRetrySync, onDeleteOffline,
    onDeleteOrder, onUpdateDiscount, deletingId, setDeletingId,
}) {
    return (
        <main className="flex-1 overflow-y-auto px-4 py-5 pb-4 space-y-3 bg-bg">
            {pendingOrders.length > 0 && (
                <div className="bg-warning/10 border border-warning/40 rounded-[14px] px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex flex-col min-w-0">
                        <span className="text-[13px] font-black text-warning">{pendingOrders.length} đơn chờ đồng bộ</span>
                        <span className="text-[11px] text-text-dim mt-0.5">Đơn offline chưa lên hệ thống</span>
                    </div>
                    <button
                        onClick={onRetrySync}
                        disabled={isSyncing}
                        className="shrink-0 bg-warning text-bg text-[12px] font-black px-3 py-1.5 rounded-lg disabled:opacity-60"
                    >
                        {isSyncing ? 'Đang sync...' : 'Thử lại'}
                    </button>
                </div>
            )}

            {isLoading ? (
                <div className="flex justify-center py-10">
                    <span className="text-text-secondary font-medium">Đang tải...</span>
                </div>
            ) : orders.length === 0 ? (
                <div className="flex justify-center py-10">
                    <span className="text-text-secondary font-medium">{isTodayScope ? 'Chưa có đơn hàng nào hôm nay.' : 'Không có đơn hàng trong khoảng này.'}</span>
                </div>
            ) : (
                orders.map(order => (
                    <OrderCard
                        key={order.id}
                        order={order}
                        runningTotal={runningTotals.get(order.id) || 0}
                        deletingId={deletingId}
                        setDeletingId={setDeletingId}
                        onDeleteOrder={onDeleteOrder}
                        onUpdateDiscount={onUpdateDiscount}
                        onDeleteOffline={onDeleteOffline}
                    />
                ))
            )}
        </main>
    )
}

function OrderCard({ order, runningTotal, deletingId, setDeletingId, onDeleteOrder, onUpdateDiscount, onDeleteOffline }) {
    const confirm = useConfirm()
    const [showDiscount, setShowDiscount] = useState(false)
    const date = new Date(order.createdAt)
    const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`

    const discountAmount = order.discountAmount || 0
    const subtotal = order.total + discountAmount   // pre-discount price (for the modal + struck original)
    // Only stored the đ reduced, not %/đ type → reopen as a fixed amount; user can switch in the modal.
    const seedDiscount = discountAmount ? { type: 'amount', value: discountAmount } : { type: 'percent', value: 0 }
    // Online, non-deleted orders are the only ones we can edit/discount against the DB.
    const editable = !order.deletedAt && !order.isOffline

    async function handleDelete() {
        if (deletingId === order.id) return
        const text = order.items?.map(i => i.text).join(', ') || ''
        if (await confirm({ title: `Xóa đơn ${text} (${formatVND(order.total)})?`, detail: 'Hành động này không thể hoàn tác!', danger: true, confirmLabel: 'Xóa' })) {
            setDeletingId(order.id)
            onDeleteOrder(order.id).finally(() => setDeletingId(null))
        }
    }

    return (
        <div className={`bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden ${order.deletedAt ? 'opacity-50 grayscale select-none' : ''}`}>
            {order.deletedAt && (
                <div className="absolute top-0 left-0 bg-danger/20 text-danger text-[10px] font-black px-3 py-1 rounded-br-[14px] uppercase tracking-wider z-10">
                    ĐÃ XÓA {order.deletedBy ? `BỞI ${order.deletedBy.toUpperCase()}` : ''}
                </div>
            )}
            {order.isOffline && !order.deletedAt && (
                <div className="absolute top-0 right-0 bg-warning/20 text-warning text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                    Offline
                </div>
            )}
            <div className="flex justify-between items-center mb-1">
                <div className="flex items-baseline gap-2 mt-1">
                    <span className="font-black text-[14px] text-primary">+ {formatVND(order.total)}</span>
                    {discountAmount > 0 && (
                        <span className="text-text-secondary/60 text-[12px] font-bold line-through tabular-nums">{formatVND(subtotal)}</span>
                    )}
                </div>
                {!order.deletedAt && (
                    <span className="text-success leading-none text-[14px] mt-1 font-bold tabular-nums">
                        {formatVND(runningTotal)}
                    </span>
                )}
            </div>
            <div className="mb-1 border-t border-border/40 pt-2">
                <div className="flex flex-col gap-1.5">
                    {order.items?.length > 0 ? order.items.map((item, idx) => (
                        <div key={idx} className="flex flex-row gap-2 items-start w-full">
                            <span className={`text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text ${order.deletedAt ? 'line-through' : ''}`}>{item.text}</span>
                        </div>
                    )) : (
                        <span className="text-text text-[14px] leading-snug font-medium whitespace-pre-wrap">Không có chi tiết</span>
                    )}
                </div>
            </div>

            <div className="border-t border-border/40 pt-2 flex justify-between items-center gap-3 leading-none">
                <span className="text-text-secondary/70 text-[12px] font-bold truncate min-w-0 leading-none">
                    {time}{order.staffName ? ` · ${order.staffName}` : ''}
                </span>
                {!order.deletedAt && (
                    !order.isOffline ? (
                        <div className="flex items-center gap-4 shrink-0">
                            <button
                                onClick={() => setShowDiscount(true)}
                                aria-label="Giảm giá"
                                className="text-text-secondary hover:text-primary transition-colors"
                            >
                                <Percent size={17} strokeWidth={2.25} />
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deletingId === order.id}
                                aria-label="Xóa đơn"
                                className="text-text-secondary hover:text-danger transition-colors disabled:opacity-50"
                            >
                                <Trash2 size={17} strokeWidth={2.25} />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => onDeleteOffline(order.createdAt_key)}
                            aria-label="Xóa đơn offline"
                            className="text-warning/70 hover:text-danger transition-colors shrink-0"
                        >
                            <Trash2 size={17} strokeWidth={2.25} />
                        </button>
                    )
                )}
            </div>

            {editable && (
                <DiscountModal
                    open={showDiscount}
                    onClose={() => setShowDiscount(false)}
                    subtotal={subtotal}
                    discount={seedDiscount}
                    onApply={(d) => {
                        const { discountAmount: amt, finalTotal } = computeDiscount(subtotal, d)
                        onUpdateDiscount(order.id, finalTotal, amt)
                    }}
                />
            )}
        </div>
    )
}
