import { formatVND } from '../../utils'
import { Card } from './CashFlowCard'

export default function FinancialFlow({
    actualCash = 0,
    actualTransfer = 0,
    dailyExpense = 0,
    refillTotal = 0,
    refillNvl = 0,
    refillFreeForm = 0,
    yesterdayActualTotal,
    yesterdayTakeHome,
    compareLabel = 'So với hôm qua',
    onDailyExpenseClick,
    onRefillClick
}) {
    // Thực nhận = TM + CK + chi phí ca (không bao gồm mua NVL vì NVL mua sau khi chốt ca)
    const actualTotal = actualCash + actualTransfer + (dailyExpense || 0)

    // Cầm về thực = TM + CK - mua NVL (tiền thực trong túi sau khi trừ NVL đã mua)
    // Ưu tiên trừ tiền mặt trước, nếu dư thì trừ chuyển khoản
    const takeHomeCash = Math.max(0, actualCash - refillTotal)
    const remainingRefill = Math.max(0, refillTotal - actualCash)
    const takeHomeTransfer = Math.max(0, actualTransfer - remainingRefill)
    const takeHome = takeHomeCash + takeHomeTransfer

    const hasYesterdayActual = yesterdayActualTotal !== null && yesterdayActualTotal !== undefined
    const totalDelta = hasYesterdayActual ? actualTotal - yesterdayActualTotal : 0
    const isTotalUp = totalDelta >= 0

    const hasYesterdayTakeHome = yesterdayTakeHome !== null && yesterdayTakeHome !== undefined
    const takeHomeDelta = hasYesterdayTakeHome ? takeHome - yesterdayTakeHome : 0
    const isTakeHomeUp = takeHomeDelta >= 0

    return (
        <div className="flex flex-col gap-4">
            {/* DIVIDER BƯỚC 2 */}
            <div className="flex items-center gap-3 py-0.5 px-4">
                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Dòng tiền</span>
                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
            </div>

            <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between relative overflow-hidden group">
                <div className="flex flex-col flex-1 items-start text-left">
                    <h3 className="text-[11px] font-black text-text-secondary uppercase mb-1">Thực thu</h3>
                    <div className="text-[18px] font-bold tabular-nums text-success">
                        {formatVND(actualTotal)}
                    </div>
                </div>
                {hasYesterdayActual && (
                    <div className="flex flex-col items-end">
                        <span className="self-end text-[10px] font-black text-text-secondary uppercase mb-1 opacity-70">{compareLabel}</span>
                        <div className={`px-3 py-1 rounded-xl border ${isTotalUp ? 'bg-success/10 border-success/20 text-success' : 'bg-danger/10 border-danger/20 text-danger'}`}>
                            <span className="text-[12px] font-black tabular-nums leading-none block">
                                {(isTotalUp && totalDelta > 0 ? '+' : '')}{formatVND(totalDelta)}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* PHẦN 2: ĐI CHỢ & MANG VỀ */}
            <div className="grid grid-cols-2 gap-3">
                <Card
                    label="Vận hành"
                    value={dailyExpense || 0}
                    valueClass="text-danger"
                    prefix={dailyExpense > 0 ? '-' : ''}
                    onClick={onDailyExpenseClick}
                />
                <Card
                    label="Tồn kho"
                    value={refillTotal}
                    valueClass='text-danger'
                    prefix={refillTotal > 0 ? '-' : ''}
                    sub={refillNvl > 0 && refillFreeForm > 0
                        ? `🛒 ${formatVND(refillNvl)} · 📦 ${formatVND(refillFreeForm)}`
                        : null}
                    onClick={onRefillClick}
                    alignRight
                />

                {/* Cầm về thực — full width with comparison */}
                <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between relative overflow-hidden group">
                    <div className="flex flex-col flex-1 items-start text-left">
                        <h3 className="text-[11px] font-black text-text-secondary uppercase mb-1">Thực nhận</h3>
                        <div className="text-[18px] font-bold tabular-nums text-success">
                            {formatVND(takeHome)}
                        </div>
                    </div>
                    {hasYesterdayTakeHome && (
                        <div className="flex flex-col items-end">
                            <span className="self-end text-[10px] font-black text-text-secondary uppercase mb-1 opacity-70">{compareLabel}</span>
                            <div className={`px-3 py-1 rounded-xl border ${isTakeHomeUp ? 'bg-success/10 border-success/20 text-success' : 'bg-danger/10 border-danger/20 text-danger'}`}>
                                <span className="text-[12px] font-black tabular-nums leading-none block">
                                    {(isTakeHomeUp && takeHomeDelta > 0 ? '+' : '')}{formatVND(takeHomeDelta)}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
