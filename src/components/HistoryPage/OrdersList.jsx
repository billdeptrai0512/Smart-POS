import { useState, useRef, useMemo, useEffect, memo } from 'react'
import { Percent, Trash2, Printer } from 'lucide-react'
import { formatVND, computeDiscount, discountToPercent } from '../../utils'
import { dateShortVN, timeStringVN } from '../../utils/dateVN'
import { priceLineFor } from '../../utils/billLines'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useProducts } from '../../contexts/ProductContext'
import DiscountModal from '../POSPage/DiscountModal'
import PrintBill from '../common/PrintBill'

// Nút icon tròn trên thẻ đơn (giảm giá, in, xoá) — cùng một khuôn, tách ra để đổi kiểu
// một lần. Cùng kích thước với hàng nút trong TableDetailModal.
const ICON_BTN = 'shrink-0 w-[26px] h-[26px] rounded-full border bg-surface-light border-border/60 flex items-center justify-center transition-colors'

export default function OrdersList({
    orders, runningTotals, isLoading, isTodayScope,
    pendingOrders, isSyncing, onRetrySync, onDeleteOffline,
    onDeleteOrder, onUpdateDiscount, deletingId, setDeletingId,
    justArrivedIds, dineIn,
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
                /* Skeleton giữ chỗ theo hình dáng OrderCard — cùng pattern ExpensePanel/DailyReport */
                <div className="flex flex-col gap-3 animate-pulse">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="bg-surface-light rounded-[20px] h-32 w-full" />
                    ))}
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
                        isDeleting={deletingId === order.id}
                        setDeletingId={setDeletingId}
                        onDeleteOrder={onDeleteOrder}
                        onUpdateDiscount={onUpdateDiscount}
                        onDeleteOffline={onDeleteOffline}
                        isNew={justArrivedIds?.has(order.id) || false}
                        dineIn={dineIn}
                    />
                ))
            )}
        </main>
    )
}

// memo + per-card isDeleting (not the raw shared deletingId, which would change
// for every card whenever ANY order starts/stops deleting) — otherwise deleting
// one order re-renders the entire day's order list.
const OrderCard = memo(function OrderCard({ order, runningTotal, isDeleting, setDeletingId, onDeleteOrder, onUpdateDiscount, onDeleteOffline, isNew, dineIn }) {
    const confirm = useConfirm()
    const { products, productExtras } = useProducts()
    const [showDiscount, setShowDiscount] = useState(false)
    const date = new Date(order.createdAt)
    const time = timeStringVN(date)

    const discountAmount = order.discountAmount || 0
    const subtotal = order.total + discountAmount   // pre-discount price (for the modal + struck original)
    // Chỉ lưu đúng số đ đã giảm, không lưu %/đ type đã chọn lúc áp — % hiển thị ở nút/bill in
    // và seed lại DiscountModal đều suy ngược qua discountToPercent (không hardcode), đúng
    // cho cả 2 cách giảm (theo % lẫn theo đúng số tiền) sau khi đã lưu. `exact` quyết định
    // seedDiscount seed "%" hay "đ" — xem comment ở discountToPercent (src/utils/money.ts).
    const { pct: discountPct, exact: discountPctExact } = discountToPercent(subtotal, discountAmount)
    const seedDiscount = !discountAmount
        ? { type: 'percent', value: 0 }
        : discountPctExact
            ? { type: 'percent', value: discountPct }
            : { type: 'amount', value: discountAmount }
    // Online, non-deleted orders are the only ones we can edit/discount against the DB.
    const editable = !order.deletedAt && !order.isOffline

    // In bill: chỉ đơn MANG ĐI đứng riêng (không table_name — đợt gọi thêm của 1 bàn phải
    // in qua TableDetailModal, gộp chung cả bàn thành 1 tờ) VÀ chỉ khi địa chỉ có bật "Bàn
    // ngồi" (dine_in) — tắt thì chưa có hạ tầng in bill cho quán đó.
    const canPrint = dineIn && !order.tableName && !order.deletedAt
    const billRef = useRef(null)
    const [printArmed, setPrintArmed] = useState(false)

    const billLines = useMemo(() => {
        if (!canPrint) return []
        return (order.items || []).map(it => ({ key: it.text, qty: it.quantity, ...priceLineFor(it, products, productExtras) }))
    }, [canPrint, order.items, products, productExtras])

    // Chỉ 1 thẻ được mang id="print-bill" tại 1 thời điểm (CSS @media print chọn theo id) —
    // bấm in mới gắn id cho ĐÚNG thẻ này (mount PrintBill), in xong gỡ luôn (setPrintArmed
    // false) để thẻ kế bấm sau không bị dính id cũ. setState ở đây là chủ đích: đây LÀ đích
    // đến của effect (gỡ mount sau khi đã đồng bộ với window.print(), một external API),
    // không phải suy ra state từ props/state khác.
    useEffect(() => {
        if (!printArmed) return
        billRef.current?.print()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPrintArmed(false)
    }, [printArmed])

    const deletedTimeStr = order.deletedAt ? (() => {
        const d = new Date(order.deletedAt)
        return `${timeStringVN(d)} ${dateShortVN(d)}`
    })() : ''

    async function handleDelete() {
        if (isDeleting) return
        const text = order.items?.map(i => i.text).join(', ') || ''
        if (await confirm({ title: `Xóa đơn ${text} (${formatVND(order.total)})?`, detail: 'Hành động này không thể hoàn tác!', danger: true, confirmLabel: 'Xóa' })) {
            setDeletingId(order.id)
            onDeleteOrder(order.id).finally(() => setDeletingId(null))
        }
    }

    return (
        <div className={`bg-surface border rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden transition-shadow duration-[1500ms] ${isNew ? 'border-primary shadow-[0_0_16px_rgba(255,107,53,0.45)]' : 'border-border/60'}`}>
            {/* Đơn vừa nhận realtime từ máy khác — glow cam vài giây rồi tự tắt (justArrivedIds ở POSContext) để nhân viên quầy nhận ra ngay, không phải nhìn chằm chằm danh sách */}
            {order.deletedAt && (
                <div className="absolute top-0 left-0 bg-danger/10 text-danger text-[10px] font-bold px-3 py-1.5 rounded-br-[14px] border-r border-b border-danger/10 flex items-center gap-1.5 uppercase tracking-wider z-10">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    <span>Đã xóa{order.deletedBy ? ` bởi ${order.deletedBy}` : ''} · {deletedTimeStr}</span>
                </div>
            )}
            {order.isOffline && !order.deletedAt && (
                <div className="absolute top-0 right-0 bg-warning/20 text-warning text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                    Offline
                </div>
            )}
            
            <div className={`flex flex-col gap-2 ${order.deletedAt ? 'opacity-40 grayscale select-none' : ''}`}>
                <div className="flex justify-between items-center mb-1">
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className="font-black text-[14px] text-primary">+ {formatVND(order.total)}</span>
                        {discountAmount > 0 && (
                            <span className="text-text-secondary/60 text-[12px] font-bold line-through tabular-nums">{formatVND(subtotal)}</span>
                        )}
                        {editable && (
                            <button
                                onClick={() => setShowDiscount(true)}
                                aria-label="Giảm giá"
                                className={discountAmount > 0
                                    // Đã có giảm giá → hiện luôn mức % thay vì icon trơ, để không
                                    // phải mở lại modal mới biết đã giảm bao nhiêu.
                                    ? 'shrink-0 h-[26px] px-2.5 rounded-full border bg-primary/10 border-primary/40 text-primary text-[11px] font-black tabular-nums flex items-center justify-center self-center transition-colors hover:bg-primary/20'
                                    : `${ICON_BTN} self-center text-text-secondary hover:text-primary`}
                            >
                                {discountAmount > 0 ? `-${discountPct}%` : <Percent size={14} strokeWidth={2.25} />}
                            </button>
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
                        {time}{order.tableName ? <> · <span className="inline-block first-letter:uppercase">{order.tableName}</span></> : ''}{order.staffName ? ` · ${order.staffName}` : ''}
                    </span>
                    <div className="shrink-0 flex items-center gap-2">
                        {canPrint && (
                            <button
                                onClick={() => setPrintArmed(true)}
                                aria-label="In bill"
                                className={`${ICON_BTN} text-text-secondary hover:text-primary`}
                            >
                                <Printer size={14} strokeWidth={2.25} />
                            </button>
                        )}
                        {/* Đơn offline chưa lên DB thì xoá bằng đường khác (hàng chờ), còn lại
                            y hệt nhau — một nút, hai nguồn dữ liệu. */}
                        {!order.deletedAt && (
                            <button
                                onClick={order.isOffline ? () => onDeleteOffline(order.createdAt_key) : handleDelete}
                                disabled={!order.isOffline && isDeleting}
                                aria-label={order.isOffline ? 'Xóa đơn offline' : 'Xóa đơn'}
                                className={`${ICON_BTN} ${order.isOffline ? 'text-warning/70' : 'text-text-secondary'} hover:text-danger disabled:opacity-50`}
                            >
                                <Trash2 size={14} strokeWidth={2.25} />
                            </button>
                        )}
                    </div>
                </div>
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

            {/* Chỉ mount khi đang in (printArmed) — nếu mount thường trực ở MỌI thẻ mang
                đi thì nhiều thẻ cùng có id="print-bill" một lúc, CSS @media print (index.css)
                chọn theo id sẽ hiện chồng hết lên nhau. */}
            {printArmed && (
                <PrintBill
                    ref={billRef}
                    orderNo={null}
                    tableName={null}
                    openedAt={order.createdAt}
                    staffName={order.staffName}
                    lines={billLines}
                    subtotal={subtotal}
                    discountTotal={discountAmount}
                    discountPct={discountPct}
                    total={order.total}
                />
            )}
        </div>
    )
})
