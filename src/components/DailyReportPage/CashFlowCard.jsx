import { formatVND } from '../../utils'

export function Card({ label, value, valueClass = 'text-primary', prefix = '', sub = null, className = '', onClick = null }) {
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

export default function CashFlowCard({ shiftClosing, cash: cashProp, transfer: transferProp, dailyExpense, onDailyExpenseClick }) {
    const actualCash = cashProp ?? (shiftClosing?.actual_cash || 0)
    const actualTransfer = transferProp ?? (shiftClosing?.actual_transfer || 0)

    // Thực nhận = TM + CK + chi phí ca (không bao gồm mua NVL vì NVL mua sau khi chốt ca)
    const actualTotal = actualCash + actualTransfer + (dailyExpense || 0)

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
                </div>
            </div>
        </div>
    )
}
