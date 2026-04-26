import { Filter } from "lucide-react";
import { formatVND } from "../../utils";

export default function ProfitCard({ totalCups, selectedProductId, onFilterChange, products, soldProducts, totalRevenue, dailyExpense, shiftClosing, productStats }) {
    const selectedProduct = selectedProductId !== 'all' ? products.find(p => p.id === selectedProductId) : null;

    const actualTotal = (shiftClosing?.actual_cash || 0) + (shiftClosing?.actual_transfer || 0) + (dailyExpense || 0);
    const systemTotal = shiftClosing?.system_total_revenue || 0;
    const difference = actualTotal - systemTotal;

    const singleStats = selectedProduct && productStats?.[selectedProductId]
        ? productStats[selectedProductId]
        : null;
    const singleProfit = singleStats ? singleStats.revenue - singleStats.cost : 0;
    const singleMargin = singleStats && singleStats.revenue > 0
        ? (singleProfit / singleStats.revenue) * 100
        : 0;

    const displayRevenue = singleStats ? singleStats.revenue : totalRevenue;

    return (
        <div className="flex flex-col gap-3">
            {/* Cash & Transfer from shift closing */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center">
                    <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Tiền mặt</h3>
                    <div className="text-[18px] font-bold text-primary tabular-nums">{formatVND(shiftClosing?.actual_cash || 0)}</div>
                </div>
                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center">
                    <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chuyển khoản</h3>
                    <div className="text-[18px] font-bold text-primary tabular-nums">{formatVND(shiftClosing?.actual_transfer || 0)}</div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center">
                    <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chi phí ngày</h3>
                    <div className="text-[18px] font-bold text-danger tabular-nums">{formatVND(dailyExpense || 0)}</div>
                </div>
                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center">
                    <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Thực nhận</h3>
                    <div className="text-[18px] font-bold text-success tabular-nums">{formatVND(actualTotal || 0)}</div>
                </div>
            </div>

            {shiftClosing && systemTotal > 0 && (
                <div className={`rounded-[20px] px-4 py-3 border flex items-center justify-between ${
                    difference === 0
                        ? 'bg-success/8 border-success/20'
                        : difference > 0
                            ? 'bg-warning/8 border-warning/20'
                            : 'bg-danger/8 border-danger/20'
                }`}>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase text-text-secondary tracking-wide">Đối soát tiền</span>
                        <span className="text-[11px] text-text-dim mt-0.5">Hệ thống ghi: <span className="font-bold text-text">{formatVND(systemTotal)}</span></span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className={`text-[16px] font-black tabular-nums leading-none ${
                            difference === 0 ? 'text-success' : difference > 0 ? 'text-warning' : 'text-danger'
                        }`}>
                            {difference === 0 ? 'Khớp' : difference > 0 ? `+${formatVND(difference)}` : `-${formatVND(Math.abs(difference))}`}
                        </span>
                        <span className="text-[10px] text-text-dim mt-0.5">
                            {difference === 0 ? 'Tiền khớp hệ thống' : difference > 0 ? 'Dư so hệ thống' : 'Thiếu so hệ thống'}
                        </span>
                    </div>
                </div>
            )}

            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 relative overflow-hidden">
                <div className="flex items-start justify-between">
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[11px] font-black text-text-secondary uppercase mb-1">Tổng cộng</span>
                        <span className="text-[17px] font-bold text-primary tabular-nums leading-none truncate">
                            {totalCups} ly {selectedProduct ? selectedProduct.name.toLowerCase() : ''}
                        </span>
                        {singleStats && singleStats.variants && Object.keys(singleStats.variants).length > 0 && (
                            <div className="flex flex-col gap-0.5 mt-1.5">
                                {Object.entries(singleStats.variants)
                                    .sort((a, b) => b[1] - a[1])
                                    .map(([label, qty]) => (
                                        <span key={label} className="text-[11px] text-text-secondary tabular-nums">
                                            · {label}: <span className="font-black text-text">{qty} ly</span>
                                        </span>
                                    ))}
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-3">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[11px] font-black text-text-secondary uppercase">Doanh thu</span>
                            <div className="relative flex items-center justify-center w-5 h-5 bg-surface-light rounded-full border border-border/40 text-text-secondary hover:text-primary transition-colors cursor-pointer">
                                <Filter size={10} className={selectedProductId !== 'all' ? "text-primary" : ""} />
                                <select
                                    value={selectedProductId}
                                    onChange={(e) => onFilterChange(e.target.value)}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                >
                                    <option value="all">Tất cả</option>
                                    {products.filter(p => soldProducts.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className={`px-3 py-1 rounded-xl border ${displayRevenue > 0 ? 'bg-success/10 border-success/20 text-success' : 'bg-surface-light border-border/40 text-text-secondary'}`}>
                            <span className="text-[13px] font-black tabular-nums leading-none block">
                                {formatVND(displayRevenue || 0)}
                            </span>
                        </div>
                    </div>
                </div>

                {singleStats && (
                    <div className="mt-3 pt-3 border-t border-border/30">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-black tabular-nums text-primary">
                                {totalRevenue > 0 ? ((singleStats.revenue / totalRevenue) * 100).toFixed(1) : 0}%
                            </span>
                            <span className="text-[10px] font-bold text-primary">100%</span>
                        </div>
                        <div className="h-[6px] rounded-full bg-border/30 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-primary transition-all duration-300"
                                style={{ width: `${totalRevenue > 0 ? Math.max(2, (singleStats.revenue / totalRevenue) * 100) : 0}%` }}
                            ></div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
