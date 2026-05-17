import { useState, useMemo } from 'react'
import { X, Check, Loader, AlertTriangle, ChevronRight, Plus } from 'lucide-react'
import { ingredientLabel } from '../common/recipeUtils'
import { syncIngredientKey, upsertIngredientCost } from '../../services/orderService'
import { suggestCanonical } from '../../utils/ingredientKeySync'

// Tiny heuristic: guess a sensible default unit from the orphan key so users
// rarely have to retype it. Falls back to 'đv' for anything unrecognized.
function guessUnit(key) {
    const k = String(key || '').toLowerCase()
    if (/(cup|ly|lid|nắp|nap|ống|ong|que|stick|straw|bag|túi|tui|cái|cai)/.test(k)) return 'cái'
    if (/(sữa|sua|milk|syrup|sốt|sot|sauce|nước|nuoc|water|juice|ml)/.test(k)) return 'ml'
    if (/(bột|bot|đường|duong|sugar|muối|muoi|salt|kem|cream|powder|topping|cacao|matcha|trà|tra|cà phê|cafe|coffee|g)/.test(k)) return 'g'
    return 'đv'
}

/**
 * Modal cho user xem & đồng bộ ingredient keys bị mismatch.
 *
 * Workflow:
 *   1. List collisions (same label, different keys). User chọn canonical key cho mỗi nhóm.
 *   2. Click "Đồng bộ tất cả" → gọi syncIngredientKey() cho từng non-canonical key.
 *   3. Show kết quả tổng hợp (X công thức, Y chốt ca, Z chi phí cập nhật).
 *
 * Orphan keys (in recipes/inventory but not in ingredient_costs) chỉ hiển thị thông tin,
 * không có action — user phải sửa qua recipe editor hoặc tạo lại ingredient.
 */
export default function KeySyncModal({
    open,
    onClose,
    mismatches,            // { orphanRecipeKeys, orphanInventoryKeys, orphanExtraIngredientKeys, labelCollisions }
    recipes = [],
    products = [],
    productExtras = {},    // { [productId]: [{ id, name }] } — used to attribute orphan extra-ingredients
    extraIngredients = {}, // { [extraId]: [{ ingredient, ... }] }
    ingredientCosts = {},
    addressId,
    onComplete,            // called after successful sync to refresh data
}) {
    // user's chosen canonical key per collision label
    const [picks, setPicks] = useState(() => {
        const initial = {}
        for (const c of mismatches?.labelCollisions || []) {
            initial[c.label] = suggestCanonical(c, ingredientCosts)
        }
        return initial
    })
    const [syncing, setSyncing] = useState(false)
    const [error, setError]   = useState('')
    const [done, setDone]     = useState(false)
    const [summary, setSummary] = useState(null)

    // Unit input per orphan key. Initialized from a key-name heuristic so the
    // common case ("cup" → "cái", "syrup" → "ml") is one click instead of typing.
    const allOrphanKeys = useMemo(() => {
        const set = new Set()
        ;(mismatches?.orphanRecipeKeys || []).forEach(k => set.add(k))
        ;(mismatches?.orphanExtraIngredientKeys || []).forEach(k => set.add(k))
        ;(mismatches?.orphanInventoryKeys || []).forEach(k => set.add(k))
        return Array.from(set)
    }, [mismatches])
    const [orphanUnits, setOrphanUnits] = useState(() => {
        const init = {}
        for (const k of allOrphanKeys) init[k] = guessUnit(k)
        return init
    })
    const [creatingOrphans, setCreatingOrphans] = useState(false)
    const [orphansCreated, setOrphansCreated] = useState(0)

    // Count usage per key — helps user pick canonical
    const recipeCountByKey = useMemo(() => {
        const map = {}
        for (const r of recipes) {
            if (!r.ingredient) continue
            map[r.ingredient] = (map[r.ingredient] || 0) + 1
        }
        return map
    }, [recipes])

    // Map ingredient_key → [product names that reference it via recipes]
    // Used to give context for orphan keys ("cup được dùng trong: Cà phê, Trà đá")
    const productsByIngredient = useMemo(() => {
        const productMap = new Map(products.map(p => [p.id, p.name]))
        const result = {}
        for (const r of recipes) {
            if (!r.ingredient) continue
            const name = productMap.get(r.product_id)
            if (!name) continue
            if (!result[r.ingredient]) result[r.ingredient] = new Set()
            result[r.ingredient].add(name)
        }
        // Convert sets to sorted arrays
        for (const k of Object.keys(result)) result[k] = [...result[k]].sort()
        return result
    }, [recipes, products])

    const costKeys = useMemo(() => new Set(Object.keys(ingredientCosts || {})), [ingredientCosts])

    // Map ingredient_key → [{ extraName, productName }] for orphan-extra-ingredient context.
    // Helps user trace "topping_dau is referenced in extra 'Trân châu' of product 'Trà sữa'".
    const extrasByIngredient = useMemo(() => {
        // First: build extraId → { extraName, productName }
        const productByExtraId = new Map()
        for (const [productId, exList] of Object.entries(productExtras || {})) {
            const prodName = products.find(p => p.id === productId)?.name
            if (!prodName) continue
            for (const ex of exList || []) {
                productByExtraId.set(ex.id, { extraName: ex.name, productName: prodName })
            }
        }
        // Then: for each extra-ingredient row, accumulate by ingredient key
        const result = {}
        for (const [extraId, list] of Object.entries(extraIngredients || {})) {
            const meta = productByExtraId.get(extraId)
            if (!meta) continue
            for (const ei of list || []) {
                if (!ei?.ingredient) continue
                if (!result[ei.ingredient]) result[ei.ingredient] = []
                result[ei.ingredient].push(meta)
            }
        }
        return result
    }, [productExtras, extraIngredients, products])

    if (!open) return null

    const collisions = mismatches?.labelCollisions || []
    const orphanRecipe = mismatches?.orphanRecipeKeys || []
    const orphanInv   = mismatches?.orphanInventoryKeys || []
    const orphanExtra = mismatches?.orphanExtraIngredientKeys || []

    const handleSync = async () => {
        if (!addressId) { setError('Chưa chọn chi nhánh'); return }
        setSyncing(true); setError('')
        const agg = { recipes_updated: 0, closings_updated: 0, expenses_updated: 0, groups_synced: 0 }
        try {
            for (const c of collisions) {
                const canonical = picks[c.label]
                if (!canonical) continue
                const others = c.keys.filter(k => k !== canonical)
                for (const oldKey of others) {
                    const res = await syncIngredientKey(addressId, oldKey, canonical)
                    agg.recipes_updated  += res?.recipes_updated  || 0
                    agg.closings_updated += res?.closings_updated || 0
                    agg.expenses_updated += res?.expenses_updated || 0
                }
                agg.groups_synced += 1
            }
            setSummary(agg)
            setDone(true)
        } catch (err) {
            setError(err?.message || 'Đồng bộ thất bại')
        } finally {
            setSyncing(false)
        }
    }

    const handleClose = () => {
        if (syncing || creatingOrphans) return
        if (done || orphansCreated > 0) onComplete?.()
        onClose()
    }

    const handleCreateOrphans = async () => {
        if (creatingOrphans || allOrphanKeys.length === 0) return
        setCreatingOrphans(true); setError('')
        let created = 0
        try {
            for (const k of allOrphanKeys) {
                const unit = (orphanUnits[k] || 'đv').trim() || 'đv'
                await upsertIngredientCost(k, 0, addressId ?? null, unit)
                created++
            }
            setOrphansCreated(created)
            // If no collisions either, close-button below will read 'Xong' and run onComplete on click.
            // If collisions remain, the user can keep working in the same modal.
            onComplete?.()
        } catch (err) {
            setError(err?.message || 'Tạo nguyên liệu thất bại')
        } finally {
            setCreatingOrphans(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

            <div className="relative w-full max-w-lg mx-4 my-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[10px] bg-warning/10 flex items-center justify-center">
                            <AlertTriangle size={15} className="text-warning" />
                        </div>
                        <div>
                            <p className="text-text font-black text-sm leading-none">Đồng bộ nguyên liệu</p>
                            <p className="text-text-secondary text-xs mt-0.5">Gộp các key trùng nghĩa</p>
                        </div>
                    </div>
                    {!syncing && (
                        <button onClick={handleClose} className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light">
                            <X size={16} />
                        </button>
                    )}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {done ? (
                        <div className="flex flex-col items-center gap-3 py-6">
                            <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
                                <Check size={28} className="text-success" />
                            </div>
                            <p className="text-text font-black text-base">Đồng bộ thành công!</p>
                            <div className="text-text-secondary text-xs text-center space-y-1">
                                <p>{summary?.groups_synced || 0} nhóm nguyên liệu</p>
                                <p>{summary?.recipes_updated || 0} công thức · {summary?.closings_updated || 0} chốt ca · {summary?.expenses_updated || 0} chi phí</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Collisions */}
                            {collisions.length > 0 && (
                                <div className="space-y-3">
                                    <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">
                                        {collisions.length} nguyên liệu trùng nghĩa
                                    </p>
                                    {collisions.map(c => {
                                        const canonical = picks[c.label]
                                        return (
                                            <div key={c.label} className="bg-bg border border-border/60 rounded-[14px] p-3 space-y-2">
                                                <p className="text-text font-black text-sm">{c.label}</p>
                                                <p className="text-text-secondary text-[11px]">Chọn key chính (key còn lại sẽ được rename về key này):</p>
                                                <div className="space-y-1.5">
                                                    {c.keys.map(k => {
                                                        const isInCosts = costKeys.has(k)
                                                        const recipeCount = recipeCountByKey[k] || 0
                                                        const selected = canonical === k
                                                        return (
                                                            <label
                                                                key={k}
                                                                className={`flex items-center gap-2 p-2 rounded-[10px] border cursor-pointer transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border/40 hover:bg-surface-light'}`}
                                                            >
                                                                <input
                                                                    type="radio"
                                                                    name={`pick-${c.label}`}
                                                                    checked={selected}
                                                                    onChange={() => setPicks(p => ({ ...p, [c.label]: k }))}
                                                                    disabled={syncing}
                                                                    className="accent-primary"
                                                                />
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-text text-[12px] font-bold font-mono truncate">{k}</p>
                                                                    <p className="text-text-dim text-[10px]">
                                                                        {isInCosts ? '✓ trong danh sách' : '⚠ chưa có trong danh sách'}
                                                                        {' · '}
                                                                        {recipeCount} công thức
                                                                    </p>
                                                                </div>
                                                            </label>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Orphan info — with auto-create */}
                            {(orphanRecipe.length > 0 || orphanInv.length > 0 || orphanExtra.length > 0) && (
                                <div className="bg-bg border border-border/40 rounded-[14px] p-3 space-y-3">
                                    <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Nguyên liệu chưa khai báo</p>
                                    <p className="text-[11px] text-text-secondary">
                                        {allOrphanKeys.length} key đang được tham chiếu nhưng chưa có trong /ingredients (giá vốn = 0). Chỉnh đơn vị rồi bấm "Tạo nguyên liệu thiếu" — giá vốn sẽ về 0 và bạn có thể cập nhật sau trong /ingredients.
                                    </p>

                                    {orphansCreated > 0 && (
                                        <div className="bg-success/10 border border-success/30 rounded-[10px] px-3 py-2 flex items-center gap-2">
                                            <Check size={13} className="text-success" />
                                            <p className="text-[11px] font-bold text-success">Đã tạo {orphansCreated} nguyên liệu</p>
                                        </div>
                                    )}

                                    {orphansCreated === 0 && (
                                        <div className="space-y-1.5">
                                            {allOrphanKeys.map(k => {
                                                const usedIn = productsByIngredient[k] || []
                                                const extraUsages = extrasByIngredient[k] || []
                                                const inInventoryOnly = !orphanRecipe.includes(k) && !orphanExtra.includes(k) && orphanInv.includes(k)
                                                return (
                                                    <div key={k} className="bg-surface-light rounded-[8px] px-2.5 py-2 space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="text-[11px] font-mono font-bold text-text flex-1 min-w-0 truncate">{k}</p>
                                                            <input
                                                                type="text"
                                                                value={orphanUnits[k] || ''}
                                                                onChange={e => setOrphanUnits(prev => ({ ...prev, [k]: e.target.value }))}
                                                                disabled={creatingOrphans}
                                                                placeholder="đv"
                                                                className="w-[64px] bg-bg border border-border/60 rounded-md px-2 py-1 text-[11px] font-bold text-primary text-center focus:outline-none focus:border-primary disabled:opacity-50"
                                                                title="Đơn vị (vd: g, ml, cái, đv)"
                                                            />
                                                        </div>
                                                        {usedIn.length > 0 && (
                                                            <p className="text-[10px] text-text-secondary">
                                                                Công thức: <span className="text-text-dim">{usedIn.join(', ')}</span>
                                                            </p>
                                                        )}
                                                        {extraUsages.length > 0 && (
                                                            <p className="text-[10px] text-warning/80">
                                                                Tùy chọn:{' '}
                                                                <span className="text-text-dim">
                                                                    {extraUsages.map((u, i) => (
                                                                        <span key={i}>
                                                                            {i > 0 && ', '}
                                                                            {u.extraName} <span className="opacity-60">({u.productName})</span>
                                                                        </span>
                                                                    ))}
                                                                </span>
                                                            </p>
                                                        )}
                                                        {inInventoryOnly && (
                                                            <p className="text-[10px] text-text-dim italic">Có trong tồn kho gần nhất</p>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                            <button
                                                onClick={handleCreateOrphans}
                                                disabled={creatingOrphans}
                                                className="w-full mt-2 py-2.5 rounded-[10px] bg-primary/10 border border-primary/30 text-primary text-[12px] font-black hover:bg-primary/15 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                            >
                                                {creatingOrphans ? (
                                                    <><Loader size={12} className="animate-spin" /> Đang tạo…</>
                                                ) : (
                                                    <><Plus size={12} strokeWidth={3} /> Tạo {allOrphanKeys.length} nguyên liệu thiếu</>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {collisions.length === 0 && orphanRecipe.length === 0 && orphanInv.length === 0 && orphanExtra.length === 0 && (
                                <div className="py-6 text-center">
                                    <p className="text-text font-bold">Không có mismatch nào</p>
                                    <p className="text-text-secondary text-xs mt-1">Tất cả nguyên liệu đã đồng bộ.</p>
                                </div>
                            )}

                            {error && (
                                <div className="text-danger text-xs font-medium px-1">{error}</div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-border/40 shrink-0">
                    {done || collisions.length === 0 ? (
                        <button
                            onClick={handleClose}
                            className="w-full py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors"
                        >
                            {done ? 'Xong' : 'Đóng'}
                        </button>
                    ) : (
                        <div className="flex gap-2">
                            <button
                                onClick={handleClose}
                                disabled={syncing}
                                className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleSync}
                                disabled={syncing}
                                className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {syncing ? (
                                    <><Loader size={14} className="animate-spin" /> Đang đồng bộ…</>
                                ) : (
                                    <>Đồng bộ <ChevronRight size={14} /></>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
