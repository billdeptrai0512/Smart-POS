import { ArrowRight } from 'lucide-react'
import { formatVND } from '../../utils'

export function Card({ label, value, valueClass = 'text-primary', prefix = '', sub = null, className = '', onClick = null, alignRight = false }) {
    return (
        <div
            onClick={onClick}
            className={`bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center ${alignRight ? 'items-end text-right' : ''} ${onClick ? 'cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all' : ''} ${className}`}
        >
            <div className='flex items-center justify-between'>
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1 truncate">{label}</h3>
                {onClick && <ArrowRight className='text-text-secondary' size={20} strokeWidth={2.5} />}
            </div>
            <div className={`text-[16px] font-bold tabular-nums ${valueClass}`}>
                {prefix}{formatVND(value)}
            </div>
            {sub && <div className="text-[10px] font-bold text-text-dim tabular-nums mt-0.5">{sub}</div>}
        </div>
    )
}

export default function CashFlowCard({ shiftClosing, cash: cashProp, transfer: transferProp, dailyExpense, onDailyExpenseClick, salesCard }) {
    const actualCash = cashProp ?? (shiftClosing?.actual_cash || 0)
    const actualTransfer = transferProp ?? (shiftClosing?.actual_transfer || 0)

    // Thực nhận = TM + CK + chi phí ca (không bao gồm mua NVL vì NVL mua sau khi chốt ca)
    const actualTotal = actualCash + actualTransfer + (dailyExpense || 0)

    return (
        <div className="flex flex-col gap-4">
            {/* PHẦN 1: TỔNG THU TRONG CA */}
            <div className="grid grid-cols-2 gap-3">
                {salesCard && <div className="col-span-2">{salesCard}</div>}
                <Card label="Tiền mặt" value={actualCash} valueClass="text-success" prefix='+' />
                <Card label="Chuyển khoản" value={actualTransfer} valueClass="text-success" prefix='+' alignRight />

                <Card
                    label="Chi phí phát sinh trong ca"
                    value={dailyExpense || 0}
                    valueClass="text-primary"
                    prefix='+'
                    onClick={onDailyExpenseClick}
                    className="col-span-2"
                />

                {/* <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center items-end text-right relative overflow-hidden group">
                    <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Thực thu</h3>
                    <div className="text-[18px] font-bold text-success tabular-nums">
                        {formatVND(actualTotal)}
                    </div>
                </div> */}
            </div>
        </div>
    )
}
