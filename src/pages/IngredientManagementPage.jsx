import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, X, ArrowUpDown } from 'lucide-react'
import FabActionMenu from '../components/common/FabActionMenu'
import { BottomSheet } from '../components/common/ModalShell'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useHistory } from '../contexts/HistoryContext'
import { useOnboardingVisibility } from '../contexts/OnboardingVisibilityContext'
import {
    upsertIngredientCost, deleteIngredientCost, updateIngredientUnitCost,
    syncIngredientKey,
    fetchIngredientStocks, processIngredientRestock, fetchIngredientDeficits, fetchIngredientDailyContext,
} from '../services/orderService'
import { fetchCashClosedToday } from '../services/reportService'
import { sortIngredients, ingredientLabel, getIngredientUnit, normalizeIngredientCategory, normalizeIngredientKey } from '../utils/ingredients'
import IngredientCostItem from '../components/IngredientManagementPage/IngredientCostItem'
import RestockModal from '../components/IngredientManagementPage/RestockModal'
import KeySyncModal from '../components/IngredientManagementPage/KeySyncModal'
import StockDeficitBanner from '../components/IngredientManagementPage/StockDeficitBanner'
import KeyMismatchBanner from '../components/IngredientManagementPage/KeyMismatchBanner'
import IngredientsHeader from '../components/IngredientManagementPage/IngredientsHeader'
import CreateIngredientForm from '../components/IngredientManagementPage/CreateIngredientForm'
import { detectKeyMismatches } from '../utils/ingredientKeySync'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../contexts/ConfirmContext'
import Toast from '../components/POSPage/Toast'
import { keySyncDismissedKey, orphanIgnoredKey } from '../constants/storageKeys'
import { goToMenuStep } from '../utils/menuSequence'

// Chuẩn hoá để search không phân biệt hoa/thường & dấu tiếng Việt.
function normalizeText(s = '') {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
}

// Module-level scroll cache. Set when user opens a card to drill into
// /ingredients/:key; consumed once on next mount of /ingredients (back nav).
// Mirrors the /recipes pattern so back-from-detail lands at the same scroll
// position the user left.
let savedScroll = null

export default function IngredientManagementPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const {
        ingredientCosts: contextCosts, ingredientUnits: contextUnits,
        recipes: contextRecipes, products: contextProducts, ingredientConfigs,
        productExtras: contextProductExtras, extraIngredients: contextExtraIngs,
        refreshProducts,
    } = useProducts()
    const { selectedAddress, siblingsByAddress } = useAddress()
    const warehouseSiblings = selectedAddress ? siblingsByAddress[selectedAddress.id] : null
    const groupAddressIds = useMemo(
        () => selectedAddress ? [selectedAddress.id, ...(warehouseSiblings || []).map(a => a.id)] : [selectedAddress?.id ?? null],
        [selectedAddress, warehouseSiblings]
    )
    const { isManager, isAdmin, profile } = useAuth()
    const { refreshTodayExpenses } = useHistory()
    const { requestRefresh: requestOnboardingRefresh } = useOnboardingVisibility()
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()
    const canEdit = isManager || isAdmin

    const [ingredientCosts, setIngredientCosts] = useState(contextCosts || {})
    const [ingredientUnits, setIngredientUnits] = useState(contextUnits || {})
    const [editingCost, setEditingCost] = useState(null)
    const [saving, setSaving] = useState(false)

    // Create form
    const [newName, setNewName] = useState('')
    const [newUnit, setNewUnit] = useState('')

    const [newCategory, setNewCategory] = useState(null)
    const [showCreateModal, setShowCreateModal] = useState(false)

    // View mode = active category tab. Uncategorized NVL (category=null) shown under 'main'.
    // Seed from location.state so deep-links from /recipes' tabbar land on the right view.
    const [viewMode, setViewMode] = useState(location.state?.viewMode || 'main')

    // Search theo tên — không phân biệt hoa/thường & dấu tiếng Việt.
    const [search, setSearch] = useState('')

    const mainRef = useRef(null)

    // Restore scroll on back nav from /ingredients/:key; clear cache after use.
    useEffect(() => {
        if (savedScroll !== null && mainRef.current) {
            mainRef.current.scrollTop = savedScroll
            savedScroll = null
        }
    }, [])

    const openIngredient = (ingredient) => {
        savedScroll = mainRef.current?.scrollTop ?? 0
        // Carry viewMode forward so the detail page can hand it back on goBack,
        // restoring the same tab (Bao bì vs Nguyên liệu) the user opened from.
        navigate(`/ingredients/${ingredient}`, { state: { ...location.state, viewMode } })
    }

    // Stock & modals
    const [ingredientStocks, setIngredientStocks] = useState([])
    const [restockIngredient, setRestockIngredient] = useState(null)
    // Đã chốt ca tiền hôm nay chưa → default phân loại tiền mặt khi nhập kho. Fetch khi
    // mở modal nhập kho để luôn tươi (user có thể vừa chốt ở /daily-report).
    const [cashClosedToday, setCashClosedToday] = useState(false)
    useEffect(() => {
        if (!restockIngredient) return
        let alive = true
        fetchCashClosedToday(selectedAddress?.id).then(v => { if (alive) setCashClosedToday(!!v) })
        return () => { alive = false }
    }, [restockIngredient, selectedAddress?.id])
    const [showKeySync, setShowKeySync] = useState(false)
    const [dismissedSig, setDismissedSig] = useState('')
    const [stockDeficits, setStockDeficits] = useState([])
    const [dailyContext, setDailyContext] = useState({})
    // Tồn quầy riêng của từng địa chỉ khác trong nhóm kho dùng chung (kho thì gộp, quầy thì không).
    const [siblingStocks, setSiblingStocks] = useState({})

    // Filter recipes to only those referencing currently active products.
    // Without this, dead recipes for soft-deleted products show as false-positive orphans.
    const liveRecipes = useMemo(() => {
        const activeIds = new Set((contextProducts || []).map(p => p.id))
        return (contextRecipes || []).filter(r => activeIds.has(r.product_id))
    }, [contextRecipes, contextProducts])

    // Filter extra-ingredients to only those owned by extras of CURRENTLY ACTIVE products.
    // Soft-deleted products may keep their extras + extra_ingredients rows; we shouldn't flag
    // those as user-fixable orphans (they're effectively dead data).
    const liveExtraIngredients = useMemo(() => {
        const activeExtraIds = new Set()
        for (const list of Object.values(contextProductExtras || {})) {
            for (const e of list || []) activeExtraIds.add(e.id)
        }
        const filtered = {}
        for (const [extraId, list] of Object.entries(contextExtraIngs || {})) {
            if (activeExtraIds.has(extraId)) filtered[extraId] = list
        }
        return filtered
    }, [contextProductExtras, contextExtraIngs])

    // Per-address list of orphan keys the user has explicitly silenced. Loaded
    // from localStorage; filters orphan*Keys out of the mismatch result entirely
    // so the banner clears and the modal stops listing them.
    const [ignoredOrphans, setIgnoredOrphans] = useState(() => new Set())
    useEffect(() => {
        if (!selectedAddress) { setIgnoredOrphans(new Set()); return }
        try {
            const raw = localStorage.getItem(orphanIgnoredKey(selectedAddress.id))
            setIgnoredOrphans(new Set(raw ? JSON.parse(raw) : []))
        } catch { setIgnoredOrphans(new Set()) }
    }, [selectedAddress])

    const handleIgnoreOrphan = (key) => {
        if (!selectedAddress) return
        setIgnoredOrphans(prev => {
            const next = new Set(prev)
            next.add(key)
            try { localStorage.setItem(orphanIgnoredKey(selectedAddress.id), JSON.stringify([...next])) }
            catch { /* localStorage full or disabled — keep in-memory only */ }
            return next
        })
    }

    const handleAssignOrphan = async (oldKey, newKey) => {
        if (!selectedAddress || !oldKey || !newKey || oldKey === newKey) return
        await syncIngredientKey(selectedAddress.id, oldKey, newKey)
        await Promise.all([loadStocks(), refreshProducts?.()])
    }

    const keyMismatches = useMemo(
        () => detectKeyMismatches({
            recipes: liveRecipes,
            ingredientCosts,
            inventoryReport: ingredientStocks,
            extraIngredients: liveExtraIngredients,
            ignoredKeys: ignoredOrphans,
        }),
        [liveRecipes, ingredientCosts, ingredientStocks, liveExtraIngredients, ignoredOrphans]
    )

    // Signature of current mismatches — used to detect when dismissed warning should re-surface.
    const mismatchSig = useMemo(() => {
        if (!keyMismatches.hasIssues) return ''
        const parts = [
            ...keyMismatches.orphanRecipeKeys.map(k => `r:${k}`),
            ...keyMismatches.orphanInventoryKeys.map(k => `i:${k}`),
            ...(keyMismatches.orphanExtraIngredientKeys || []).map(k => `e:${k}`),
            ...keyMismatches.labelCollisions.map(c => `c:${c.keys.join('|')}`),
        ]
        return parts.sort().join(',')
    }, [keyMismatches])

    useEffect(() => {
        if (!selectedAddress) { setDismissedSig(''); return }
        try { setDismissedSig(localStorage.getItem(keySyncDismissedKey(selectedAddress.id)) || '') }
        catch { setDismissedSig('') }
    }, [selectedAddress])

    const isDismissed = mismatchSig !== '' && dismissedSig === mismatchSig

    const handleDismissBanner = (e) => {
        e.stopPropagation()
        if (!selectedAddress || !mismatchSig) return
        try {
            localStorage.setItem(keySyncDismissedKey(selectedAddress.id), mismatchSig)
            setDismissedSig(mismatchSig)
        } catch { /* localStorage may be full or disabled */ }
    }

    // ponytail: mount-only refresh — refreshProducts already refetches on address
    // change via its own effect in ProductContext; adding it here would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refreshProducts?.() }, [])

    const loadStocks = useCallback(async () => {
        // selectedAddress.id may be null for the default template — fetchIngredientStocks
        // handles that (queries rows with address_id IS NULL) so admins can manage stock on
        // the playground template too.
        if (!selectedAddress) return
        const siblingIds = groupAddressIds.filter(id => id !== (selectedAddress.id ?? null))
        const [stocks, deficits, daily, ...siblingResults] = await Promise.all([
            fetchIngredientStocks(selectedAddress.id ?? null),
            fetchIngredientDeficits(groupAddressIds),
            fetchIngredientDailyContext(selectedAddress.id ?? null),
            ...siblingIds.map(id => fetchIngredientStocks(id)),
        ])
        setIngredientStocks(stocks)
        setStockDeficits(deficits)
        setDailyContext(daily)
        const siblingMap = {}
        siblingIds.forEach((id, i) => { siblingMap[id] = siblingResults[i] })
        setSiblingStocks(siblingMap)
        // ponytail: deliberately keyed on id+name, not the whole object — selectedAddress
        // gets a new reference on every context refetch even when nothing relevant changed
        // (e.g. ingredient_sort_order edits), which would refire this on every such update.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAddress?.id, selectedAddress?.name, groupAddressIds])
    useEffect(() => { loadStocks() }, [loadStocks])

    useEffect(() => { setIngredientCosts(contextCosts) }, [contextCosts])
    useEffect(() => { setIngredientUnits(contextUnits || {}) }, [contextUnits])

    const allIngredients = useMemo(
        () => Object.keys(ingredientCosts).sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order)),
        [ingredientCosts, selectedAddress?.ingredient_sort_order]
    )

    // PERF: index stocks by ingredient ONCE.
    // Was: ingredientStocks.find() in render per ingredient — O(N×M).
    const stockByIngredient = useMemo(() => {
        const map = new Map()
        for (const s of ingredientStocks) map.set(s.ingredient, s)
        return map
    }, [ingredientStocks])

    // Tồn quầy theo từng địa chỉ trong nhóm kho dùng chung — null nếu kho không thuộc nhóm nào
    // (card list rơi về hiển thị tồn quầy của riêng địa chỉ đang chọn).
    const counterStocksByIngredient = useMemo(() => {
        if (!warehouseSiblings || warehouseSiblings.length === 0) return null
        const siblingByIngredient = new Map()
        for (const [addrId, stocks] of Object.entries(siblingStocks)) {
            const inner = new Map()
            for (const s of stocks) inner.set(s.ingredient, s)
            siblingByIngredient.set(addrId, inner)
        }
        const addrs = [
            { id: selectedAddress?.id ?? null, name: selectedAddress?.name || 'Kho này' },
            ...warehouseSiblings.map(a => ({ id: a.id, name: a.name })),
        ]
        const map = new Map()
        for (const ing of allIngredients) {
            map.set(ing, addrs.map(addr => {
                const row = addr.id === (selectedAddress?.id ?? null)
                    ? stockByIngredient.get(ing)
                    : siblingByIngredient.get(addr.id)?.get(ing)
                return { addressId: addr.id, addressName: addr.name, counterStock: row?.counter_stock ?? 0 }
            }))
        }
        return map
    }, [warehouseSiblings, selectedAddress, allIngredients, stockByIngredient, siblingStocks])

    // PERF: index configs by ingredient ONCE.
    // Was: ingredientConfigs.find() called THREE times per ingredient (packSize, packUnit, minStock).
    const configByIngredient = useMemo(() => {
        const map = new Map()
        for (const c of ingredientConfigs || []) map.set(c.ingredient, c)
        return map
    }, [ingredientConfigs])

    // PERF: precompute recipe-usage count per ingredient (avoids O(N) walk on every delete confirm).
    const recipeUsageByIngredient = useMemo(() => {
        const map = new Map()
        for (const r of contextRecipes || []) {
            map.set(r.ingredient, (map.get(r.ingredient) || 0) + 1)
        }
        return map
    }, [contextRecipes])

    // Card grid shows only the active category tab. Uncategorized (null) → 'main';
    // legacy 'tools' → 'packaging' (see normalizeIngredientCategory). Keeps no NVL hidden.
    const visibleIngredients = useMemo(() => {
        const q = normalizeText(search.trim())
        const filtered = allIngredients.filter(ing => {
            if (normalizeIngredientCategory(configByIngredient.get(ing)?.category) !== viewMode) return false
            return !q || normalizeText(ingredientLabel(ing)).includes(q)
        })
        // Sort: hết (out) → sắp hết (low) → bình thường. Skip if no alerts.
        const getStockPriority = (ing) => {
            const stock = stockByIngredient.get(ing)?.current_stock ?? null
            const minStock = configByIngredient.get(ing)?.min_stock || 0
            if (stock !== null && stock <= 0) return 0        // hết
            if (stock !== null && stock > 0 && stock < minStock) return 1  // sắp hết
            return 2                                          // bình thường
        }
        const hasAlerts = filtered.some(ing => getStockPriority(ing) < 2)
        if (!hasAlerts) return filtered
        return [...filtered].sort((a, b) => getStockPriority(a) - getStockPriority(b))
    }, [allIngredients, configByIngredient, viewMode, stockByIngredient, search])

    // ─── Action handlers ───────────────────────────────────────────────
    async function saveCost(ingredient, newCostVal) {
        setSaving(true)
        try {
            await updateIngredientUnitCost(ingredient, newCostVal, selectedAddress?.id)
            setIngredientCosts(prev => ({ ...prev, [ingredient]: newCostVal }))
        } catch (err) {
            showError(err, 'Lưu giá nguyên liệu')
        } finally {
            setSaving(false)
            setEditingCost(prev => prev?.ingredient === ingredient ? null : prev)
        }
    }

    async function handleCreateIngredient() {
        if (!newName.trim()) return
        const key = normalizeIngredientKey(newName)
        const unit = newUnit || 'đv'
        setSaving(true)
        try {
            await upsertIngredientCost(key, 0, selectedAddress?.id, unit, { category: newCategory })
            setIngredientUnits(prev => ({ ...prev, [key]: unit }))
            // Refresh configs so the new ingredient picks up its category in `configByIngredient`.
            refreshProducts?.()
            setNewName(''); setNewUnit(''); setNewCategory(null)
            setShowCreateModal(false)
            showToast('Đã tạo nguyên liệu', 'success')
        } catch (err) {
            showError(err, 'Tạo nguyên liệu mới')
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteIngredient(ingredient) {
        const recipeCount = recipeUsageByIngredient.get(ingredient) || 0
        const label = ingredientLabel(ingredient)
        const detail = recipeCount > 0
            ? `Đang dùng trong ${recipeCount} công thức — xóa sẽ gỡ khỏi tất cả công thức liên quan.`
            : null
        if (!await confirm({ title: `Xóa nguyên liệu "${label}"?`, detail, danger: true, confirmLabel: 'Xóa' })) return
        setSaving(true)
        try {
            await deleteIngredientCost(ingredient, selectedAddress?.id)
            setIngredientCosts(prev => { const next = { ...prev }; delete next[ingredient]; return next })
            setIngredientUnits(prev => { const next = { ...prev }; delete next[ingredient]; return next })
            showToast('Đã xóa nguyên liệu', 'success')
        } catch (err) {
            showError(err, 'Xóa nguyên liệu')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <IngredientsHeader
                count={visibleIngredients.length}
                onBack={() => goToMenuStep(viewMode, -1, { navigate, backTo: location.state?.from || '/history', setViewMode, wizard: location.state?.wizard })}
                onForward={() => goToMenuStep(viewMode, +1, { navigate, backTo: location.state?.from || '/history', setViewMode, wizard: location.state?.wizard })}
                activeTab={viewMode}
                onTabSelect={(key) => {
                    if (key === 'recipes') navigate('/recipes', { state: location.state, replace: true })
                    else setViewMode(key)
                }}
            />

            <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-4 pb-48 bg-bg">
                <div className="mb-3">
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={viewMode === 'packaging' ? 'Tìm bao bì…' : 'Tìm nguyên liệu…'}
                        className="w-full px-3 py-2.5 rounded-[12px] bg-surface border border-border/60 text-text text-[14px] placeholder:text-text-dim focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    />
                </div>
                {canEdit && stockDeficits.length > 0 && (
                    <StockDeficitBanner
                        deficits={stockDeficits}
                        ingredientUnits={ingredientUnits}
                        configByIngredient={configByIngredient}
                        addressId={selectedAddress?.id ?? null}
                        staffName={profile?.name}
                        onResolved={() => loadStocks()}
                    />
                )}
                {canEdit && keyMismatches.hasIssues && !isDismissed && (
                    <KeyMismatchBanner
                        mismatches={keyMismatches}
                        onView={() => setShowKeySync(true)}
                        onDismiss={handleDismissBanner}
                    />
                )}

                <div className="flex flex-col gap-2.5">
                    {visibleIngredients.map(ingredient => {
                        const cfg = configByIngredient.get(ingredient)
                        return (
                            <IngredientCostItem
                                key={ingredient}
                                ingredient={ingredient}
                                cost={ingredientCosts[ingredient] || 0}
                                isEditing={editingCost?.ingredient === ingredient}
                                editingCost={editingCost}
                                setEditingCost={setEditingCost}
                                saveCost={saveCost}
                                ingredientLabel={ingredientLabel}
                                getIngredientUnit={getIngredientUnit}
                                storedUnit={ingredientUnits[ingredient]}
                                onDelete={canEdit ? handleDeleteIngredient : null}
                                canEdit={canEdit}
                                packSize={cfg?.pack_size}
                                packUnit={cfg?.pack_unit}
                                minStock={cfg?.min_stock}
                                stockData={stockByIngredient.get(ingredient)}
                                siblingCounterStocks={counterStocksByIngredient?.get(ingredient)}
                                onRestock={() => setRestockIngredient(ingredient)}
                                dailyContext={dailyContext[ingredient]}
                                onOpen={openIngredient}
                            />
                        )
                    })}
                    {visibleIngredients.length === 0 && (
                        <p className="text-text-secondary text-[13px] text-center py-6">
                            {search.trim()
                                ? 'Không tìm thấy nguyên liệu nào.'
                                : allIngredients.length === 0 ? 'Chưa có nguyên liệu nào.' : 'Chưa có nguyên liệu trong nhóm này.'}
                        </p>
                    )}
                </div>
            </main>

            {canEdit && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-50">
                    <div className="flex justify-end px-4 pb-[max(env(safe-area-inset-bottom),16px)] pointer-events-auto">
                        <button
                            onClick={() => { setNewCategory(viewMode); setShowCreateModal(true) }}
                            aria-label={viewMode === 'packaging' ? 'Tạo bao bì' : 'Tạo nguyên liệu'}
                            className="rounded-[12px] px-4 py-2.5 flex items-center justify-center text-[13px] font-bold active:scale-95 transition-all border bg-primary border-primary text-bg shadow-lg shadow-primary/30 hover:bg-primary/90"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>
            )}

            {showCreateModal && (
                <BottomSheet
                    onClose={() => !saving && setShowCreateModal(false)}
                    panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
                >
                        <div className="flex items-center justify-between">
                            <span className="text-[16px] font-black text-text">{newCategory === 'packaging' ? 'Tạo bao bì mới' : 'Tạo nguyên liệu mới'}</span>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                disabled={saving}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all disabled:opacity-50"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <CreateIngredientForm
                            name={newName}
                            unit={newUnit}
                            saving={saving}
                            onNameChange={setNewName}
                            onUnitChange={setNewUnit}
                            onSubmit={handleCreateIngredient}
                        />
                </BottomSheet>
            )}

            {saving && (
                <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                    <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                </div>
            )}

            {restockIngredient && (
                <RestockModal
                    ingredient={restockIngredient}
                    unit={getIngredientUnit(restockIngredient, ingredientUnits[restockIngredient])}
                    packSize={configByIngredient.get(restockIngredient)?.pack_size}
                    packUnit={configByIngredient.get(restockIngredient)?.pack_unit}
                    cashClosedToday={cashClosedToday}
                    onClose={() => setRestockIngredient(null)}
                    onConfirm={async ({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }) => {
                        // beforeStock only used by guest / default-address paths;
                        // the address RPC computes its own authoritative snapshot.
                        // Only include when the stocks fetch has actually resolved
                        // for this ingredient — avoid baking in a fake 0 baseline.
                        const stockRow = stockByIngredient.get(ing)
                        const snapshot = stockRow
                            ? { beforeStock: stockRow.warehouse_stock }
                            : {}
                        const result = await processIngredientRestock(selectedAddress?.id, ing, qty, profile?.name, {
                            subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
                            ...snapshot,
                        })
                        await Promise.all([loadStocks(), refreshProducts?.(), refreshTodayExpenses?.()])
                        showToast('Đã nhập kho', 'success')
                        requestOnboardingRefresh()
                        return result
                    }}
                />
            )}

            <KeySyncModal
                open={showKeySync}
                onClose={() => setShowKeySync(false)}
                mismatches={keyMismatches}
                recipes={liveRecipes}
                allRecipes={contextRecipes || []}
                products={contextProducts || []}
                productExtras={contextProductExtras || {}}
                extraIngredients={liveExtraIngredients}
                ingredientCosts={ingredientCosts}
                addressId={selectedAddress?.id}
                onIgnoreKey={handleIgnoreOrphan}
                onAssignKey={handleAssignOrphan}
                onComplete={async () => {
                    await Promise.all([loadStocks(), refreshProducts?.()])
                }}
            />
        </div>
    )
}
