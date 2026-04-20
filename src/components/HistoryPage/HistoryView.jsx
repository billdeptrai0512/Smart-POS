import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleMinus, ArrowLeft, ArrowRight } from 'lucide-react'
import { formatVND, calculateProductCost } from '../../utils'
import { getPendingOrders } from '../../hooks/useOfflineSync'
import { fetchTodayShiftClosing } from '../../services/orderService'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'

export default function HistoryView({ todayOrders, todayExpenses, recipes, products, ingredientCosts, extraIngredients, isLoadingHistory, onBack, onDeleteOrder, onDeleteExpense }) {
    const navigate = useNavigate()
    const [deletingId, setDeletingId] = useState(null)
    const { selectedAddress } = useAddress()
    const { isStaff } = useAuth()
    const [shiftClosed, setShiftClosed] = useState(null)

    useEffect(() => {
        if (selectedAddress?.id) {
            setShiftClosed(null)
            fetchTodayShiftClosing(selectedAddress.id).then(data => setShiftClosed(!!data))
        } else {
            setShiftClosed(null)
        }
    }, [selectedAddress?.id])

    // Helper: compute item cost with hybrid fallback
    // If snapshot unit_cost > 0, use it; otherwise fallback to dynamic calculation
    const getItemCost = (productId, extras, snapshotUnitCost) => {
        if (snapshotUnitCost > 0) return snapshotUnitCost
        return calculateProductCost(productId, extras || [], recipes, extraIngredients, ingredientCosts)
    }

    const formattedOnline = todayOrders.map(o => {
        // Hybrid: use order-level snapshot if available, else sum item-level
        const cost = (o.total_cost > 0)
            ? o.total_cost
            : (o.order_items ? o.order_items.reduce((sum, i) => sum + (getItemCost(i.product_id, i.extras || [], i.unit_cost || 0) * i.quantity), 0) : 0)

        return {
            id: o.id,
            total: o.total,
            cost,
            createdAt: o.created_at,
            isOffline: false,
            paymentMethod: o.payment_method || null,
            items: o.order_items ? o.order_items.map(i => {
                const options = i.options
                    ? i.options.split(', ').filter(opt => opt !== 'Tiền mặt' && opt !== 'MoMo').join(' - ')
                    : ''
                const pName = products?.find(p => p.id === i.product_id)?.name || i.products?.name || '☕'
                return {
                    text: `${i.quantity} ${pName}${options ? ` (${options})` : ''}`,
                    cost: getItemCost(i.product_id, i.extras || [], i.unit_cost || 0) * i.quantity,
                    quantity: i.quantity
                }
            }) : []
        }
    })

    const pending = getPendingOrders()
    const todayStr = new Date().toDateString()
    const formattedOffline = pending
        .filter(o => new Date(o.createdAt).toDateString() === todayStr)
        .map((o, idx) => ({
            id: `offline-${idx}`,
            total: o.total,
            cost: o.totalCost > 0
                ? o.totalCost
                : (o.cart || o.orderItems || []).reduce((sum, i) => sum + (calculateProductCost(i.productId, i.extras || [], recipes, extraIngredients, ingredientCosts) * i.quantity), 0),
            createdAt: o.createdAt,
            isOffline: true,
            paymentMethod: o.paymentMethod || null,
            items: o.cart
                ? o.cart.map(i => {
                    const extras = i.extras.filter(e => e.name !== 'Tiền mặt' && e.name !== 'MoMo')
                    const itemCost = i.unitCost > 0 ? i.unitCost : calculateProductCost(i.productId, i.extras || [], recipes, extraIngredients, ingredientCosts)
                    return {
                        text: `${i.quantity} ${i.name}${extras.length ? ` (${extras.map(e => e.name).join(' - ')})` : ''}`,
                        cost: itemCost * i.quantity,
                        quantity: i.quantity
                    }
                })
                : o.orderItems ? o.orderItems.map(i => {
                    const itemCost = i.unitCost > 0 ? i.unitCost : calculateProductCost(i.productId, i.extras || [], recipes, extraIngredients, ingredientCosts)
                    return {
                        text: `${i.quantity} ${i.name}`,
                        cost: itemCost * i.quantity,
                        quantity: i.quantity
                    }
                }) : []
        }))

    const formattedExpenses = (todayExpenses || []).filter(e => !e.is_fixed).map(e => ({
        id: e.id,
        total: 0,
        cost: e.amount,
        createdAt: e.created_at,
        isOffline: false,
        isExpense: true,
        items: [{ text: `${e.name}`, cost: e.amount }]
    }))

    const allOrders = [...formattedOnline, ...formattedOffline, ...formattedExpenses].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    // --- Stats ---
    const totalExpenseCount = formattedExpenses.length
    const totalExpenseAmount = formattedExpenses.reduce((sum, e) => sum + e.cost, 0)
    const totalCups = allOrders.reduce((sum, o) => {
        if (o.isExpense || !o.items) return sum;
        return sum + o.items.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0);
    }, 0)

    // Running totals (oldest first to accumulate)
    const chronological = [...allOrders].reverse()
    const runningTotals = new Map()
    let cumulative = 0
    for (const order of chronological) {
        if (!order.isExpense) {
            cumulative += order.total
        }
        runningTotals.set(order.id, cumulative)
    }

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="w-10 h-10 flex flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                        title="Trở về"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex flex-row gap-2 flex-1">

                        <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm  rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                            <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Nhật ký</span>
                            <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{totalCups} ly</span>

                        </div>



                    </div>

                    <button onClick={() => navigate('/recipes')}
                        className="w-10 h-10 flex flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <ArrowRight size={20} strokeWidth={2.5} />
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-4 py-5 pb-24 space-y-3 bg-bg">
                {isLoadingHistory ? (
                    <div className="flex justify-center py-10">
                        <span className="text-text-secondary font-medium">Đang tải...</span>
                    </div>
                ) : allOrders.length === 0 ? (
                    <div className="flex justify-center py-10">
                        <span className="text-text-secondary font-medium">Chưa có đơn hàng nào hôm nay.</span>
                    </div>
                ) : (
                    allOrders.map(order => {
                        const date = new Date(order.createdAt)
                        const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`

                        return (
                            <div key={order.id} className={`bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden ${order.isExpense ? 'opacity-90' : ''}`}>
                                {order.isOffline && !order.isExpense && (
                                    <div className="absolute top-0 right-0 bg-warning/20 text-warning text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                                        Offline
                                    </div>
                                )}
                                {order.isExpense && (
                                    <div className="absolute top-0 right-0 bg-danger/10 text-danger text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                                        Chi phí
                                    </div>
                                )}
                                <div className="flex justify-between items-center mb-1">
                                    <div className="flex items-center gap-2 mt-1">
                                        {!order.isExpense ? (
                                            <span className="font-black text-[14px] text-primary">+ {formatVND(order.total)}</span>
                                        ) : (
                                            <span className="font-black text-[14px] text-danger">- {formatVND(order.cost)}</span>
                                        )}
                                    </div>
                                    {!order.isExpense ? (
                                        <span className="text-success leading-none text-[14px] mt-1 font-bold tabular-nums">
                                            {formatVND(runningTotals.get(order.id) || 0)}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                                    <div className="flex flex-col flex-1 gap-1.5 mt-0.5 mr-2">
                                        {order.items?.length > 0 ? (
                                            order.items.map((item, idx) => (
                                                <div key={idx} className="flex flex-row gap-2 items-start w-full">
                                                    <span className={`text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text`}>{item.text}</span>
                                                    {/* {!order.isExpense && item.cost > 0 && (
                                                        <div className="flex gap-2 text-[11px] font-medium mt-0.5 items-start shrink-0">
                                                            <span className="text-danger bg-danger/10 px-1.5 py-0.5 rounded-md">{formatVND(item.cost)}</span>
                                                        </div>
                                                    )} */}
                                                </div>
                                            ))
                                        ) : (
                                            <span className="text-text text-[14px] leading-snug font-medium whitespace-pre-wrap">Không có chi tiết</span>
                                        )}
                                    </div>
                                    <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                                        {!order.isOffline ? (
                                            <span
                                                className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none disabled:opacity-40"
                                                onClick={() => {
                                                    if (deletingId === order.id) return
                                                    const text = order.items?.map(i => i.text).join(', ') || ''
                                                    if (order.isExpense) {
                                                        if (window.confirm(`Xóa chi phí ${text}?\n\nHành động này không thể hoàn tác!`)) {
                                                            setDeletingId(order.id)
                                                            onDeleteExpense(order.id, order.cost).finally(() => setDeletingId(null))
                                                        }
                                                    } else {
                                                        if (window.confirm(`Xóa đơn ${text} (${formatVND(order.total)})?\n\nHành động này không thể hoàn tác!`)) {
                                                            setDeletingId(order.id)
                                                            onDeleteOrder(order.id).finally(() => setDeletingId(null))
                                                        }
                                                    }
                                                }}
                                                title={order.isExpense ? "Nhấn để xóa chi phí" : "Nhấn để xóa đơn hàng"}
                                            >
                                                {deletingId === order.id ? '⏳' : time}
                                            </span>
                                        ) : (
                                            <span className="text-text-secondary text-[14px] font-bold">{time}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
            </main>

            {/* Footer */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-bg via-bg via-60% to-transparent pointer-events-none">
                <div className="flex gap-2 pointer-events-auto mt-6">
                    <div onClick={() => navigate('/expenses')}
                        className="flex-1 bg-danger/10 border border-danger/60 rounded-[16px] px-4 py-2 flex flex-col justify-center items-start shadow-sm">
                        <span className="text-[12px] font-black text-danger uppercase">Chi phí trong ngày</span>
                        <span className="text-[16px] font-bold text-danger max-w-full overflow-hidden text-ellipsis leading-none mt-1 tabular-nums">
                            {formatVND(totalExpenseAmount)}
                        </span>
                    </div>

                    <button
                        onClick={() => {
                            if (shiftClosed === null) return
                            navigate(isStaff ? '/shift-closing' : '/daily-report')
                        }}
                        className={`border rounded-[16px] px-5 flex flex-col items-center justify-center gap-1 shadow-sm hover:bg-border/30 active:scale-95 transition-all group ${shiftClosed === null
                            ? 'bg-surface-light border-border/60 opacity-60'
                            : 'bg-success/10 border-success/60'
                            }`}
                        title={isStaff ? "Chốt ca / Cập nhật" : "Báo cáo"}
                        disabled={shiftClosed === null}
                    >
                        <span className={`text-[12px] font-black uppercase whitespace-nowrap transition-colors ${shiftClosed === null ? 'text-text-secondary' : 'text-success'
                            }`}>
                            {shiftClosed === null ? '...' : (isStaff ? (shiftClosed ? 'Cập nhật' : 'Chốt ca') : 'Báo cáo')}
                        </span>
                    </button>
                </div>
            </div>


        </div>
    )
}
