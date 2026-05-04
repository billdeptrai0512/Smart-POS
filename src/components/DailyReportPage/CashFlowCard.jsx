import { formatVND } from '../../utils'

function Card({ label, value, valueClass = 'text-primary', prefix = '', sub = null, className = '', onClick = null }) {
    return (
        <div 
            onClick={onClick}
            className={`bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center ${onClick ? 'cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all' : ''} ${className}`}
        >
            <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">{label}</h3>
            <div className={`text-[18px] font-bold tabular-nums ${valueClass}`}>
                {prefix}{formatVND(value)}
            </div>
            {sub && <div className="text-[10px] font-bold text-text-dim tabular-nums mt-0.5">{sub}</div>}
        </div>
    )
}

export default function CashFlowCard({ shiftClosing, cash: cashProp, transfer: transferProp, dailyExpense, refillTotal = 0, totalRevenue = 0, onDailyExpenseClick, onRefillClick }) {
    const actualCash = cashProp ?? (shiftClosing?.actual_cash || 0)
    const actualTransfer = transferProp ?? (shiftClosing?.actual_transfer || 0)

    // Thực nhận = TM + CK + chi phí ca + mua NVL (đối soát với doanh thu)
    const actualTotal = actualCash + actualTransfer + (dailyExpense || 0) + refillTotal
    // Cầm về thực = TM + CK - mua NVL (tiền thực trong túi sau khi trừ NVL đã mua)
    // Vì không biết NVL thanh toán bằng gì, ta ưu tiên trừ tiền mặt trước, nếu dư thì trừ chuyển khoản
    const takeHomeCash = Math.max(0, actualCash - refillTotal)
    const remainingRefill = Math.max(0, refillTotal - actualCash)
    const takeHomeTransfer = Math.max(0, actualTransfer - remainingRefill)
    const takeHome = takeHomeCash + takeHomeTransfer

    const takeHomeSub = refillTotal > 0 && takeHomeCash > 0 && takeHomeTransfer > 0
        ? `Tiền Mặt ${formatVND(takeHomeCash)} · Bank ${formatVND(takeHomeTransfer)}`
        : null

    // Đối soát: thực nhận phải bằng doanh thu (totalRevenue từ đơn hàng thực tế)
    const diff = actualTotal - totalRevenue
    const isMatch = Math.abs(diff) < 1000

    return (
        <div className="grid grid-cols-2 gap-3">
            {/* Row 1: INPUTS — nguồn tiền thu về */}
            <Card label="Tiền mặt" value={actualCash} />
            <Card label="Chuyển khoản" value={actualTransfer} />

            {/* Row 2: OUTFLOWS — tiền ra */}
            <Card 
                label="Chi phí ca" 
                value={dailyExpense || 0} 
                valueClass="text-danger" 
                prefix="- " 
                onClick={onDailyExpenseClick}
            />
            <Card 
                label="Mua NVL" 
                value={refillTotal} 
                valueClass={refillTotal > 0 ? 'text-danger' : 'text-text-dim'} 
                prefix={refillTotal > 0 ? '- ' : ''} 
                onClick={onRefillClick}
            />

            {/* Row 3: Thực nhận (đối soát tổng) — full width */}
            <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between">
                <div className="flex flex-col">
                    <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Thực nhận</h3>
                    <div className="text-[18px] font-bold text-success tabular-nums">{formatVND(actualTotal)}</div>
                </div>
                {shiftClosing && (
                    <div className="flex flex-col items-end">
                        <span className="text-[10px] font-black text-text-secondary uppercase mb-1 opacity-70">Đối soát DT</span>
                        <div className={`px-3 py-1 rounded-xl border ${isMatch ? 'bg-success/10 border-success/20 text-success' : 'bg-danger/10 border-danger/20 text-danger'}`}>
                            <span className="text-[12px] font-black tabular-nums leading-none block">
                                {isMatch ? 'Khớp' : (diff > 0 ? '+' : '') + formatVND(diff)}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Row 4: Cầm về thực — luôn hiển thị */}
            <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between">
                <div className="flex flex-col">
                    <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Cầm về thực</h3>
                    <div className="text-[18px] font-bold text-success tabular-nums">{formatVND(takeHome)}</div>
                </div>
                {takeHomeSub && (
                    <div className="text-[11px] font-bold text-text-dim tabular-nums text-right leading-relaxed">
                        {takeHomeSub.split(' · ').map((s, i) => <div key={i}>{s}</div>)}
                    </div>
                )}
            </div>
        </div>
    )
}
