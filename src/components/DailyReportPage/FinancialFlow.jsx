import { formatVND } from '../../utils'
import { ingredientLabel } from '../common/recipeUtils'

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
    onRefillClick,
    expenses = []
}) {
    const totalExpenses = (dailyExpense || 0) + (refillFreeForm || 0) + (refillNvl || 0)

    const takeHomeCash = Math.max(0, actualCash - refillTotal)
    const remainingRefill = Math.max(0, refillTotal - actualCash)
    const takeHomeTransfer = Math.max(0, actualTransfer - remainingRefill)
    const takeHome = takeHomeCash + takeHomeTransfer

    // Phân loại chi phí — bỏ filter `!e.is_fixed` vì legacy fixed expenses
    // vẫn là thực chi, cần đếm vào. Adjustment rows (manager sửa số tồn kho
    // thủ công, amount=0) skip khỏi list NVL — chỉ hiện refill thực.
    const shiftExpenses = (expenses || []).filter(e => !e.is_refill)
    const afterShiftOps = (expenses || []).filter(e => e.is_refill && e.metadata?.free_form)
    const afterShiftNvl = (expenses || []).filter(e => e.is_refill && !e.metadata?.free_form && !e.metadata?.adjustment)

    const getExpenseName = (e) => {
        if (e.is_refill && !e.metadata?.free_form && e.metadata?.ingredient) {
            return ingredientLabel(e.metadata.ingredient)
        }
        return e.name || 'Chi phí'
    }

    return (
        <div className="flex flex-col gap-4">
            {/* PANEL 1: CHI PHÍ — chia theo thời điểm phát sinh */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Chi phí phát sinh</h3>

                <div className="flex flex-col gap-1 pl-1">
                    {/* <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Phát sinh</span> */}
                    {shiftExpenses.length > 0 ? (
                        shiftExpenses.map((e) => (
                            <div key={e.id} className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">· {e.name || 'Chi phí khác'}</span>
                                <span className="text-[13px] font-bold text-danger tabular-nums">-{formatVND(e.amount)}</span>
                            </div>
                        ))
                    ) : (
                        <span className="text-[12px] text-text-secondary italic">Không có chi phí trong ca</span>
                    )}
                </div>

                <div className="w-full h-[1px] bg-border/40 rounded-full my-3" />

                <div className="flex flex-col gap-1 pl-1">
                    <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Sau chốt ca</span>
                    {afterShiftOps.length > 0 ? (
                        afterShiftOps.map((e) => (
                            <div key={e.id} className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">· {e.name || 'Chi phí khác'}</span>
                                <span className="text-[13px] font-bold text-danger tabular-nums">-{formatVND(e.amount)}</span>
                            </div>
                        ))
                    ) : (
                        <span className="text-[12px] text-text-secondary italic">Không có chi phí sau ca</span>
                    )}
                </div>

                <div className="w-full h-[1px] bg-border/40 rounded-full my-3" />

                <div className="flex flex-col gap-1 pl-1">
                    <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Nguyên vật liệu</span>
                    {afterShiftNvl.length > 0 ? (
                        afterShiftNvl.map((e) => (
                            <div key={e.id} className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">· {getExpenseName(e)}</span>
                                <span className="text-[13px] font-bold text-danger tabular-nums">-{formatVND(e.amount)}</span>
                            </div>
                        ))
                    ) : (
                        <span className="text-[12px] text-text-secondary italic">Không có nguyên vật liệu nhập kho</span>
                    )}
                </div>
            </div>



            {/* PANEL 3: TỔNG CHI PHÍ */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng chi phí</span>
                    <span className="text-[14px] font-black text-danger tabular-nums">
                        -{formatVND(totalExpenses)}
                    </span>
                </div>
            </div>

            {/* PANEL 4: THỰC NHẬN */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Thực nhận</h3>
                <div className="flex flex-col gap-2.5 pl-2">
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">Tiền mặt thực tế:</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(takeHomeCash)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">Chuyển khoản thực tế:</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(takeHomeTransfer)}
                        </span>
                    </div>
                </div>

                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />

                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng thực nhận</span>
                    <span className="text-[16px] font-black text-success tabular-nums">
                        {formatVND(takeHome)}
                    </span>
                </div>
            </div>
        </div>
    )
}
