import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { usePOS } from '../contexts/POSContext'
import {
    upsertIngredientCost, deleteIngredientCost, renameIngredient,
    fetchIngredientStocks, processIngredientRestock, adjustIngredientStock, fetchIngredientDeficits, fetchIngredientDailyContext,
} from '../services/orderService'
import { sortIngredients, ingredientLabel, getIngredientUnit } from '../components/common/recipeUtils'
import IngredientCostItem from '../components/IngredientManagementPage/IngredientCostItem'
import RestockModal from '../components/IngredientManagementPage/RestockModal'
import KeySyncModal from '../components/IngredientManagementPage/KeySyncModal'
import PackConfigModal from '../components/IngredientManagementPage/PackConfigModal'
import StockDeficitBanner from '../components/IngredientManagementPage/StockDeficitBanner'
import KeyMismatchBanner from '../components/IngredientManagementPage/KeyMismatchBanner'
import IngredientsHeader from '../components/IngredientManagementPage/IngredientsHeader'
import CreateIngredientForm from '../components/IngredientManagementPage/CreateIngredientForm'
import SortableList from '../components/common/SortableList'
import { detectKeyMismatches } from '../utils/ingredientKeySync'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import { keySyncDismissedKey } from '../constants/storageKeys'

const normalizeKey = (raw) => raw.trim().toLowerCase().replace(/\s+/g, '_')

export default function IngredientManagementPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const {
        ingredientCosts: contextCosts, ingredientUnits: contextUnits,
        recipes: contextRecipes, products: contextProducts, ingredientConfigs,
        productExtras: contextProductExtras, extraIngredients: contextExtraIngs,
        refreshProducts,
    } = useProducts()
    const { selectedAddress, updateSortOrder } = useAddress()
    const { isManager, isAdmin, profile } = useAuth()
    const { refreshTodayExpenses } = usePOS()
    const { toast, showError } = useToast()
    const canEdit = isManager || isAdmin

    const [ingredientCosts, setIngredientCosts] = useState(contextCosts || {})
    const [ingredientUnits, setIngredientUnits] = useState(contextUnits || {})
    const [editingCost, setEditingCost] = useState(null)
    const [editingUnit, setEditingUnit] = useState(null)
    const [editingName, setEditingName] = useState(null)
    const [editingStock, setEditingStock] = useState(null)
    const [saving, setSaving] = useState(false)

    // Sort mode
    const [isSorting, setIsSorting] = useState(false)
    const [sortedIngredients, setSortedIngredients] = useState([])
    const [selectedSortIngredient, setSelectedSortIngredient] = useState(null)

    // Create form
    const [newName, setNewName] = useState('')
    const [newUnit, setNewUnit] = useState('')
    const [newCost, setNewCost] = useState('')

    // Stock & modals
    const [ingredientStocks, setIngredientStocks] = useState([])
    const [restockIngredient, setRestockIngredient] = useState(null)
    const [packConfigIngredient, setPackConfigIngredient] = useState(null)
    const [showKeySync, setShowKeySync] = useState(false)
    const [dismissedSig, setDismissedSig] = useState('')
    const [stockDeficits, setStockDeficits] = useState([])
    const [dailyContext, setDailyContext] = useState({})

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

    const keyMismatches = useMemo(
        () => detectKeyMismatches({
            recipes: liveRecipes,
            ingredientCosts,
            inventoryReport: ingredientStocks,
            extraIngredients: liveExtraIngredients,
        }),
        [liveRecipes, ingredientCosts, ingredientStocks, liveExtraIngredients]
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
        if (!selectedAddress?.id) { setDismissedSig(''); return }
        try { setDismissedSig(localStorage.getItem(keySyncDismissedKey(selectedAddress.id)) || '') }
        catch { setDismissedSig('') }
    }, [selectedAddress?.id])

    const isDismissed = mismatchSig !== '' && dismissedSig === mismatchSig

    const handleDismissBanner = (e) => {
        e.stopPropagation()
        if (!selectedAddress?.id || !mismatchSig) return
        try {
            localStorage.setItem(keySyncDismissedKey(selectedAddress.id), mismatchSig)
            setDismissedSig(mismatchSig)
        } catch { /* localStorage may be full or disabled */ }
    }

    useEffect(() => { refreshProducts?.() }, [])

    const loadStocks = async () => {
        // selectedAddress.id may be null for the default template — fetchIngredientStocks
        // handles that (queries rows with address_id IS NULL) so admins can manage stock on
        // the playground template too.
        if (!selectedAddress) return
        const [stocks, deficits, daily] = await Promise.all([
            fetchIngredientStocks(selectedAddress.id ?? null),
            fetchIngredientDeficits(selectedAddress.id ?? null),
            fetchIngredientDailyContext(selectedAddress.id ?? null),
        ])
        setIngredientStocks(stocks)
        setStockDeficits(deficits)
        setDailyContext(daily)
    }
    useEffect(() => { loadStocks() }, [selectedAddress?.id, selectedAddress?.name])

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

    // ─── Action handlers ───────────────────────────────────────────────
    async function saveCost(ingredient, newCostVal) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredient, newCostVal, selectedAddress?.id)
            setIngredientCosts(prev => ({ ...prev, [ingredient]: newCostVal }))
        } catch (err) {
            showError(err, 'Lưu giá nguyên liệu')
        } finally {
            setSaving(false)
            setEditingCost(prev => prev?.ingredient === ingredient ? null : prev)
        }
    }

    async function handleRenameIngredient(oldKey, newDisplayName) {
        const newKey = normalizeKey(newDisplayName)
        if (!newKey || newKey === oldKey) { setEditingName(null); return }
        setSaving(true)
        try {
            await renameIngredient(oldKey, newKey, selectedAddress?.id)
            setIngredientCosts(prev => {
                const next = { ...prev }
                next[newKey] = next[oldKey]
                delete next[oldKey]
                return next
            })
            setIngredientUnits(prev => {
                const next = { ...prev }
                next[newKey] = next[oldKey]
                delete next[oldKey]
                return next
            })
        } catch (err) {
            showError(err, 'Đổi tên nguyên liệu')
        } finally {
            setSaving(false)
            setEditingName(prev => prev?.ingredient === oldKey ? null : prev)
        }
    }

    async function saveUnit(ingredient, newUnitVal, currentCost) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredient, currentCost, selectedAddress?.id, newUnitVal)
            setIngredientUnits(prev => ({ ...prev, [ingredient]: newUnitVal }))
        } catch (err) {
            showError(err, 'Lưu đơn vị nguyên liệu')
        } finally {
            setSaving(false)
            setEditingUnit(prev => prev?.ingredient === ingredient ? null : prev)
        }
    }

    async function handleSaveAdvanced(ingredient, { packSize, packUnit, minStock }) {
        setSaving(true)
        try {
            const cost = ingredientCosts[ingredient] || 0
            const unit = ingredientUnits[ingredient] || 'đv'
            await upsertIngredientCost(ingredient, cost, selectedAddress?.id, unit, { packSize, packUnit, minStock })
            refreshProducts?.() // refresh configs into ProductContext
        } catch (err) {
            showError(err, 'Lưu cấu hình nâng cao')
        } finally {
            setSaving(false)
        }
    }

    async function handleCreateIngredient() {
        if (!newName.trim()) return
        const key = normalizeKey(newName)
        const unit = newUnit || 'đv'
        const cost = parseInt(newCost) || 0
        setSaving(true)
        try {
            await upsertIngredientCost(key, cost, selectedAddress?.id, unit)
            setIngredientCosts(prev => ({ ...prev, [key]: cost }))
            setIngredientUnits(prev => ({ ...prev, [key]: unit }))
            setNewName(''); setNewUnit(''); setNewCost('')
        } catch (err) {
            showError(err, 'Tạo nguyên liệu mới')
        } finally {
            setSaving(false)
        }
    }

    async function saveStock(ingredient, newTotalRaw, currentTotal) {
        setEditingStock(null)
        const newTotal = Number(newTotalRaw)
        if (!Number.isFinite(newTotal) || newTotal < 0) return
        const delta = newTotal - currentTotal
        if (delta === 0) return
        setSaving(true)
        try {
            await adjustIngredientStock(selectedAddress?.id, ingredient, delta, profile?.name)
            await Promise.all([loadStocks(), refreshTodayExpenses?.()])
        } catch (err) {
            showError(err, 'Hiệu chỉnh tồn')
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteIngredient(ingredient) {
        const recipeCount = recipeUsageByIngredient.get(ingredient) || 0
        const label = ingredientLabel(ingredient)
        const warning = recipeCount > 0
            ? `"${label}" đang được dùng trong ${recipeCount} công thức. Xóa sẽ gỡ nó khỏi tất cả công thức liên quan. Tiếp tục?`
            : `Xóa nguyên liệu "${label}"?`
        if (!window.confirm(warning)) return
        setSaving(true)
        try {
            await deleteIngredientCost(ingredient, selectedAddress?.id)
            setIngredientCosts(prev => { const next = { ...prev }; delete next[ingredient]; return next })
            setIngredientUnits(prev => { const next = { ...prev }; delete next[ingredient]; return next })
        } catch (err) {
            showError(err, 'Xóa nguyên liệu')
        } finally {
            setSaving(false)
        }
    }

    // Sort mode
    const enterSortMode = () => { setSortedIngredients([...allIngredients]); setIsSorting(true); setSelectedSortIngredient(null) }
    const cancelSortMode = () => { setIsSorting(false); setSortedIngredients([]); setSelectedSortIngredient(null) }
    const moveIngredient = (from, to) => {
        if (to < 0 || to >= sortedIngredients.length) return
        const updated = [...sortedIngredients]
        const [moved] = updated.splice(from, 1)
        updated.splice(to, 0, moved)
        setSortedIngredients(updated)
    }
    const saveSortOrderHandler = async () => {
        if (!selectedAddress) return
        setSaving(true)
        try {
            // selectedAddress.id may be null for the default template — AddressContext.updateSortOrder
            // routes to app_settings in that case so the order persists for the playground.
            await updateSortOrder(selectedAddress.id ?? null, sortedIngredients)
            setIsSorting(false)
            setSelectedSortIngredient(null)
        } catch (err) {
            showError(err, 'Lưu thứ tự nguyên liệu')
        } finally {
            setSaving(false)
        }
    }

    const showFooterCreate = !isSorting && canEdit
    const showFooterSort = isSorting

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <IngredientsHeader
                count={isSorting ? sortedIngredients.length : allIngredients.length}
                isSorting={isSorting}
                onBack={() => navigate(location.state?.from || '/history')}
                onForward={() => navigate('/pos')}
                activeTab="ingredients"
                onTabSelect={(key) => {
                    if (key === 'recipes') navigate('/recipes', { state: location.state, replace: true })
                }}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-48 bg-bg">
                {canEdit && !isSorting && stockDeficits.length > 0 && (
                    <StockDeficitBanner
                        deficits={stockDeficits}
                        ingredientUnits={ingredientUnits}
                        configByIngredient={configByIngredient}
                        addressId={selectedAddress?.id ?? null}
                        staffName={profile?.name}
                        onResolved={() => loadStocks()}
                    />
                )}
                {canEdit && !isSorting && keyMismatches.hasIssues && !isDismissed && (
                    <KeyMismatchBanner
                        mismatches={keyMismatches}
                        onView={() => setShowKeySync(true)}
                        onDismiss={handleDismissBanner}
                    />
                )}

                {isSorting ? (
                    <SortableList
                        items={sortedIngredients}
                        getKey={i => i}
                        getLabel={i => ingredientLabel(i)}
                        selectedKey={selectedSortIngredient}
                        onSelect={setSelectedSortIngredient}
                        onMove={moveIngredient}
                    />
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {allIngredients.map(ingredient => {
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
                                    isEditingUnit={editingUnit?.ingredient === ingredient}
                                    editingUnit={editingUnit}
                                    setEditingUnit={setEditingUnit}
                                    saveUnit={saveUnit}
                                    isEditingName={editingName?.ingredient === ingredient}
                                    editingName={editingName}
                                    setEditingName={setEditingName}
                                    saveName={handleRenameIngredient}
                                    onDelete={canEdit ? handleDeleteIngredient : null}
                                    canEdit={canEdit}
                                    packSize={cfg?.pack_size}
                                    packUnit={cfg?.pack_unit}
                                    minStock={cfg?.min_stock}
                                    onSaveAdvanced={handleSaveAdvanced}
                                    onConfigurePack={canEdit ? setPackConfigIngredient : null}
                                    stockData={stockByIngredient.get(ingredient)}
                                    onRestock={() => setRestockIngredient(ingredient)}
                                    dailyContext={dailyContext[ingredient]}
                                    isEditingStock={editingStock?.ingredient === ingredient}
                                    editingStock={editingStock}
                                    setEditingStock={setEditingStock}
                                    saveStock={saveStock}
                                />
                            )
                        })}
                        {allIngredients.length === 0 && (
                            <p className="col-span-2 text-text-secondary text-[13px] text-center py-6">Chưa có nguyên liệu nào.</p>
                        )}
                    </div>
                )}
            </main>

            {(showFooterCreate || showFooterSort) && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-50">
                    {showFooterCreate && (
                        <div className="flex justify-end px-4 mb-2 pointer-events-auto">
                            <button
                                onClick={enterSortMode}
                                className="bg-surface border border-border/60 rounded-[12px] px-4 py-2.5 flex items-center justify-center text-[13px] font-bold text-text-secondary hover:bg-surface-light active:scale-95 transition-all shadow-sm"
                            >
                                ↕ Sắp xếp
                            </button>
                        </div>
                    )}

                    <div className="p-4 bg-surface border-t border-border/60 pointer-events-auto">
                        {showFooterSort ? (
                            <div className="flex gap-2">
                                <button
                                    onClick={cancelSortMode}
                                    className="flex-1 py-3 rounded-[12px] bg-surface-light border border-border/60 text-text-secondary font-black hover:bg-border/40 active:scale-95 transition-all text-[14px]"
                                >
                                    Hủy
                                </button>
                                <button
                                    onClick={saveSortOrderHandler}
                                    disabled={saving}
                                    className="flex-1 py-3 rounded-[12px] bg-primary text-bg font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 text-[14px]"
                                >
                                    {saving ? '⏳ Đang lưu...' : 'Lưu sắp xếp'}
                                </button>
                            </div>
                        ) : (
                            <CreateIngredientForm
                                name={newName}
                                unit={newUnit}
                                cost={newCost}
                                saving={saving}
                                onNameChange={setNewName}
                                onUnitChange={setNewUnit}
                                onCostChange={setNewCost}
                                onSubmit={handleCreateIngredient}
                            />
                        )}
                    </div>
                </div>
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
                    onClose={() => setRestockIngredient(null)}
                    onConfirm={async ({ ingredient: ing, qty, totalCost }) => {
                        const result = await processIngredientRestock(selectedAddress?.id, ing, qty, totalCost, profile?.name)
                        await Promise.all([loadStocks(), refreshProducts?.(), refreshTodayExpenses?.()])
                        return result
                    }}
                />
            )}

            {packConfigIngredient && (() => {
                const cfg = configByIngredient.get(packConfigIngredient) || {}
                const baseUnit = getIngredientUnit(packConfigIngredient, ingredientUnits[packConfigIngredient])
                return (
                    <PackConfigModal
                        open={true}
                        onClose={() => setPackConfigIngredient(null)}
                        ingredientLabel={ingredientLabel(packConfigIngredient)}
                        baseUnit={baseUnit}
                        currentPackSize={cfg.pack_size}
                        currentPackUnit={cfg.pack_unit}
                        onSave={async ({ packSize, packUnit }) => {
                            await handleSaveAdvanced(packConfigIngredient, { packSize, packUnit, minStock: cfg.min_stock })
                        }}
                    />
                )
            })()}

            <KeySyncModal
                open={showKeySync}
                onClose={() => setShowKeySync(false)}
                mismatches={keyMismatches}
                recipes={liveRecipes}
                products={contextProducts || []}
                productExtras={contextProductExtras || {}}
                extraIngredients={liveExtraIngredients}
                ingredientCosts={ingredientCosts}
                addressId={selectedAddress?.id}
                onComplete={async () => {
                    await Promise.all([loadStocks(), refreshProducts?.()])
                }}
            />
        </div>
    )
}
