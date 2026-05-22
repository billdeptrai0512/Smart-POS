import { formatVND } from '../../utils'

export default function FinanceCards({
    totalRevenue,
    totalCOGS,
    dailyExpense,
    refillNvl,
    refillFreeForm,
    fixedExpense,
    netProfit,
    onRecipesClick,
    onDailyExpenseClick,
    onRefillNvlClick,
    onRefillFreeFormClick,
    onFixedExpenseClick,
    yesterdayNetProfit,
    compareLabel = 'So với hôm trước'
}) {
    return (
        <div className="grid grid-cols-2 gap-3.5">
            {/* 1. DOANH THU */}
            <div className="col-span-2 bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Doanh thu</h3>
                <div className="flex flex-col gap-2 pl-2">
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Bán hàng:</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(totalRevenue)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Giảm giá:</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>
                </div>
                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Doanh thu thuần</span>
                    <span className="text-[16px] font-black text-success tabular-nums">
                        {formatVND(totalRevenue)}
                    </span>
                </div>
            </div>

            {/* 2. GIÁ VỐN (COGS) */}
            <div className="col-span-2 bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Giá vốn (COGS)</h3>
                <div className="flex flex-col gap-2 pl-2">
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Nguyên liệu trực tiếp:</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(totalCOGS)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Bao bì (ly, nắp, ống hút...):</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Hao hụt / hủy:</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>
                </div>
                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng giá vốn</span>
                    <span className="text-[16px] font-black text-warning tabular-nums">
                        {formatVND(totalCOGS)}
                    </span>
                </div>
            </div>

            {/* 3. LỢI NHUẬN GỘP */}
            <div
                onClick={onRecipesClick}
                className="col-span-2 bg-success/[0.03] border-success/30 hover:bg-success/[0.06] active:scale-[0.98] transition-all rounded-[24px] p-5 shadow-sm border flex flex-col justify-center relative overflow-hidden group cursor-pointer"
            >
                <div className="absolute top-0 left-0 w-1.5 h-full bg-success/60" />
                <div className="flex justify-between items-center pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Lợi nhuận gộp</span>
                    <span className="text-[16px] font-black text-success tabular-nums">
                        {formatVND(totalRevenue - totalCOGS)}
                    </span>
                </div>
                <div className="flex justify-between items-center mt-2 pl-1">
                    <span className="text-[11px] font-bold text-text-secondary uppercase">Biên lợi nhuận gộp</span>
                    <span className="text-[13px] font-black text-success tabular-nums">
                        {totalRevenue > 0 ? ((totalRevenue - totalCOGS) / totalRevenue * 100).toFixed(2) : '0.00'}%
                    </span>
                </div>
            </div>

            {/* 3.Chi phi vận hành */}
            <div className="col-span-2 bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Chi phí vận hành</h3>
                <div className="flex flex-col gap-2 pl-2">
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Lương nhân viên</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(dailyExpense)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Thuê mặt bằng</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Điện nước</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Marketing</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Phần mềm / Hệ thống</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Chi phí khác</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>
                </div>
                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng chi phí vận hành</span>
                    <span className="text-[16px] font-black text-danger tabular-nums">
                        {formatVND(dailyExpense)}
                    </span>
                </div>
            </div>

            {/* 5. LỢI NHUẬN Vận hành */}
            <div
                onClick={onRecipesClick}
                className="col-span-2 bg-success/[0.03] border-success/30 hover:bg-success/[0.06] active:scale-[0.98] transition-all rounded-[24px] p-5 shadow-sm border flex flex-col justify-center relative overflow-hidden group cursor-pointer"
            >
                <div className="absolute top-0 left-0 w-1.5 h-full bg-success/60" />
                <div className="flex justify-between items-center pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Lợi nhuận vận hành</span>
                    <span className="text-[16px] font-black text-success tabular-nums">
                        {formatVND(totalRevenue - totalCOGS - dailyExpense)}
                    </span>
                </div>
            </div>

            {/* 3.Chi phi vận hành */}
            <div className="col-span-2 bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Chi phí quản lý & khác</h3>
                <div className="flex flex-col gap-2 pl-2">
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Lương quản lý</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(dailyExpense)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Khấu hao máy móc </span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">· Chi phí tài chính</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">0đ</span>
                    </div>

                </div>
                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng chi phí khác</span>
                    <span className="text-[16px] font-black text-danger tabular-nums">
                        {formatVND(dailyExpense)}
                    </span>
                </div>
            </div>



            {/* 5. LỢI NHUẬN RÒNG (NET PROFIT) */}
            {(() => {
                const hasYesterday = yesterdayNetProfit !== null && yesterdayNetProfit !== undefined
                const delta = hasYesterday ? netProfit - yesterdayNetProfit : 0
                const isUp = delta >= 0
                const isPositive = netProfit >= 0
                return (
                    <div className={`col-span-2 rounded-[24px] p-5 shadow-sm border flex items-center justify-between relative overflow-hidden
                        ${isPositive ? 'bg-success/[0.04] border-success/30' : 'bg-danger/[0.04] border-danger/30'}`}
                    >
                        <div className={`absolute top-0 left-0 w-1.5 h-full ${isPositive ? 'bg-success/80' : 'bg-danger/80'}`} />
                        <div className="flex-1 flex flex-col justify-center">
                            <div className="flex justify-between items-center pl-1">
                                <h3 className="text-[14px] font-black text-text/80 uppercase tracking-wide">Lợi nhuận ròng</h3>
                                <div className={`text-[16px] font-black tabular-nums ${isPositive ? 'text-success' : 'text-danger'}`}>
                                    {formatVND(netProfit)}
                                </div>
                            </div>
                            {/* {hasYesterday && (
                                <div className="flex justify-between items-center pl-1">
                                    <span className="self-end text-[10px] font-black text-text-secondary uppercase mb-1.5 opacity-80">{compareLabel}</span>
                                    <span className={`text-[12px] font-black tabular-nums leading-none block ${isUp ? 'text-success' : 'text-danger'}`}>
                                        {(isUp && delta > 0 ? '+' : '')}{formatVND(delta)}
                                    </span>
                                </div>
                            )} */}
                        </div>


                    </div>
                )
            })()}
        </div>
    )
}
