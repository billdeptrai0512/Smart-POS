import { useState } from 'react'
import { AlertTriangle, X, Loader, Check } from 'lucide-react'
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients'
import { adjustIngredientStock } from '../../services/orderService'

/**
 * Surface raw-balance deficits (Σ refill < Σ restock) caused by:
 *   1) Staff buying ingredients outside the /ingredients flow
 *   2) Over-reporting restock during /shift-closing
 *
 * The `max(0, ...)` clamp in fetchIngredientStocks hides these; this banner exposes
 * them and offers a "Kiểm kê & reset" workflow that writes adjustment expenses to
 * zero out the deficit, so future NHẬP KHO behaves normally.
 *
 * Props:
 *   deficits:           Array<{ ingredient, refill, restock, deficit }>  // deficit < 0
 *   ingredientUnits:    { [ingredient]: 'g' | 'ml' | ... }   // for getIngredientUnit fallback
 *   configByIngredient: Map<ingredient, { pack_size, pack_unit }>  // optional pack info
 *   addressId:          string | null
 *   staffName:          string
 *   onResolved:         () => void  // called after successful reset → refresh page
 */
export default function StockDeficitBanner({ deficits, ingredientUnits, configByIngredient, addressId, staffName, onResolved }) {
    const [modalOpen, setModalOpen] = useState(false)
    if (!deficits?.length) return null

    const resolveUnit = (ing) => getIngredientUnit(ing, ingredientUnits?.[ing], ingredientUnits)

    return (
        <>
            <div className="bg-danger/5 border border-danger/30 rounded-[16px] p-3 mb-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-black text-danger leading-tight">Kho tổng đang lệch sổ sách</p>
                        <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">
                            {deficits.length} nguyên liệu bị rút (chốt ca) nhiều hơn số đã nhập kho.
                            Có thể do mua ngoài app hoặc kê khai nhập kho quá tay.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-1 mt-1 pl-[22px]">
                    {deficits.map(d => (
                        <div key={d.ingredient} className="flex items-baseline justify-between text-[12px] tabular-nums">
                            <span className="font-bold text-text">{ingredientLabel(d.ingredient)}</span>
                            <span className="text-danger font-black">{d.deficit.toLocaleString('vi-VN')}{resolveUnit(d.ingredient)}</span>
                        </div>
                    ))}
                </div>

                <button
                    onClick={() => setModalOpen(true)}
                    className="mt-1 w-full py-2 rounded-[10px] bg-danger/10 border border-danger/30 text-danger text-[12px] font-black uppercase tracking-wider hover:bg-danger/20 active:scale-[0.98] transition-all"
                >
                    Kiểm kê & reset
                </button>
            </div>

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
    // Per-row inputs. For pack-configured ingredients (1 hộp = 1284ml), let the manager
    // count "2 hộp + 432ml" instead of typing 2568. Each row stores { packs, remainder } —
    // actualBase = packs*pack_size + remainder. Falls back to a single "amount" input
    // when no pack info exists.
    const [rows, setRows] = useState(() => {
        const init = {}
        for (const d of deficits) {
            const cfg = configByIngredient?.get?.(d.ingredient)
            init[d.ingredient] = cfg?.pack_size && cfg?.pack_unit
                ? { mode: 'pack', packs: '0', remainder: '0', packSize: Number(cfg.pack_size), packUnit: cfg.pack_unit }
                : { mode: 'single', amount: '0' }
        }
        return init
    })
    const [submitting, setSubmitting] = useState(false)
    const [done, setDone] = useState(false)
    const [error, setError] = useState('')

    const resolveUnit = (ing) => getIngredientUnit(ing, ingredientUnits?.[ing], ingredientUnits)
    const actualFor = (ing) => {
        const r = rows[ing]
        if (!r) return 0
        if (r.mode === 'pack') {
            const p = Number(r.packs || 0)
            const rem = Number(r.remainder || 0)
            return (Number.isFinite(p) ? p : 0) * r.packSize + (Number.isFinite(rem) ? rem : 0)
        }
        const n = Number(r.amount || 0)
        return Number.isFinite(n) ? n : 0
    }

    const handleSubmit = async () => {
        if (submitting) return
        // Pre-validate: surface any negative inputs first.
        for (const d of deficits) {
            const actual = actualFor(d.ingredient)
            if (actual < 0) { setError(`Số đếm "${ingredientLabel(d.ingredient)}" không thể âm.`); return }
        }
        setSubmitting(true); setError('')
        try {
            for (const d of deficits) {
                const actual = actualFor(d.ingredient)
                // delta = actual - raw_balance. raw_balance = d.deficit (negative).
                // Skipping near-zero deltas avoids no-op writes.
                const delta = actual - d.deficit
                if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) continue
                // Pass the RAW (unclamped) warehouse as beforeStock so the audit
                // entry shows "Tồn -5 → 50" — the honest "sheet was broken at -5,
                // physical count is 50" story. The displayed warehouse on /ingredients
                // is max(0, raw), but for the kiểm kê log the raw value is what
                // the manager needs to see.
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
        <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                onClick={e => e.stopPropagation()}
                className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up max-h-[88dvh] overflow-hidden"
            >
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Kiểm kê & reset</span>
                        <p className="text-[18px] font-black text-text leading-tight">Cân lại sổ sách kho tổng</p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all disabled:opacity-50"
                    >
                        <X size={18} />
                    </button>
                </div>

                <p className="text-[12px] text-text-secondary leading-snug shrink-0">
                    Đếm thực tế kho tổng <span className="font-bold text-text">hiện tại</span> của từng nguyên liệu. Hệ thống sẽ ghi 1 adjustment để cân deficit về 0.
                </p>

                {done ? (
                    <div className="flex flex-col items-center gap-2 py-6">
                        <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center">
                            <Check size={24} className="text-success" strokeWidth={3} />
                        </div>
                        <p className="text-[14px] font-black text-success">Đã reset {deficits.length} nguyên liệu</p>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 overflow-y-auto -mx-1 px-1 flex flex-col gap-2">
                            {deficits.map(d => {
                                const baseUnit = resolveUnit(d.ingredient)
                                const row = rows[d.ingredient]
                                const total = actualFor(d.ingredient)
                                return (
                                    <div key={d.ingredient} className="bg-surface-light rounded-[12px] p-3 border border-border/40">
                                        <div className="flex items-baseline justify-between mb-2">
                                            <span className="text-[13px] font-bold text-text">{ingredientLabel(d.ingredient)}</span>
                                            <span className="text-[10px] font-bold text-danger tabular-nums">
                                                deficit {d.deficit.toLocaleString('vi-VN')}{baseUnit}
                                            </span>
                                        </div>

                                        {row.mode === 'pack' ? (
                                            <>
                                                <div className="flex items-center gap-2">
                                                    <PackInputBox
                                                        label={row.packUnit}
                                                        value={row.packs}
                                                        onChange={v => setRows(prev => ({ ...prev, [d.ingredient]: { ...prev[d.ingredient], packs: v } }))}
                                                        disabled={submitting}
                                                    />
                                                    <span className="text-text-secondary text-[14px] font-bold">+</span>
                                                    <PackInputBox
                                                        label={baseUnit}
                                                        value={row.remainder}
                                                        onChange={v => setRows(prev => ({ ...prev, [d.ingredient]: { ...prev[d.ingredient], remainder: v } }))}
                                                        disabled={submitting}
                                                    />
                                                </div>
                                                <p className="text-[10px] text-text-dim tabular-nums mt-1.5">
                                                    1 {row.packUnit} = {row.packSize.toLocaleString('vi-VN')}{baseUnit} · Tổng <span className="font-bold text-text-secondary">{total.toLocaleString('vi-VN')}{baseUnit}</span>
                                                </p>
                                            </>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <label className="text-[11px] font-black text-text-secondary uppercase tracking-wider shrink-0">Đếm thực tế</label>
                                                <div className="flex-1 flex items-center bg-bg border border-border/60 rounded-[10px] overflow-hidden">
                                                    <input
                                                        type="number"
                                                        inputMode="numeric"
                                                        value={row.amount}
                                                        onChange={e => setRows(prev => ({ ...prev, [d.ingredient]: { ...prev[d.ingredient], amount: e.target.value } }))}
                                                        disabled={submitting}
                                                        className="flex-1 min-w-0 bg-transparent px-3 py-2 text-[14px] font-bold text-right text-text focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                                                    />
                                                    <span className="pr-3 text-[11px] font-bold text-text-dim">{baseUnit}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        {error && <p className="text-[12px] text-danger font-bold">{error}</p>}

                        <button
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="w-full py-3 rounded-[12px] bg-primary text-white text-[14px] font-black uppercase tracking-wide hover:bg-primary/90 active:scale-[0.98] transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
                        >
                            {submitting ? <><Loader size={14} className="animate-spin" /> Đang ghi…</> : 'Xác nhận kiểm kê'}
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}

function PackInputBox({ label, value, onChange, disabled }) {
    return (
        <div className="flex-1 flex items-center bg-bg border border-border/60 rounded-[10px] overflow-hidden">
            <input
                type="number"
                inputMode="numeric"
                value={value}
                onChange={e => onChange(e.target.value)}
                disabled={disabled}
                className="flex-1 min-w-0 bg-transparent px-3 py-2 text-[14px] font-bold text-right text-text focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
            />
            <span className="pr-3 text-[11px] font-bold text-text-dim">{label}</span>
        </div>
    )
}
