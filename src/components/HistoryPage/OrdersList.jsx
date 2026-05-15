import { formatVND } from '../../utils'

export default function OrdersList({
    orders, runningTotals, isLoading, isTodayScope,
    pendingOrders, isSyncing, onRetrySync, onDeleteOffline,
    onDeleteOrder, deletingId, setDeletingId,
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
                        onDeleteOffline={onDeleteOffline}
                    />
                ))
            )}
        </main>
    )
}

function OrderCard({ order, runningTotal, deletingId, setDeletingId, onDeleteOrder, onDeleteOffline }) {
    const date = new Date(order.createdAt)
    const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`

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
                <span className="font-black text-[14px] text-primary mt-1">+ {formatVND(order.total)}</span>
                {!order.deletedAt && (
                    <span className="text-success leading-none text-[14px] mt-1 font-bold tabular-nums">
                        {formatVND(runningTotal)}
                    </span>
                )}
            </div>
            <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                <div className="flex flex-col justify-between flex-1 gap-1.5 mt-0.5 mr-2">
                    <div className="flex flex-col gap-1.5 flex-1">
                        {order.items?.length > 0 ? order.items.map((item, idx) => (
                            <div key={idx} className="flex flex-row gap-2 items-start w-full">
                                <span className={`text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text ${order.deletedAt ? 'line-through' : ''}`}>{item.text}</span>
                            </div>
                        )) : (
                            <span className="text-text text-[14px] leading-snug font-medium whitespace-pre-wrap">Không có chi tiết</span>
                        )}
                    </div>
                    {order.staffName && (
                        <div className="flex items-end pb-[1px] mt-1">
                            <span className="text-text-secondary/70 text-[12px] font-bold truncate max-w-[150px] leading-none">{order.staffName}</span>
                        </div>
                    )}
                </div>
                <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                    {order.deletedAt ? (
                        <span className="text-text-secondary/50 text-[14px] font-bold leading-none">{time}</span>
                    ) : !order.isOffline ? (
                        <span
                            className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none leading-none"
                            onClick={() => {
                                if (deletingId === order.id) return
                                const text = order.items?.map(i => i.text).join(', ') || ''
                                if (window.confirm(`Xóa đơn ${text} (${formatVND(order.total)})?\n\nHành động này không thể hoàn tác!`)) {
                                    setDeletingId(order.id)
                                    onDeleteOrder(order.id).finally(() => setDeletingId(null))
                                }
                            }}
                        >
                            {deletingId === order.id ? '⏳' : time}
                        </span>
                    ) : (
                        <div className="flex items-end gap-2 leading-none">
                            <span
                                className="text-warning/70 hover:text-danger text-[11px] font-bold cursor-pointer underline underline-offset-2 transition-colors leading-none"
                                onClick={() => onDeleteOffline(order.createdAt_key)}
                            >
                                Xóa
                            </span>
                            <span className="text-text-secondary text-[14px] font-bold leading-none">{time}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
