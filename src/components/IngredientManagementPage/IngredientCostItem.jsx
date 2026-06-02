import { formatVND } from '../../utils'
import { formatPackedQty } from '../../utils/inventory'
import { Plus } from 'lucide-react'

/**
 * Compact ingredient card — read-only summary:
 *   ┌──────────────────────────┐
 *   │ Cà phê             [+]   │  ← name (tap card to open detail)
 *   │ 9180 g                   │  ← hero stock number
 *   │ = 9 bịch + 180 g         │  ← pack breakdown (if pack configured)
 *   │ Tồn đầu / Lấy ra / …     │  ← daily context
 *   │ Giá vốn 248đ/g           │  ← unit cost (manager only)
 *   └──────────────────────────┘
 *
 * All edit affordances (name, stock, unit, pack, category, min-stock, cost)
 * live inside the /ingredients/[key] detail page — card body is a single
 * click target that navigates there. [+] restock + delete still inline.
 */
export default function IngredientCostItem({
    ingredientLabel, getIngredientUnit, ingredient, cost,
    storedUnit,
    canEdit = true,
    minStock,
    // Pack config (quy cách đóng gói) — edit moved to detail page;
    // packSize/packUnit kept for the inline "= X bịch + Y g" display.
    packSize, packUnit,
    // Stock display
    stockData, onRestock,
    // Daily context (always inline)
    dailyContext,
    // Navigation — parent owns scroll-cache save before navigating to detail
    onOpen,
}) {
    const displayUnit = getIngredientUnit(ingredient, storedUnit)

    const currentStock = stockData?.current_stock ?? null
    const isOutStock = currentStock !== null && currentStock <= 0
    const isLowStock = currentStock !== null && currentStock > 0 && currentStock < (minStock || 0)

    const borderClass = isOutStock ? 'border-danger/40' : isLowStock ? 'border-warning/40' : 'border-border/60'
    const textClass = isOutStock ? 'text-danger' : isLowStock ? 'text-warning' : 'text-text'

    return (
        <div
            className={`bg-surface border rounded-[14px] p-3 flex flex-col gap-2 min-w-0 cursor-pointer hover:bg-surface-light/40 transition-colors ${borderClass}`}
            onClick={() => onOpen?.(ingredient)}
        >
            {/* Row 1: name + restock button */}
            <div className="flex items-start gap-1.5 min-w-0">
                <span className="flex-1 min-w-0 text-[14.5px] font-black text-primary leading-tight line-clamp-2 break-words">
                    {ingredientLabel(ingredient)}
                </span>
                {onRestock && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onRestock(ingredient) }}
                        className="shrink-0 -mr-1 -mt-1 w-7 h-7 flex items-center justify-center rounded-lg text-primary bg-primary/10 hover:bg-primary/20 active:scale-95 transition-all"
                        title="Nhập kho"
                    >
                        <Plus size={16} strokeWidth={3} />
                    </button>
                )}
            </div>

            {/* Row 2: hero — tồn kho number + unit + pack breakdown */}
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 min-w-0 -mt-0.5">
                <span className={`text-[19px] font-black tabular-nums leading-none ${textClass}`}>
                    {currentStock !== null ? Math.round(currentStock * 10) / 10 : '—'}
                </span>
                <span className="text-[13.5px] font-bold text-text-secondary leading-none mr-0.5">
                    {displayUnit}
                </span>

                {/* Pack breakdown inline (if pack configured & stock meets pack size) */}
                {currentStock !== null && packSize && packUnit && currentStock >= packSize && (
                    <span className="text-[12.5px] font-semibold text-text-dim tabular-nums leading-none">
                        = {formatPackedQty(currentStock, packSize, packUnit, displayUnit, { compact: true })}
                    </span>
                )}

                {isOutStock && (
                    <span className="ml-auto text-[10px] font-black text-danger uppercase tracking-wide bg-danger/10 px-1.5 py-0.5 rounded-md">Hết</span>
                )}
                {isLowStock && (
                    <span className="ml-auto text-[10px] font-black text-warning uppercase tracking-wide bg-warning/10 px-1.5 py-0.5 rounded-md">Sắp hết</span>
                )}
            </div>

            <div className="mt-1.5 pt-2 border-t border-border/40 flex-1 flex flex-col gap-1.5 text-[12px] tabular-nums">
                {(() => {
                    const todayRefill = Number(dailyContext?.today_refill || 0)
                    const todayRestock = Number(dailyContext?.today_restock || 0)
                    const warehouseNow = stockData?.warehouse_stock ?? 0
                    const warehouseStart = warehouseNow + todayRestock - todayRefill
                    const fmt = (n) => {
                        // Negative values: collapse to base unit only — pack-breakdown of negative
                        // numbers ("-4 hộp + -1.226 ml") reads awkwardly and isn't meaningful.
                        if (n < 0) {
                            const r = Math.round(n * 10) / 10
                            return `${r.toLocaleString('vi-VN')} ${displayUnit}`
                        }
                        return formatPackedQty(n, packSize, packUnit, displayUnit, { compact: true })
                    }
                    return (
                        <>
                            <Row label="Tồn đầu" value={fmt(warehouseStart)} />
                            <Row label="Lấy ra" value={fmt(todayRestock)} sign="-" accent={todayRestock > 0 ? 'text-warning' : ''} />
                            <Row label="Nhập mới" value={fmt(todayRefill)} sign="+" accent={todayRefill > 0 ? 'text-success' : ''} />
                            <Row label="Tồn cuối" value={fmt(warehouseNow)} bold />
                        </>
                    )
                })()}
            </div>

            {/* Row 3: manager-only details — separated by border-top.
                 Nhóm + Quy đổi đã chuyển sang trang chi tiết của ingredient. */}
            {canEdit && (
                <div className="mt-1.5 pt-2 border-t border-border/40 flex flex-col gap-1.5 text-[12px] tabular-nums">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-text-dim">Giá vốn</span>
                        <span className="text-text-secondary font-bold">
                            {formatVND(cost)}<span className="text-text-dim font-medium">/{displayUnit}</span>
                        </span>
                    </div>
                </div>
            )}

        </div>
    )
}

function Row({ label, value, sign = '', accent, bold }) {
    const valueClass = `${accent || 'text-text-secondary'} ${bold ? 'font-black' : 'font-bold'}`
    return (
        <div className="flex justify-between gap-2 items-baseline">
            <span className="text-text-dim">{label}</span>
            <span className={valueClass}>{sign && `${sign} `}{value}</span>
        </div>
    )
}
