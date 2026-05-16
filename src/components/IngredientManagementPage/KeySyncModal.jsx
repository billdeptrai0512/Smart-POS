import { useState, useMemo } from 'react'
import { X, Check, Loader, AlertTriangle, ChevronRight } from 'lucide-react'
import { ingredientLabel } from '../common/recipeUtils'
import { syncIngredientKey } from '../../services/orderService'
import { suggestCanonical } from '../../utils/ingredientKeySync'

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
        if (syncing) return
        if (done) onComplete?.()
        onClose()
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

                            {/* Orphan info */}
                            {(orphanRecipe.length > 0 || orphanInv.length > 0 || orphanExtra.length > 0) && (
                                <div className="bg-bg border border-border/40 rounded-[14px] p-3 space-y-3">
                                    <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Cảnh báo khác</p>
                                    {orphanRecipe.length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-[11px] font-bold text-text-secondary">
                                                {orphanRecipe.length} nguyên liệu được dùng trong công thức nhưng chưa khai báo trong /ingredients (giá vốn sẽ bằng 0):
                                            </p>
                                            <div className="space-y-1.5">
                                                {orphanRecipe.map(k => {
                                                    const usedIn = productsByIngredient[k] || []
                                                    return (
                                                        <div key={k} className="bg-surface-light rounded-[8px] px-2.5 py-1.5">
                                                            <p className="text-[11px] font-mono font-bold text-text">{k}</p>
                                                            {usedIn.length > 0 ? (
                                                                <p className="text-[10px] text-text-secondary mt-0.5">
                                                                    Dùng trong: <span className="text-text-dim">{usedIn.join(', ')}</span>
                                                                </p>
                                                            ) : (
                                                                <p className="text-[10px] text-text-dim italic mt-0.5">Không tìm thấy sản phẩm tham chiếu</p>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {orphanExtra.length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-[11px] font-bold text-warning">
                                                {orphanExtra.length} nguyên liệu được gán vào tùy chọn (extra) nhưng chưa khai báo — báo cáo hao hụt sẽ bị thiếu, dự báo bổ sung sẽ sai:
                                            </p>
                                            <div className="space-y-1.5">
                                                {orphanExtra.map(k => {
                                                    const usages = extrasByIngredient[k] || []
                                                    return (
                                                        <div key={k} className="bg-surface-light rounded-[8px] px-2.5 py-1.5">
                                                            <p className="text-[11px] font-mono font-bold text-text">{k}</p>
                                                            {usages.length > 0 ? (
                                                                <p className="text-[10px] text-text-secondary mt-0.5">
                                                                    Trong tùy chọn:{' '}
                                                                    <span className="text-text-dim">
                                                                        {usages.map((u, i) => (
                                                                            <span key={i}>
                                                                                {i > 0 && ', '}
                                                                                {u.extraName} <span className="opacity-60">({u.productName})</span>
                                                                            </span>
                                                                        ))}
                                                                    </span>
                                                                </p>
                                                            ) : (
                                                                <p className="text-[10px] text-text-dim italic mt-0.5">Không tìm thấy tùy chọn tham chiếu</p>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {orphanInv.length > 0 && (
                                        <div className="space-y-1">
                                            <p className="text-[11px] font-bold text-text-secondary">
                                                {orphanInv.length} nguyên liệu trong tồn kho nhưng chưa khai báo:
                                            </p>
                                            <p className="text-[10px] font-mono text-text-dim">{orphanInv.join(', ')}</p>
                                        </div>
                                    )}
                                    <p className="text-[10px] text-text-dim italic">
                                        Cách sửa: vào /recipes đổi nguyên liệu trong công thức/tùy chọn sang key đã có sẵn, HOẶC vào /ingredients tạo nguyên liệu mới với đúng key này.
                                    </p>
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
