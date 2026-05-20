import { formatVND } from '../../utils'

export default function CashFlowCard({
    shiftClosing,
    cash: cashProp,
    transfer: transferProp,
    dailyExpense,
    onDailyExpenseClick,
    salesCard
}) {
    const actualCash = cashProp ?? (shiftClosing?.actual_cash || 0)
    const actualTransfer = transferProp ?? (shiftClosing?.actual_transfer || 0)

    // Thực thu = Tiền mặt + Chuyển khoản + Chi phí phát sinh trong ca
    const actualTotal = actualCash + actualTransfer + (dailyExpense || 0)

    return (
        <div className="flex flex-col gap-4">
            {salesCard && <div className="w-full">{salesCard}</div>}

            {/* THỰC THU TRONG CA PANEL */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Thực thu</h3>
                <div className="flex flex-col gap-2.5 pl-2">
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">Tiền mặt</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(actualCash)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">Chuyển khoản</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(actualTransfer)}
                        </span>
                    </div>
                    <div
                        onClick={onDailyExpenseClick}
                        className="flex justify-between items-center cursor-pointer hover:opacity-85 active:scale-[0.99] transition-all"
                    >
                        <span className="text-[12px] font-bold text-text-secondary decoration-text-secondary/50 underline-offset-2">
                            Chi phí phát sinh
                        </span>
                        <span className="text-[13px] font-bold text-warning tabular-nums">
                            {formatVND(dailyExpense || 0)}
                        </span>
                    </div>
                </div>
                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng thực thu</span>
                    <span className="text-[16px] font-black text-success tabular-nums">
                        {formatVND(actualTotal)}
                    </span>
                </div>
            </div>
        </div>
    )
}
