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

export default function CashFlowCard({ shiftClosing, cash: cashProp, transfer: transferProp, dailyExpense, refillTotal = 0, totalRevenue = 0, yesterdayTakeHome, compareLabel = 'So với hôm qua', onDailyExpenseClick, onRefillClick }) {
    const actualCash = cashProp ?? (shiftClosing?.actual_cash || 0)
    const actualTransfer = transferProp ?? (shiftClosing?.actual_transfer || 0)

    // Thực nhận = TM + CK + chi phí ca (không bao gồm mua NVL vì NVL mua sau khi chốt ca)
    const actualTotal = actualCash + actualTransfer + (dailyExpense || 0)

    // Cầm về thực = TM + CK - mua NVL (tiền thực trong túi sau khi trừ NVL đã mua)
    // Ưu tiên trừ tiền mặt trước, nếu dư thì trừ chuyển khoản
    const takeHomeCash = Math.max(0, actualCash - refillTotal)
    const remainingRefill = Math.max(0, refillTotal - actualCash)
    const takeHomeTransfer = Math.max(0, actualTransfer - remainingRefill)
    const takeHome = takeHomeCash + takeHomeTransfer

    const takeHomeSub = refillTotal > 0 && (takeHomeCash > 0 || takeHomeTransfer > 0)
        ? `TM ${formatVND(takeHomeCash)} · CK ${formatVND(takeHomeTransfer)}`
        : null

    const diff = actualTotal - totalRevenue
    const isMatch = Math.abs(diff) < 1000

    return (
        <div className="flex flex-col gap-4">
            {/* PHẦN 1: TỔNG THU TRONG CA */}
            <div className="grid grid-cols-2 gap-3">
                <Card label="Tiền mặt" value={actualCash} />
                <Card label="Chuyển khoản" value={actualTransfer} />

                <Card
                    label="Chi tiêu"
                    value={dailyExpense || 0}
                    valueClass="text-primary"
                    onClick={onDailyExpenseClick}
                />

                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                    <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Thực thu</h3>
                    <div className="text-[18px] font-bold text-success tabular-nums">
                        {formatVND(actualTotal)}
                    </div>
                    {/* {shiftClosing && (
                        <div className="mt-1 flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-text-secondary uppercase opacity-70">Đối soát POS:</span>
                            <span className={`text-[10px] font-black tabular-nums ${isMatch ? 'text-success' : 'text-danger'}`}>
                                {isMatch ? 'Khớp' : (diff > 0 ? '+' : '') + formatVND(diff)}
                            </span>
                        </div>
                    )} */}
                </div>
            </div>

            {/* DIVIDER BƯỚC 2 */}
            <div className="flex items-center gap-3 py-0.5 px-4">
                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Sau chốt ca</span>
                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
            </div>

            {/* PHẦN 2: ĐI CHỢ & MANG VỀ */}
            <div className="grid grid-cols-2 gap-3">
                <Card
                    label="Chi tiêu"
                    value={dailyExpense || 0}
                    valueClass="text-danger"
                    prefix={dailyExpense > 0 ? '-' : ''}
                    onClick={onDailyExpenseClick}
                />
                <Card
                    label="Đi chợ"
                    value={refillTotal}
                    valueClass='text-danger'
                    prefix={refillTotal > 0 ? '-' : ''}
                    onClick={onRefillClick}
                />

                {/* Cầm về thực — full width with comparison */}
                {(() => {
                    const hasYesterday = yesterdayTakeHome !== null && yesterdayTakeHome !== undefined
                    const delta = hasYesterday ? takeHome - yesterdayTakeHome : 0
                    const isUp = delta >= 0
                    return (
                        <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between relative overflow-hidden group">
                            <div className="flex flex-col">
                                <h3 className="text-[11px] font-black text-text-secondary uppercase mb-1">Thực nhận</h3>
                                <div className="text-[18px] font-bold tabular-nums text-success">
                                    {formatVND(takeHome)}
                                </div>
                                {/* {takeHomeSub && <div className="text-[10px] font-bold text-text-dim tabular-nums mt-1">{takeHomeSub}</div>} */}
                            </div>
                            {hasYesterday && (
                                <div className="flex flex-col items-center">
                                    <span className="self-center text-[10px] font-black text-text-secondary uppercase mb-1 opacity-70">{compareLabel}</span>
                                    <div className={`px-3 py-1 rounded-xl border ${isUp ? 'bg-success/10 border-success/20 text-success' : 'bg-danger/10 border-danger/20 text-danger'}`}>
                                        <span className="text-[12px] font-black tabular-nums leading-none block">
                                            {(isUp && delta > 0 ? '+' : '')}{formatVND(delta)}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })()}
            </div>
        </div>
    )
}
