import { useRef } from 'react'
import { formatVND } from '../../utils'
import { formatPackedQty } from '../../utils/inventory'
import { Plus } from 'lucide-react'

/**
 * Compact 2-line ingredient card:
 *   ┌──────────────────────────┐
 *   │ Cà phê             [+]   │  ← name + restock button
 *   │ 9180 g                   │  ← hero number (large, color-coded for low stock)
 *   │ 248đ/g · 1 bịch=1000g    │  ← meta line (manager only): unit cost + pack config
 *   └──────────────────────────┘
 *
 * Click handlers (all stopPropagation to prevent card-level navigate):
 *   - name → rename
 *   - hero number → edit stock
 *   - unit suffix → edit unit
 *   - meta pack span → open PackConfigModal
 *   - [+] → onRestock
 *   - card body (outside above) → navigate to /ingredients/[key] detail
 */
export default function IngredientCostItem({
    ingredientLabel, getIngredientUnit, ingredient, cost,
    storedUnit, isEditingUnit, editingUnit, setEditingUnit, saveUnit,
    isEditingName, editingName, setEditingName, saveName,
    canEdit = true,
    minStock,
    // Pack config (quy cách đóng gói) — edit moved to detail page;
    // packSize/packUnit kept for the inline "= X bịch + Y g" display.
    packSize, packUnit,
    // Stock display
    stockData, onRestock,
    isEditingStock, editingStock, setEditingStock, saveStock,
    // Daily context (always inline)
    dailyContext,
    // Navigation — parent owns scroll-cache save before navigating to detail
    onOpen,
}) {
    const displayUnit = getIngredientUnit(ingredient, storedUnit)
    const nameCancelledRef = useRef(false)

    const currentStock = stockData?.current_stock ?? null
    const isLowStock = currentStock !== null && currentStock <= (minStock || 0)

    const stop = (e) => e.stopPropagation()

    return (
        <div
            className={`bg-surface border rounded-[14px] p-3 flex flex-col gap-2 min-w-0 cursor-pointer hover:bg-surface-light/40 transition-colors ${isLowStock ? 'border-danger/40' : 'border-border/60'}`}
            onClick={() => onOpen?.(ingredient)}
        >
            {/* Row 1: name + restock button */}
            <div className="flex items-start gap-1.5 min-w-0">
                {isEditingName ? (
                    <input
                        type="text"
                        autoFocus
                        onClick={stop}
                        className="flex-1 min-w-0 bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[13.5px] font-black text-text focus:outline-none focus:border-primary"
                        value={editingName.value}
                        onChange={e => setEditingName(prev => ({ ...prev, value: e.target.value }))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') { nameCancelledRef.current = false; saveName(ingredient, editingName.value) }
                            if (e.key === 'Escape') { nameCancelledRef.current = true; setEditingName(null) }
                        }}
                        onBlur={() => {
                            if (nameCancelledRef.current) { nameCancelledRef.current = false; return }
                            saveName(ingredient, editingName.value)
                        }}
                    />
                ) : (
                    <span
                        className={`flex-1 min-w-0 text-[13.5px] font-black text-primary leading-tight line-clamp-2 break-words ${canEdit ? 'underline decoration-primary/20 underline-offset-[3px] hover:decoration-primary' : ''}`}
                        onClick={(e) => {
                            if (!canEdit) return
                            e.stopPropagation()
                            setEditingName({ ingredient, value: ingredientLabel(ingredient) })
                        }}
                    >
                        {ingredientLabel(ingredient)}
                    </span>
                )}
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

            {/* Row 2: hero — tồn kho number + unit */}
            <div className="flex items-baseline gap-1 min-w-0 -mt-0.5">
                {isEditingStock ? (
                    <input
                        type="number"
                        autoFocus
                        onClick={stop}
                        className="w-[70px] bg-primary/10 border border-primary/30 rounded-md px-1.5 py-0.5 text-[17px] font-black text-primary focus:outline-none focus:border-primary focus:bg-primary/15 transition-all shadow-inner tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={editingStock.value}
                        onChange={e => setEditingStock(prev => ({ ...prev, value: e.target.value }))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') saveStock(ingredient, editingStock.value, editingStock.original)
                            if (e.key === 'Escape') setEditingStock(null)
                        }}
                        onBlur={() => saveStock(ingredient, editingStock.value, editingStock.original)}
                    />
                ) : (
                    <span
                        className={`text-[17px] font-black tabular-nums leading-none ${isLowStock ? 'text-danger' : 'text-text'} ${saveStock ? 'cursor-pointer' : ''}`}
                        onClick={(e) => {
                            if (!saveStock) return
                            e.stopPropagation()
                            const v = currentStock !== null ? Math.round(currentStock * 10) / 10 : 0
                            setEditingStock({ ingredient, value: String(v), original: v })
                        }}
                        title={saveStock ? 'Hiệu chỉnh tồn' : undefined}
                    >
                        {currentStock !== null ? Math.round(currentStock * 10) / 10 : '—'}
                    </span>
                )}
                {isEditingUnit ? (
                    <input
                        type="text"
                        autoFocus
                        onClick={stop}
                        className="w-[40px] bg-primary/10 border border-primary/30 rounded-md px-1 py-0.5 text-[13px] font-bold text-primary focus:outline-none focus:border-primary focus:bg-primary/15 transition-all"
                        value={editingUnit.value}
                        onChange={e => setEditingUnit(prev => ({ ...prev, value: e.target.value }))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') saveUnit(ingredient, editingUnit.value.trim() || 'đv', cost)
                            if (e.key === 'Escape') setEditingUnit(null)
                        }}
                        onBlur={() => saveUnit(ingredient, editingUnit.value.trim() || 'đv', cost)}
                    />
                ) : (
                    <span
                        className={`text-[13px] font-bold text-text-secondary leading-none ${canEdit ? 'cursor-pointer hover:text-primary' : ''}`}
                        onClick={(e) => {
                            if (!canEdit) return
                            e.stopPropagation()
                            setEditingUnit({ ingredient, value: displayUnit })
                        }}
                        title={canEdit ? 'Sửa đơn vị' : undefined}
                    >
                        {displayUnit}
                    </span>
                )}
                {isLowStock && (
                    <span className="ml-auto text-[10px] font-black text-danger uppercase tracking-wide">Sắp hết</span>
                )}
            </div>

            {/* Row 2b: pack breakdown — only when pack info exists AND remainder ≠ raw qty */}
            {currentStock !== null && packSize && packUnit && currentStock >= packSize && (
                <span className="text-[11px] font-medium text-text-dim leading-none -mt-1 tabular-nums">
                    = {formatPackedQty(currentStock, packSize, packUnit, displayUnit, { compact: true })}
                </span>
            )}

            <div className="mt-1 pt-2 border-t border-border/40 flex-1 flex flex-col gap-1 text-[11px] tabular-nums">
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
                <div className="mt-1 pt-2 border-t border-border/40 flex flex-col gap-1 text-[11px] tabular-nums">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-text-dim">Giá vốn</span>
                        <span className="text-text-secondary font-bold">
                            {formatVND(cost)}<span className="text-text-dim font-medium">/{displayUnit}</span>
                        </span>
                    </div>
                </div>
            )}

            <button
                onClick={() => onOpen?.(ingredient)}
                className="text-[10px] font-bold text-primary text-right mt-auto pt-1 hover:underline"
            >
                Xem chi tiết
            </button>




        </div>
    )
}

function Row({ label, value, sign = '', accent, bold }) {
    const parts = typeof value === 'string' ? value.split(' + ') : [value]
    const multi = parts.length > 1
    const valueClass = `${accent || 'text-text-secondary'} ${bold ? 'font-black' : 'font-bold'}`
    return (
        <div className={`flex justify-between gap-2 ${multi ? 'items-start' : 'items-baseline'}`}>
            <span className="text-text-dim">{label}</span>
            {multi ? (
                <span className="flex flex-col items-end gap-1 leading-none">
                    <span className={valueClass}>{sign && `${sign} `}{parts[0]}</span>
                    <span className="text-[10px] text-text-dim font-medium">+ {parts[1]}</span>
                </span>
            ) : (
                <span className={valueClass}>{sign && `${sign} `}{value}</span>
            )}
        </div>
    )
}
