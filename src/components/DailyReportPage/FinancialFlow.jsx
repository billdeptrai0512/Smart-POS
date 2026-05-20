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
    // Vận hành = chi phí ca + free-form refill (sau ca nhưng vẫn là vận hành, không phải NVL).
    const operationalExpense = (dailyExpense || 0) + (refillFreeForm || 0)

    // Thực thu = TM + CK + chi phí ca trong ca (refill sau ca không cộng vào,
    // vì cash đã được đếm trước khi xảy ra refill — không cần "trả về" gross).
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
            <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between relative overflow-hidden group">
                <div className="flex flex-col flex-1 items-start text-left">
                    <h3 className="text-[11px] font-black text-text-secondary uppercase mb-1">Tổng thực thu</h3>
                    <div className="text-[16px] font-bold tabular-nums text-success">
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
            {/* Vận hành = chi phí trong ca + free-form sau ca (vận hành ≠ timing). */}
            {/* Tồn kho = chỉ tiền mua NVL thực (refillNvl). */}
            <div className="grid grid-cols-2 gap-3">
                <Card
                    label="Tổng chi phí trong ngày"
                    value={operationalExpense}
                    valueClass="text-danger"
                    prefix={operationalExpense > 0 ? '-' : ''}
                    onClick={onDailyExpenseClick}
                    className="col-span-2"
                />
                <Card
                    label="Chi phí mua nguyên vật liệu"
                    value={refillNvl}
                    valueClass='text-danger'
                    prefix={refillNvl > 0 ? '-' : ''}
                    onClick={onRefillClick}
                    className="col-span-2"
                />

                {/* Cầm về thực — full width with comparison */}
                <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between relative overflow-hidden group">
                    <div className="flex flex-col flex-1 items-start text-left">
                        <h3 className="text-[11px] font-black text-text-secondary uppercase mb-1">Tổng thực nhận</h3>
                        <div className="text-[16px] font-bold tabular-nums text-success">
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
