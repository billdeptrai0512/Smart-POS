import { formatPackedQty, netStockOf, isLowStockOf } from '../../utils/inventory'
import { onboardingHintClass } from '../../utils/onboardingHint'
import type { Pack2 } from '../../utils/inventory'
import type { Row } from '../../types/domain'

interface Props {
    ingredientLabel: (key: string) => string
    getIngredientUnit: (key: string, storedUnit?: string | null) => string
    ingredient: string
    storedUnit?: string | null
    canEdit?: boolean
    minStock?: number | null
    minCounterStock?: number | null
    packSize?: number | null
    packUnit?: string | null
    pack2?: Pack2 | null
    tareWeight?: number | null
    stockData?: Row | null
    dailyContext?: { today_refill?: number | null; today_restock?: number | null } | null
    siblingCounterStocks?: { addressId?: string | null; addressName: string; counterStock: number }[] | null
    onOpen?: (ingredient: string) => void
    hint?: boolean
}

/**
 * Compact ingredient card — read-only summary:
 *   ┌──────────────────────────┐
 *   │ Cà phê                   │  ← name (tap card to open detail)
 *   │ Kiểm kê lần cuối: 06/09  │  ← ngày kiểm kê quầy (manager only)
 *   │ Tồn đầu / Lấy ra / …     │  ← daily context
 *   │ Tồn quầy hiện có 8g      │  ← counter stock (manager only); 1 dòng/địa chỉ nếu kho dùng chung nhóm
 *   │ ──────────────────────── │
 *   │ Tổng cộng        9180 g  │  ← hero stock number (phải)
 *   │             = 9 bịch…    │  ← pack breakdown dưới số tổng (if pack configured)
 *   └──────────────────────────┘
 *
 * All edit affordances (name, stock, unit, pack, category, min-stock, cost,
 * nhập kho, xóa) live inside the /inventory/stocking/[key] detail page — card body
 * is a single click target that navigates there.
 */
export default function IngredientCostItem({
    ingredientLabel, getIngredientUnit, ingredient,
    storedUnit,
    canEdit = true,
    minStock, minCounterStock,
    // Pack config (quy cách đóng gói) — edit moved to detail page;
    // packSize/packUnit kept for the inline "= X bịch + Y g" display.
    packSize, packUnit, pack2,
    tareWeight,
    // Stock display
    stockData,
    // Daily context (always inline)
    dailyContext,
    // Tồn quầy theo từng địa chỉ trong nhóm kho dùng chung (null nếu kho không thuộc nhóm nào)
    siblingCounterStocks,
    // Navigation — parent owns scroll-cache save before navigating to detail
    onOpen,
    hint = false,
}: Props) {
    const displayUnit = getIngredientUnit(ingredient, storedUnit)

    const shownStock = netStockOf(stockData, tareWeight, displayUnit)
    const isOutStock = shownStock !== null && shownStock <= 0
    const isLowStock = stockData ? isLowStockOf(stockData, { tareWeight, minStock, minCounterStock }, displayUnit) : false

    const countedOn = stockData?.counter_counted_on?.split('-').slice(1).reverse().join('/')

    const warn = isOutStock || isLowStock
    const borderClass = warn ? 'border-danger/40' : 'border-border/60'
    const textClass = warn ? 'text-danger' : 'text-text'

    return (
        <div
            className={`bg-surface border rounded-[14px] p-3 flex flex-col gap-2 min-w-0 cursor-pointer hover:bg-surface-light/40 transition-colors ${borderClass} ${onboardingHintClass(hint)}`}
            onClick={() => onOpen?.(ingredient)}
        >
            {/* Row 1: name + status badge (chiếm chỗ nút [+] nhập kho cũ) */}
            <div className="flex items-start gap-1.5 min-w-0">
                <div className="flex-1 min-w-0">
                    <span className="block text-[14.5px] font-black text-primary leading-tight line-clamp-2 break-words">
                        {ingredientLabel(ingredient)}
                    </span>
                    {canEdit && countedOn && <span className="block mt-0.5 text-[11px] text-text-dim">Kiểm kê lần cuối: {countedOn}</span>}
                </div>
                {isOutStock && (
                    <span className="shrink-0 text-[10px] font-black text-danger uppercase tracking-wide bg-danger/10 px-1.5 py-0.5 rounded-md">Hết</span>
                )}
                {isLowStock && (
                    <span className="shrink-0 text-[10px] font-black text-danger uppercase tracking-wide bg-danger/10 px-1.5 py-0.5 rounded-md">Sắp hết</span>
                )}
            </div>

            <div className="mt-1.5 pt-2 border-t border-border/40 flex flex-col gap-1.5 text-[12px] tabular-nums">
                {(() => {
                    const todayRefill = Number(dailyContext?.today_refill || 0)
                    const todayRestock = Number(dailyContext?.today_restock || 0)
                    const warehouseNow = stockData?.warehouse_stock ?? 0
                    const warehouseStart = warehouseNow + todayRestock - todayRefill
                    const fmt = (n: number) => {
                        // Negative values: collapse to base unit only — pack-breakdown of negative
                        // numbers ("-4 hộp + -1.226 ml") reads awkwardly and isn't meaningful.
                        if (n < 0) {
                            const r = Math.round(n * 10) / 10
                            return `${r.toLocaleString('vi-VN')} ${displayUnit}`
                        }
                        return formatPackedQty(n, packSize, packUnit, displayUnit, { compact: true, pack2 })
                    }
                    return (
                        <>
                            {/* Ngày chưa có biến động → đầu = cuối, chỉ cần 1 dòng. */}
                            {(todayRestock > 0 || todayRefill > 0) && <Row label="Tồn kho đầu ngày" value={fmt(warehouseStart)} />}
                            {todayRestock > 0 && <Row label="Lấy ra" value={fmt(todayRestock)} sign="-" accent="text-warning" />}
                            {todayRefill > 0 && <Row label="Nhập mới" value={fmt(todayRefill)} sign="+" accent="text-success" />}
                            <Row label="Tồn kho cuối ngày" value={fmt(warehouseNow)} bold />
                        </>
                    )
                })()}

                {/* Tồn quầy (manager only) — divider riêng tách khỏi cụm tồn kho để mắt quét 2 nơi chứa hàng.
                     Nhóm + Quy đổi đã chuyển sang trang chi tiết của ingredient. */}
                {canEdit && (
                    <div className="pt-2 border-t border-border/40 flex flex-col gap-1.5">
                        {siblingCounterStocks ? (
                            siblingCounterStocks.map(s => (
                                <Row key={s.addressId ?? 'default'} label={`Tồn quầy · ${s.addressName}`} value={`${fmtRound(s.counterStock)} ${displayUnit}`} />
                            ))
                        ) : (
                            <Row label="Tồn quầy hiện có" value={`${fmtRound(stockData?.counter_stock)} ${displayUnit}`} />
                        )}
                    </div>
                )}
            </div>

            {/* Hero (đáy thẻ, dưới divider): tổng tồn kho number + unit + pack breakdown */}
            <div className="mt-auto pt-2 border-t border-border/40 flex justify-between items-center gap-2 min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wide text-text-dim leading-none">Tổng cộng</span>
                <div className="flex flex-col items-end gap-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                        <span className={`text-[16px] font-black tabular-nums leading-none ${textClass}`}>
                            {shownStock ?? '—'}
                        </span>
                        <span className="text-[12.5px] font-bold text-text-secondary leading-none">
                            {displayUnit}
                        </span>
                    </div>

                    {/* Pack breakdown dưới số tổng (nếu có quy cách & tồn ≥ 1 bịch) */}
                    {shownStock !== null && packSize && packUnit && shownStock >= packSize && (
                        <span className="text-[11.5px] font-semibold text-text-dim tabular-nums leading-none">
                            = {formatPackedQty(shownStock, packSize, packUnit, displayUnit, { compact: true, pack2 })}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}

function fmtRound(n?: number | null) {
    return Math.round((n || 0) * 10) / 10
}

function Row({ label, value, sign = '', accent, bold }: { label: string; value: string; sign?: string; accent?: string; bold?: boolean }) {
    const valueClass = `${accent || 'text-text-secondary'} ${bold ? 'font-black' : 'font-bold'}`
    return (
        <div className="flex justify-between gap-2 items-baseline">
            <span className="text-text-dim">{label}</span>
            <span className={valueClass}>{sign && `${sign} `}{value}</span>
        </div>
    )
}
