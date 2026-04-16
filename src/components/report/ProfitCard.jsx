import { Filter } from "lucide-react";
import { formatVND } from "../../utils";

export default function ProfitCard({ totalCups, selectedProductId, onFilterChange, products, soldProducts, totalRevenue, shiftClosing }) {
    const selectedProduct = selectedProductId !== 'all' ? products.find(p => p.id === selectedProductId) : null;

    const actualTotal = shiftClosing ? ((shiftClosing.actual_cash || 0) + (shiftClosing.actual_transfer || 0)) : 0;
    const systemTotal = shiftClosing ? (shiftClosing.system_total_revenue || 0) : 0;
    const difference = actualTotal - systemTotal;

    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="text-[12px] font-black text-text-secondary uppercase">
                            Tổng cộng
                        </h3>
                        <div className="relative flex items-center justify-center w-6 h-6 bg-surface-light rounded-full border border-border/40 text-text-secondary hover:text-primary transition-colors cursor-pointer">
                            <Filter size={12} className={selectedProductId !== 'all' ? "text-primary" : ""} />
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
                    <div className="text-[18px] font-bold text-text-primary tabular-nums break-words leading-tight">
                        {totalCups} ly {selectedProduct ? `${selectedProduct.name.toLowerCase()}` : ''}
                    </div>
                </div>

                <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="text-[12px] font-black text-text-secondary uppercase">
                            Doanh Thu
                        </h3>
                    </div>
                    <div className="text-[18px] font-bold text-success tabular-nums">
                        {formatVND(totalRevenue || 0)}
                    </div>
                </div>
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
