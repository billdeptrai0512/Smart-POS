import { Banknote, ArrowRight, MinusCircle, Activity, PinOff } from 'lucide-react'
import { formatVND } from '../../utils'

export default function FinanceCards({ totalRevenue, totalCOGS, dailyExpense, fixedExpense, netProfit, onRecipesClick, onExpenseClick }) {
    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <div className="absolute top-3 right-3 text-success/20 group-hover:text-success/30 transition-colors">
                    <Banknote size={36} />
                </div>
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Doanh thu</h3>
                <div className="text-[18px] font-bold text-success tabular-nums">
                    {formatVND(totalRevenue)}
                </div>
            </div>
            <div
                onClick={onRecipesClick}
                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
            >
                <div className="absolute top-3 right-3 text-warning/30 group-hover:text-warning/50 transition-colors">
                    <ArrowRight size={36} />
                </div>
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Giá vốn</h3>
                <div className="text-[18px] font-bold text-warning tabular-nums">
                    - {formatVND(totalCOGS)}
                </div>
            </div>
            <div
                onClick={onExpenseClick}
                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
            >
                <div className="absolute top-3 right-3 text-danger/20 group-hover:text-danger/30 transition-colors">
                    <MinusCircle size={36} />
                </div>
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chi phí ngày</h3>
                <div className="text-[18px] font-bold text-danger tabular-nums">
                    - {formatVND(dailyExpense)}
                </div>
            </div>
            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <div className="absolute top-3 right-3 text-warning/20 group-hover:text-warning/30 transition-colors">
                    <PinOff size={36} />
                </div>
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chi phí cố định</h3>
                <div className="text-[18px] font-bold text-warning tabular-nums">
                    - {formatVND(fixedExpense)}
                </div>
            </div>
            {/* Net Profit — full width */}
            <div className="col-span-2 bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <div className="absolute top-4 right-4 text-success/20 group-hover:text-success/30 transition-colors">
                    <Activity size={42} />
                </div>
                <h3 className="text-[13px] font-black text-text-secondary uppercase mb-1">Lợi nhuận ròng</h3>
                <div className={`text-[22px] font-bold tabular-nums ${netProfit >= 0 ? 'text-success' : 'text-danger'}`}>
                    {formatVND(netProfit)}
                </div>
            </div>
        </div>
    )
}
