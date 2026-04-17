import { Filter } from "lucide-react";
import { formatVND } from "../../utils";

export default function ProfitCard({ totalCups, selectedProductId, onFilterChange, products, soldProducts, totalRevenue, shiftClosing, productStats }) {
    const selectedProduct = selectedProductId !== 'all' ? products.find(p => p.id === selectedProductId) : null;

    const actualTotal = shiftClosing ? ((shiftClosing.actual_cash || 0) + (shiftClosing.actual_transfer || 0)) : 0;
    const systemTotal = shiftClosing ? (shiftClosing.system_total_revenue || 0) : 0;
    const difference = actualTotal - systemTotal;

    // Per-product stats when a single product is selected
    const singleStats = selectedProduct && productStats?.[selectedProductId]
        ? productStats[selectedProductId]
        : null;
    const singleProfit = singleStats ? singleStats.revenue - singleStats.cost : 0;
    const singleMargin = singleStats && singleStats.revenue > 0
        ? (singleProfit / singleStats.revenue) * 100
        : 0;

    // Display values
    const displayRevenue = singleStats ? singleStats.revenue : totalRevenue;

    return (
        <div className="flex flex-col gap-3">
            {/* ── Combined "Tổng cộng + Doanh thu" card (like Thực nhận layout) ── */}
            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 relative overflow-hidden">
                <div className="flex items-center justify-between">
                    <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center mb-1">
                            <span className="text-[11px] font-black text-text-secondary uppercase">Tổng cộng</span>
                        </div>
                        <span className="text-[17px] font-black text-text-primary tabular-nums leading-none truncate">
                            {totalCups} ly {selectedProduct ? selectedProduct.name.toLowerCase() : ''}
                        </span>
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

                {/* Progress bar — only when a single product is filtered */}
                {singleStats && (
                    <div className="mt-3 pt-3 border-t border-border/30">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold text-text-dim">Vốn {formatVND(singleStats.cost)}</span>
                            <span className={`text-[10px] font-black tabular-nums ${singleProfit >= 0 ? 'text-success' : 'text-danger'}`}>
                                Lãi {singleMargin.toFixed(0)}%
                            </span>
                        </div>
                        <div className="h-[6px] rounded-full bg-border/30 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-success transition-all duration-300"
                                style={{ width: `${Math.max(2, singleMargin)}%` }}
                            ></div>
                        </div>
                    </div>
                )}
            </div>

            {/* Cash & Transfer cards */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="text-[12px] font-black text-text-secondary uppercase">
                            Tiền mặt
                        </h3>
                    </div>
                    <div className="text-[18px] font-bold text-primary tabular-nums">
                        {formatVND(shiftClosing?.actual_cash || 0)}
                    </div>
                </div>
                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="text-[12px] font-black text-text-secondary uppercase">
                            Chuyển khoản
                        </h3>
                    </div>
                    <div className="text-[18px] font-bold text-primary tabular-nums">
                        {formatVND(shiftClosing?.actual_transfer || 0)}
                    </div>
                </div>
            </div>

            {shiftClosing && (
                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between relative overflow-hidden mt-1">
                    <div className="flex flex-col">
                        <span className="text-[11px] font-black text-text-secondary uppercase mb-1">Thực nhận</span>
                        <span className="text-[18px] font-black text-success tabular-nums leading-none">{formatVND(actualTotal)}</span>
                    </div>
                    <div className="flex flex-col items-center">
                        <span className="self-center text-[10px] font-black text-text-secondary uppercase mb-1 opacity-70">Chênh lệch</span>
                        <div className={`px-3 py-1 rounded-xl border ${difference >= 0 ? 'bg-success/10 border-success/20 text-success' : 'bg-danger/10 border-danger/20 text-danger'}`}>
                            <span className="text-[14px] font-black tabular-nums leading-none block">
                                {difference >= 0 ? '+' : ''}{formatVND(difference)}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
