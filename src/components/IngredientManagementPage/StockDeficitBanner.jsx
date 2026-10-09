import { useState } from 'react'
import { AlertTriangle, ChevronRight, ClipboardCheck, Loader, Check } from 'lucide-react'
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients'
import { adjustIngredientStock } from '../../services/orderService'
import { pack2Of, r1, unitTiersOf } from '../../utils/inventory'
import { Dialog, MODAL_PANEL, ModalHeader } from '../common/ModalShell'

/**
 * Surface raw-balance deficits (Σ refill < Σ restock) caused by:
 *   1) Staff buying ingredients outside the /inventory flow
 *   2) Over-reporting restock during /shift-closing
 *
 * The `max(0, ...)` clamp in fetchIngredientStocks hides these; this banner exposes
 * them and offers a "Kiểm kê" workflow that writes adjustment expenses to
 * zero out the deficit, so future NHẬP KHO behaves normally.
 *
 * Props:
 *   deficits:           Array<{ ingredient, refill, restock, deficit }>  // deficit < 0
 *   ingredientUnits:    { [ingredient]: 'g' | 'ml' | ... }   // for getIngredientUnit fallback
 *   configByIngredient: Map<ingredient, ingredient_costs row>  // optional pack/pack2 info
 *   addressId:          string | null
 *   staffName:          string
 *   onResolved:         () => void  // called after successful reset → refresh page
 */
export default function StockDeficitBanner({ deficits, ingredientUnits, configByIngredient, addressId, staffName, onResolved }) {
    const [modalOpen, setModalOpen] = useState(false)
    if (!deficits?.length) return null

    const names = deficits.slice(0, 2).map(d => ingredientLabel(d.ingredient)).join(', ')
    const more = deficits.length - 2

    return (
        <>
            <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="w-full mb-3 p-3 flex items-center gap-3 text-left rounded-[16px] bg-danger/5 border border-danger/30 active:opacity-70 transition-opacity"
            >
                <AlertTriangle size={16} className="text-danger shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-black text-danger leading-tight">Kho tổng lệch sổ sách</p>
                    <p className="mt-0.5 text-[11px] text-text-secondary truncate">
                        {names}{more > 0 && ` +${more}`} · Bấm để kiểm kê
                    </p>
                </div>
                <ChevronRight size={16} className="text-danger/70 shrink-0" />
            </button>

            {modalOpen && (
                <KiemKeModal
                    deficits={deficits}
                    ingredientUnits={ingredientUnits}
                    configByIngredient={configByIngredient}
                    addressId={addressId}
                    staffName={staffName}
                    onClose={() => setModalOpen(false)}
                    onResolved={() => { setModalOpen(false); onResolved?.() }}
                />
            )}
        </>
    )
}

function KiemKeModal({ deficits, ingredientUnits, configByIngredient, addressId, staffName, onClose, onResolved }) {
    // counts[ingredient] = mảng chuỗi, mỗi phần tử ứng với 1 ô trong unitTiersOf. '' = chưa đếm:
    // nguyên liệu để trống KHÔNG bị ghi (khác bản cũ mặc định 0 → vô tình reset kho về 0).
    const [counts, setCounts] = useState({})
    const [submitting, setSubmitting] = useState(false)
    const [done, setDone] = useState(false)
    const [error, setError] = useState('')

    const rows = deficits.map(d => {
        const baseUnit = getIngredientUnit(d.ingredient, ingredientUnits?.[d.ingredient], ingredientUnits)
        const cfg = configByIngredient?.get?.(d.ingredient)
        const tiers = unitTiersOf(cfg?.pack_size, cfg?.pack_unit, pack2Of(cfg), baseUnit)
        const vals = counts[d.ingredient] || []
        return {
            d, baseUnit, tiers, vals,
            counted: vals.some(v => v !== undefined && v !== ''),
            actual: r1(tiers.reduce((sum, t, i) => sum + (Number(vals[i]) || 0) * t.mult, 0)),
        }
    })
    const counted = rows.filter(r => r.counted)

    const setVal = (ing, i, v) => setCounts(prev => {
        const next = [...(prev[ing] || [])]
        next[i] = v
        return { ...prev, [ing]: next }
    })

    const handleSubmit = async () => {
        if (submitting || !counted.length) return
        const bad = counted.find(r => r.vals.some(v => Number(v) < 0))
        if (bad) { setError(`Số đếm "${ingredientLabel(bad.d.ingredient)}" không thể âm.`); return }
        setSubmitting(true); setError('')
        try {
            for (const { d, actual } of counted) {
                // delta = actual - raw_balance. raw_balance = d.deficit (negative).
                // Skipping near-zero deltas avoids no-op writes.
                const delta = actual - d.deficit
                if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) continue
                // beforeStock = RAW (unclamped) warehouse so the audit entry shows
                // "Tồn -5 → 50" — the honest story for the kiểm kê log.
                await adjustIngredientStock(addressId ?? null, d.ingredient, delta, staffName || 'Kiểm kê', {
                    beforeStock: d.deficit,
                })
            }
            setDone(true)
            setTimeout(() => onResolved?.(), 800)
        } catch (err) {
            setError(err?.message || 'Lưu kiểm kê thất bại')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog onClose={!submitting ? onClose : undefined} panelClassName={MODAL_PANEL}>
            <ModalHeader
                icon={ClipboardCheck}
                title="Kiểm kê kho tổng"
                subtitle={`${deficits.length} nguyên liệu lệch sổ`}
                onClose={onClose}
                hideClose={submitting}
                className="shrink-0"
            />

            {done ? (
                <div className="flex flex-col items-center gap-2 py-10">
                    <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center">
                        <Check size={24} className="text-success" strokeWidth={3} />
                    </div>
                    <p className="text-[14px] font-black text-success">Đã cân lại {counted.length} nguyên liệu</p>
                </div>
            ) : (
                <>
                    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                        <p className="mb-3 text-[11px] font-medium text-text-dim/80">
                            Đếm hàng thực tế trong kho tổng. Sổ sách được cân lại theo số đếm; nguyên liệu để trống giữ nguyên.
                        </p>
                        <div className="flex flex-col divide-y divide-border/40">
                            {rows.map(({ d, baseUnit, tiers, vals, counted: has, actual }) => (
                                <div key={d.ingredient} className="py-3 first:pt-0 last:pb-0">
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="text-[13px] font-bold text-text">{ingredientLabel(d.ingredient)}</span>
                                        <span className="text-[11px] font-medium text-danger tabular-nums">
                                            Sổ sách {d.deficit.toLocaleString('vi-VN')} {baseUnit}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex gap-2">
                                        {tiers.map((t, i) => (
                                            <CountBox
                                                key={i}
                                                unit={t.label}
                                                value={vals[i] ?? ''}
                                                onChange={v => setVal(d.ingredient, i, v)}
                                                disabled={submitting}
                                            />
                                        ))}
                                    </div>
                                    {has && tiers.length > 1 && (
                                        <p className="mt-1.5 text-right text-[11px] font-medium text-text-dim tabular-nums">
                                            = {actual.toLocaleString('vi-VN')} {baseUnit}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                        {error && <p className="mt-3 text-[12px] text-danger font-bold">{error}</p>}
                    </div>

                    <div className="shrink-0 px-5 py-4 border-t border-border/40">
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !counted.length}
                            className="w-full py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {submitting
                                ? <><Loader size={14} className="animate-spin" /> Đang ghi…</>
                                : counted.length && counted.length < rows.length
                                    ? `Xác nhận ${counted.length}/${rows.length} nguyên liệu`
                                    : 'Xác nhận kiểm kê'}
                        </button>
                    </div>
                </>
            )}
        </Dialog>
    )
}

function CountBox({ unit, value, onChange, disabled }) {
    return (
        <div className="flex-1 min-w-0 flex items-center bg-bg border border-border/60 rounded-[10px] focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary">
            <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="0"
                value={value}
                onChange={e => onChange(e.target.value)}
                disabled={disabled}
                className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm font-bold tabular-nums text-right text-text placeholder:text-text-dim/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
            />
            <span className="pr-3 text-[11px] font-bold text-text-dim shrink-0 max-w-[48px] truncate">{unit}</span>
        </div>
    )
}
