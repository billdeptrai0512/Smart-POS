import { useMemo } from 'react'
import { formatVND } from '../../utils'
import { buildCategoryBreakdown } from '../../utils/expenseCategoryBreakdown'

// Per-period P&L breakdown. Replaces the hardcoded 6+3 row list with category-
// driven rendering: each expense_categories row is one line in either the
// Operating ("Chi phí vận hành") or Overhead ("Chi phí quản lý & khác") card.
//
// "Thực chi" model: every entry comes from a real expense row tagged with a
// category. No more template × days projection — what you spent is what you see.
//
// Inputs:
//   - totalRevenue / totalCOGS / netProfit / yesterdayNetProfit: kept as scalar
//     props since the parent has the full picture (range scaling, prev period).
//   - expenses: raw rows for the period. We filter inside (skip NVL refills).
//   - expenseCategories: address's tag list. Categories missing from this list
//     (soft-deleted) fall back to "Chi phí khác" of the same group_section.
export default function FinanceCards({
    totalRevenue,
    totalDiscount = 0,
    totalCOGS,
    netProfit,
    yesterdayNetProfit,
    compareLabel = 'So với hôm trước',
    expenses = [],
    expenseCategories = [],
    onRecipesClick,
    // Category split of totalCOGS — caller passes raw bucket; we normalize so lines sum to totalCOGS.
    // Tools is folded into packaging per UX decision ("Bao bì (ly, nắp, ống hút, dụng cụ...)").
    cogsByCategory = null,
    // Σ|hao hụt × unit_cost| over the period — added on top of totalCOGS as a separate line.
    lossValue = 0,
}) {
    const { operatingRows, overheadRows, operatingTotal, overheadTotal } = useMemo(
        () => buildCategoryBreakdown({ expenses, expenseCategories }),
        [expenses, expenseCategories]
    )

    const cogsLines = useMemo(() => {
        const main = Math.max(0, cogsByCategory?.main || 0)
        const packTools = Math.max(0, (cogsByCategory?.packaging || 0) + (cogsByCategory?.tools || 0))
        const sum = main + packTools
        if (sum <= 0) return { direct: totalCOGS, packaging: 0 }
        // Rescale so the two lines add up to totalCOGS — keeps numbers consistent
        // even when current-recipe split drifts from snapshot order.total_cost.
        const scale = totalCOGS / sum
        const packagingScaled = Math.round(packTools * scale)
        return { direct: totalCOGS - packagingScaled, packaging: packagingScaled }
    }, [cogsByCategory, totalCOGS])

    const cogsTotal = totalCOGS + lossValue
    const grossProfit = totalRevenue - cogsTotal
    const operatingProfit = grossProfit - operatingTotal

    return (
        <div className="grid grid-cols-2 gap-3.5">
            {/* 1. DOANH THU — "Bán hàng" is gross (net + discount); "Doanh thu thuần" stays net. */}
            <SimpleCard title="Doanh thu" totalLabel="Doanh thu thuần" totalAmount={totalRevenue} totalTone="success">
                <LineItem label="· Bán hàng" amount={totalRevenue + totalDiscount} />
                <LineItem label="· Giảm giá" amount={-totalDiscount || 0} />
            </SimpleCard>

            {/* 2. GIÁ VỐN (COGS) */}
            <SimpleCard title="Giá vốn (COGS)" totalLabel="Tổng giá vốn" totalAmount={cogsTotal} totalTone="warning">
                <LineItem label="· Nguyên liệu trực tiếp" amount={cogsLines.direct} />
                <LineItem label="· Bao bì (ly, nắp, ống hút...)" amount={cogsLines.packaging} />
                <LineItem label="· Hao hụt / hủy" amount={lossValue} />
            </SimpleCard>

            {/* 3. LỢI NHUẬN GỘP */}
            <ProfitBanner label="Lợi nhuận gộp" amount={grossProfit} onClick={onRecipesClick}>
                <div className="flex justify-between items-center mt-2 pl-1">
                    <span className="text-[11px] font-bold text-text-secondary uppercase">Biên lợi nhuận gộp</span>
                    <span className="text-[13px] font-black text-success tabular-nums">
                        {totalRevenue > 0 ? ((grossProfit) / totalRevenue * 100).toFixed(2) : '0.00'}%
                    </span>
                </div>
            </ProfitBanner>

            {/* 4. CHI PHÍ VẬN HÀNH — dynamic by category */}
            <SimpleCard title="Chi phí vận hành" totalLabel="Tổng chi phí vận hành" totalAmount={operatingTotal} totalTone="danger">
                {operatingRows.length === 0
                    ? <span className="text-[12px] text-text-secondary italic pl-1">Chưa có chi phí vận hành</span>
                    : operatingRows.map(r => (
                        <LineItem key={r.id} label={`· ${r.name}`} amount={r.amount} />
                    ))
                }
            </SimpleCard>

            {/* 5. LỢI NHUẬN VẬN HÀNH */}
            <ProfitBanner label="Lợi nhuận vận hành" amount={operatingProfit} onClick={onRecipesClick} />

            {/* 6. CHI PHÍ QUẢN LÝ & KHÁC — dynamic by category */}
            <SimpleCard title="Chi phí quản lý & khác" totalLabel="Tổng chi phí khác" totalAmount={overheadTotal} totalTone="danger">
                {overheadRows.length === 0
                    ? <span className="text-[12px] text-text-secondary italic pl-1">Chưa có chi phí quản lý & khác</span>
                    : overheadRows.map(r => (
                        <LineItem key={r.id} label={`· ${r.name}`} amount={r.amount} />
                    ))
                }
            </SimpleCard>

            {/* 7. LỢI NHUẬN RÒNG (NET PROFIT) */}
            <NetProfitCard netProfit={netProfit} yesterdayNetProfit={yesterdayNetProfit} compareLabel={compareLabel} />
        </div>
    )
}

// ─── Subcomponents ──────────────────────────────────────────────────────────
function SimpleCard({ title, totalLabel, totalAmount, totalTone, children }) {
    const toneCls = totalTone === 'success' ? 'text-success' : totalTone === 'warning' ? 'text-warning' : 'text-danger'
    return (
        <div className="col-span-2 bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
            <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">{title}</h3>
            <div className="flex flex-col gap-2 pl-2">{children}</div>
            <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
            <div className="flex justify-between items-center mt-1 pl-1">
                <span className="text-[13px] font-black text-text uppercase tracking-wide">{totalLabel}</span>
                <span className={`text-[16px] font-black tabular-nums ${toneCls}`}>{formatVND(totalAmount)}</span>
            </div>
        </div>
    )
}

function LineItem({ label, amount }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-[12px] font-bold text-text-secondary">{label}</span>
            <span className="text-[13px] font-bold text-text tabular-nums">{formatVND(amount)}</span>
        </div>
    )
}

function ProfitBanner({ label, amount, onClick, children }) {
    // Lợi nhuận âm → tô đỏ (danger) như NetProfitCard, không cứng màu xanh.
    const isPositive = amount >= 0
    return (
        <div
            onClick={onClick}
            className={`col-span-2 active:scale-[0.98] transition-all rounded-[24px] p-5 shadow-sm border flex flex-col justify-center relative overflow-hidden group cursor-pointer
                ${isPositive ? 'bg-success/[0.03] border-success/30 hover:bg-success/[0.06]' : 'bg-danger/[0.03] border-danger/30 hover:bg-danger/[0.06]'}`}
        >
            <div className={`absolute top-0 left-0 w-1.5 h-full ${isPositive ? 'bg-success/60' : 'bg-danger/60'}`} />
            <div className="flex justify-between items-center pl-1">
                <span className="text-[13px] font-black text-text uppercase tracking-wide">{label}</span>
                <span className={`text-[16px] font-black tabular-nums ${isPositive ? 'text-success' : 'text-danger'}`}>{formatVND(amount)}</span>
            </div>
            {children}
        </div>
    )
}

function NetProfitCard({ netProfit, yesterdayNetProfit, compareLabel }) {
    const hasYesterday = yesterdayNetProfit !== null && yesterdayNetProfit !== undefined
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
                {hasYesterday && false /* compare row currently disabled — keep prop for future */ && (
                    <div className="flex justify-between items-center pl-1">
                        <span className="self-end text-[10px] font-black text-text-secondary uppercase mb-1.5 opacity-80">{compareLabel}</span>
                    </div>
                )}
            </div>
        </div>
    )
}
