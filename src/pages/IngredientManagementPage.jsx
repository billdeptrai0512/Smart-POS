import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { usePOS } from '../contexts/POSContext'

import { upsertIngredientCost, deleteIngredientCost, renameIngredient, fetchIngredientStocks, processIngredientRestock, adjustIngredientStock } from '../services/orderService'
import { sortIngredients, ingredientLabel, getIngredientUnit } from '../components/common/recipeUtils'
import IngredientCostItem from '../components/IngredientManagementPage/IngredientCostItem'
import RestockModal from '../components/IngredientManagementPage/RestockModal'
import KeySyncModal from '../components/IngredientManagementPage/KeySyncModal'
import PackConfigModal from '../components/IngredientManagementPage/PackConfigModal'
import { detectKeyMismatches } from '../utils/ingredientKeySync'
import { ArrowLeft, AlertTriangle, X } from 'lucide-react'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import { formatVND } from '../utils'

export default function IngredientManagementPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { ingredientCosts: contextCosts, ingredientUnits: contextUnits, recipes: contextRecipes, products: contextProducts, ingredientConfigs, refreshProducts } = useProducts()
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

    // Sorting state
    const [isSorting, setIsSorting] = useState(false)
    const [sortedIngredients, setSortedIngredients] = useState([])
    const [selectedSortIngredient, setSelectedSortIngredient] = useState(null)

    // Create ingredient state
    const [newIngredientName, setNewIngredientName] = useState('')
    const [newIngredientUnit, setNewIngredientUnit] = useState('')
    const [newIngredientCost, setNewIngredientCost] = useState('')

    // Stock & Restock state
    const [ingredientStocks, setIngredientStocks] = useState([])
    const [restockIngredient, setRestockIngredient] = useState(null)

    // Pack-config modal state (quy cách đóng gói: 1 hộp = X đơn vị)
    const [packConfigIngredient, setPackConfigIngredient] = useState(null)

    // Key-sync modal state
    const [showKeySync, setShowKeySync] = useState(false)
    const [dismissedSig, setDismissedSig] = useState('')

    // Filter recipes to only those referencing currently active products.
    // Without this, dead recipes for soft-deleted products (is_active=false) show as false-positive
    // orphans — vd: chi nhánh có 191 recipes nhưng 14 cái thuộc products đã ngừng bán.
    const liveRecipes = useMemo(() => {
        const activeIds = new Set((contextProducts || []).map(p => p.id))
        return (contextRecipes || []).filter(r => activeIds.has(r.product_id))
    }, [contextRecipes, contextProducts])

    // Detect ingredient-key mismatches across recipes / ingredient_costs / inventory.
    // Uses ingredientStocks (superset of latest inventory_report keys) as proxy for inventory.
    const keyMismatches = useMemo(
        () => detectKeyMismatches({
            recipes: liveRecipes,
            ingredientCosts,
            inventoryReport: ingredientStocks
        }),
        [liveRecipes, ingredientCosts, ingredientStocks]
    )

    // Signature of current mismatches — used to detect when dismissed warning should re-surface
    // (vd: user dismiss `[cup, Đá]`, sau đó thêm orphan `Đường` → signature đổi → banner hiện lại)
    const mismatchSig = useMemo(() => {
        if (!keyMismatches.hasIssues) return ''
        const parts = [
            ...keyMismatches.orphanRecipeKeys.map(k => `r:${k}`),
            ...keyMismatches.orphanInventoryKeys.map(k => `i:${k}`),
            ...keyMismatches.labelCollisions.map(c => `c:${c.keys.join('|')}`)
        ]
        return parts.sort().join(',')
    }, [keyMismatches])

    // Load dismissed signature for current address from localStorage
    useEffect(() => {
        if (!selectedAddress?.id) { setDismissedSig(''); return }
        try {
            setDismissedSig(localStorage.getItem(`key_sync_dismissed_${selectedAddress.id}`) || '')
        } catch { setDismissedSig('') }
    }, [selectedAddress?.id])

    const isDismissed = mismatchSig !== '' && dismissedSig === mismatchSig

    const handleDismissBanner = (e) => {
        e.stopPropagation()
        if (!selectedAddress?.id || !mismatchSig) return
        try {
            localStorage.setItem(`key_sync_dismissed_${selectedAddress.id}`, mismatchSig)
            setDismissedSig(mismatchSig)
        } catch { /* localStorage may be full or disabled */ }
    }

    // Fetch fresh data on mount to avoid showing stale localStorage cache
    useEffect(() => { refreshProducts?.() }, [])

    // Fetch real-time stock on mount & when address changes
    const loadStocks = async () => {
        if (!selectedAddress?.id) return
        const stocks = await fetchIngredientStocks(selectedAddress.id)
        setIngredientStocks(stocks)
    }
    useEffect(() => { loadStocks() }, [selectedAddress?.id])

    // Sync from context when address changes or data refreshes
    useEffect(() => { setIngredientCosts(contextCosts) }, [contextCosts])
    useEffect(() => { setIngredientUnits(contextUnits || {}) }, [contextUnits])

    // Build ingredient list from DB costs only
    const allIngredients = useMemo(() => {
        const keys = Object.keys(ingredientCosts)
        return keys.sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order))
    }, [ingredientCosts, selectedAddress?.ingredient_sort_order])

    async function saveCost(ingredient, newCost) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredient, newCost, selectedAddress?.id)
            setIngredientCosts(prev => ({ ...prev, [ingredient]: newCost }))
        } catch (err) {
            showError(err, 'Lưu giá nguyên liệu')
        } finally {
            setSaving(false)
            setEditingCost(prev => prev?.ingredient === ingredient ? null : prev)
        }
    }

    async function handleRenameIngredient(oldKey, newDisplayName) {
        const newKey = newDisplayName.trim().toLowerCase().replace(/\s+/g, '_')
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

    async function saveUnit(ingredient, newUnit, currentCost) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredient, currentCost, selectedAddress?.id, newUnit)
            setIngredientUnits(prev => ({ ...prev, [ingredient]: newUnit }))
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
            refreshProducts?.() // refresh configs to get the latest packSize/minStock into ProductContext
        } catch (err) {
            showError(err, 'Lưu cấu hình nâng cao')
        } finally {
            setSaving(false)
        }
    }

    async function handleCreateIngredient() {
        if (!newIngredientName.trim()) return
        const key = newIngredientName.trim().toLowerCase().replace(/\s+/g, '_')
        const unit = newIngredientUnit || 'đv'
        const cost = parseInt(newIngredientCost) || 0
        setSaving(true)
        try {
            await upsertIngredientCost(key, cost, selectedAddress?.id, unit)
            setIngredientCosts(prev => ({ ...prev, [key]: cost }))
            setIngredientUnits(prev => ({ ...prev, [key]: unit }))
            setNewIngredientName('')
            setNewIngredientUnit('')
            setNewIngredientCost('')
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
        const recipeCount = (contextRecipes || []).filter(r => r.ingredient === ingredient).length
        const label = ingredientLabel(ingredient)
        const warning = recipeCount > 0
            ? `"${label}" đang được dùng trong ${recipeCount} công thức. Xóa sẽ gỡ nó khỏi tất cả công thức liên quan. Tiếp tục?`
            : `Xóa nguyên liệu "${label}"?`
        if (!window.confirm(warning)) return
        setSaving(true)
        try {
            await deleteIngredientCost(ingredient, selectedAddress?.id)
            setIngredientCosts(prev => {
                const next = { ...prev }
                delete next[ingredient]
                return next
            })
            setIngredientUnits(prev => {
                const next = { ...prev }
                delete next[ingredient]
                return next
            })
        } catch (err) {
            showError(err, 'Xóa nguyên liệu')
        } finally {
            setSaving(false)
        }
    }

    // Sort mode handlers
    const enterSortMode = () => {
        setSortedIngredients([...allIngredients])
        setIsSorting(true)
        setSelectedSortIngredient(null)
    }

    const cancelSortMode = () => {
        setIsSorting(false)
        setSortedIngredients([])
        setSelectedSortIngredient(null)
    }

    const moveIngredient = (fromIndex, toIndex) => {
        if (toIndex < 0 || toIndex >= sortedIngredients.length) return
        const updated = [...sortedIngredients]
        const [moved] = updated.splice(fromIndex, 1)
        updated.splice(toIndex, 0, moved)
        setSortedIngredients(updated)
    }

    const saveSortOrderHandler = async () => {
        if (!selectedAddress?.id) return
        setSaving(true)
        try {
            await updateSortOrder(selectedAddress.id, sortedIngredients)
            setIsSorting(false)
            setSelectedSortIngredient(null)
        } catch (err) {
            showError(err, 'Lưu thứ tự nguyên liệu')
        } finally {
            setSaving(false)
        }
    }

    const showFooterCreateForm = !isSorting && canEdit
    const showFooterSortControls = isSorting

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />
            {/* Header */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate(location.state?.from || '/recipes')}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    {isSorting ? (
                        <div className="flex flex-row gap-2 flex-1">
                            <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                                <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Sắp xếp</span>
                                <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{sortedIngredients.length} loại</span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-row gap-2 flex-1">
                            <div className="flex-1 bg-primary/5 border border-primary/20 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                                <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Nguyên liệu</span>
                                <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{allIngredients.length} loại</span>
                            </div>
                        </div>
                    )}
                </div>

            </header>

            {/* Main content */}
            <main className="flex-1 overflow-y-auto px-4 py-4 pb-48 bg-bg">
                {/* Key-sync banner — shown when mismatches detected and not dismissed */}
                {canEdit && !isSorting && keyMismatches.hasIssues && !isDismissed && (
                    <div className="w-full mb-3 bg-warning/5 border border-warning/40 rounded-[14px] flex items-stretch overflow-hidden">
                        <button
                            onClick={() => setShowKeySync(true)}
                            className="flex-1 min-w-0 px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-warning/10 active:scale-[0.99] transition-all"
                        >
                            <AlertTriangle size={16} className="text-warning shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-text font-black text-[12px] leading-tight">
                                    {keyMismatches.labelCollisions.length > 0
                                        ? `${keyMismatches.labelCollisions.length} nguyên liệu chưa đồng bộ keys`
                                        : 'Phát hiện keys không khớp giữa công thức và tồn kho'}
                                </p>
                                <p className="text-text-secondary text-[10px] mt-0.5">Có thể gây sai Tiêu CT trong báo cáo hao hụt. Bấm để xem & sửa.</p>
                            </div>
                            <span className="text-warning text-[11px] font-black shrink-0">Xem →</span>
                        </button>
                        <button
                            onClick={handleDismissBanner}
                            className="px-3 flex items-center justify-center text-text-secondary hover:text-text hover:bg-warning/10 border-l border-warning/30 transition-colors"
                            title="Bỏ qua cảnh báo này"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                {/* ===== Sort mode (Nguyên liệu only) ===== */}
                {isSorting ? (
                    <div className="space-y-1.5">
                        {sortedIngredients.map((ingredient, index) => {
                            const isSelected = selectedSortIngredient === ingredient
                            return (
                                <div
                                    key={ingredient}
                                    onClick={() => setSelectedSortIngredient(ingredient)}
                                    className={`bg-surface border rounded-[14px] px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${isSelected ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:bg-surface-light'}`}
                                >
                                    <span className="text-text-dim text-[13px] font-bold w-6 text-center shrink-0">{index + 1}</span>
                                    <span className="flex-1 text-[14px] font-bold text-text truncate">{ingredientLabel(ingredient)}</span>
                                    {isSelected && (
                                        <div className="flex flex-row gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => moveIngredient(index, index - 1)}
                                                disabled={index === 0}
                                                className="w-10 h-8 flex items-center justify-center rounded-lg bg-surface-light border border-border/40 text-text-secondary text-[14px] hover:bg-border/40 active:scale-95 transition-all disabled:opacity-20 disabled:pointer-events-none"
                                            >
                                                ▲
                                            </button>
                                            <button
                                                onClick={() => moveIngredient(index, index + 1)}
                                                disabled={index === sortedIngredients.length - 1}
                                                className="w-10 h-8 flex items-center justify-center rounded-lg bg-surface-light border border-border/40 text-text-secondary text-[14px] hover:bg-border/40 active:scale-95 transition-all disabled:opacity-20 disabled:pointer-events-none"
                                            >
                                                ▼
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    /* ===== Tab Nguyên liệu ===== */
                    <div className="grid grid-cols-2 gap-2">
                        {allIngredients.map(ingredient => {
                            const stockRow = ingredientStocks.find(s => s.ingredient === ingredient)
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
                                    packSize={ingredientConfigs?.find(c => c.ingredient === ingredient)?.pack_size}
                                    packUnit={ingredientConfigs?.find(c => c.ingredient === ingredient)?.pack_unit}
                                    minStock={ingredientConfigs?.find(c => c.ingredient === ingredient)?.min_stock}
                                    onSaveAdvanced={handleSaveAdvanced}
                                    onConfigurePack={canEdit ? setPackConfigIngredient : null}
                                    stockData={stockRow}
                                    onRestock={() => setRestockIngredient(ingredient)}
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

            {/* Footer */}
            {(showFooterCreateForm || showFooterSortControls) && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-50">
                    {/* Floating sort button above footer (only on Nguyên liệu tab) */}
                    {showFooterCreateForm && (
                        <div className="flex justify-end px-4 mb-2 pointer-events-auto">
                            <button
                                onClick={enterSortMode}
                                className="bg-surface border border-border/60 rounded-[12px] px-4 py-2.5 flex items-center justify-center text-[13px] font-bold text-text-secondary hover:bg-surface-light active:scale-95 transition-all shadow-sm"
                            >
                                ↕ Sắp xếp
                            </button>
                        </div>
                    )}

                    {/* Footer Content */}
                    <div className="p-4 bg-surface border-t border-border/60 pointer-events-auto">
                        {showFooterSortControls ? (
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
                            <div className="flex flex-col gap-3">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Tên nguyên liệu..."
                                        value={newIngredientName}
                                        onChange={e => setNewIngredientName(e.target.value)}
                                        className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                                    />
                                    <div className="relative shrink-0 flex items-center w-[90px] bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                                        <input
                                            type="number"
                                            placeholder="Giá"
                                            value={newIngredientCost}
                                            onChange={e => setNewIngredientCost(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleCreateIngredient()
                                            }}
                                            className="w-full bg-transparent px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none z-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                    </div>
                                    <div className="relative shrink-0 flex items-center w-[80px] bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                                        <input
                                            type="text"
                                            placeholder="Đơn vị"
                                            value={newIngredientUnit}
                                            onChange={e => setNewIngredientUnit(e.target.value)}
                                            className="w-full bg-transparent px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none z-10"
                                        />
                                    </div>

                                </div>

                                <button
                                    onClick={handleCreateIngredient}
                                    disabled={!newIngredientName.trim() || saving}
                                    className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
                                >
                                    {saving ? 'Đang...' : 'Tạo nguyên liệu'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {saving && (
                <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                    <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                </div>
            )}

            {/* Restock Modal */}
            {restockIngredient && (
                <RestockModal
                    ingredient={restockIngredient}
                    unit={getIngredientUnit(restockIngredient, ingredientUnits[restockIngredient])}
                    packSize={ingredientConfigs?.find(c => c.ingredient === restockIngredient)?.pack_size}
                    packUnit={ingredientConfigs?.find(c => c.ingredient === restockIngredient)?.pack_unit}
                    onClose={() => setRestockIngredient(null)}
                    onConfirm={async ({ ingredient: ing, qty, totalCost }) => {
                        const result = await processIngredientRestock(
                            selectedAddress?.id,
                            ing,
                            qty,
                            totalCost,
                            profile?.name
                        )
                        // Refresh: stocks, costs, AND todayExpenses (RPC bypass handleAddExpense)
                        await Promise.all([
                            loadStocks(),
                            refreshProducts?.(),
                            refreshTodayExpenses?.()
                        ])
                        return result
                    }}
                />
            )}

            {/* Pack Config Modal — quy cách đóng gói */}
            {packConfigIngredient && (() => {
                const cfg = ingredientConfigs?.find(c => c.ingredient === packConfigIngredient) || {}
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
                            await handleSaveAdvanced(packConfigIngredient, {
                                packSize,
                                packUnit,
                                minStock: cfg.min_stock
                            })
                        }}
                    />
                )
            })()}

            {/* Key Sync Modal */}
            <KeySyncModal
                open={showKeySync}
                onClose={() => setShowKeySync(false)}
                mismatches={keyMismatches}
                recipes={liveRecipes}
                products={contextProducts || []}
                ingredientCosts={ingredientCosts}
                addressId={selectedAddress?.id}
                onComplete={async () => {
                    await Promise.all([loadStocks(), refreshProducts?.()])
                }}
            />
        </div>
    )
}
