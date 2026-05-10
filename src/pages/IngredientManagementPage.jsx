import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { usePOS } from '../contexts/POSContext'

import { upsertIngredientCost, deleteIngredientCost, renameIngredient, fetchIngredientStocks, processIngredientRestock, fetchRefillExpensesInRange, adjustIngredientStock } from '../services/orderService'
import { sortIngredients, ingredientLabel, getIngredientUnit } from '../components/common/recipeUtils'
import IngredientCostItem from '../components/IngredientManagementPage/IngredientCostItem'
import RestockModal from '../components/IngredientManagementPage/RestockModal'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import { formatVND } from '../utils'
import { getDateRange } from '../components/DailyReportPage/ReportHeader'

export default function IngredientManagementPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { ingredientCosts: contextCosts, ingredientUnits: contextUnits, recipes: contextRecipes, ingredientConfigs, refreshProducts } = useProducts()
    const { selectedAddress, updateSortOrder } = useAddress()
    const { isManager, isAdmin, profile } = useAuth()
    const { todayExpenses, handleDeleteExpense, isLoadingHistory, handleLoadHistory, refreshTodayExpenses } = usePOS()
    const { toast, showError } = useToast()
    const canEdit = isManager || isAdmin

    // Top-level tab: 'list' (Nguyên liệu) | 'refill' (Đi chợ)
    const [activeTab, setActiveTab] = useState(location.state?.tab === 'refill' ? 'refill' : 'list')

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

    // Refill (Đi chợ) tab state
    // scope: 'day' (today) | 'week' (this week) | 'month' (current or past month via monthOffset)
    const initialScope = ['day', 'week', 'month'].includes(location.state?.refillScope)
        ? location.state.refillScope
        : 'month'
    const [scope, setScope] = useState(initialScope)
    // Offset áp dụng cho mọi scope: day=offset days, week=offset weeks, month=offset months.
    const [offset, setOffset] = useState(0)
    const [refills, setRefills] = useState([])
    const [isLoadingRefills, setIsLoadingRefills] = useState(false)
    const [deletingId, setDeletingId] = useState(null)
    // In-memory cache by `${addressId}|${start}|${end}` — survives across scope/month toggles
    // within the same component lifetime (auto-cleared on navigation away & back).
    const refillCacheRef = useRef(new Map())

    // Fetch fresh data on mount to avoid showing stale localStorage cache
    useEffect(() => { refreshProducts?.() }, [])

    // Load today's expenses if not loaded yet (needed for scope=day — reuse from POSContext, no extra query)
    useEffect(() => {
        if (activeTab === 'refill' && scope === 'day' && offset === 0 && !todayExpenses?.length && !isLoadingHistory) {
            handleLoadHistory()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, scope, offset])

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

    // ---- Refill (Đi chợ) data ----
    // Date range follow scope + offset. Lưu ý: getDateRange('day', offset) không dùng offset,
    // nên compute manually cho 'day'. 'week' và 'month' tận dụng helper sẵn có.
    const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
        const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        if (scope === 'day') {
            const target = new Date()
            target.setDate(target.getDate() + offset)
            const start = new Date(target); start.setHours(0, 0, 0, 0)
            const end = new Date(target); end.setHours(23, 59, 59, 999)
            const label = offset === 0
                ? `${fmt(start)}/${start.getFullYear()}`
                : `${fmt(start)}/${start.getFullYear()}`
            return { rangeStart: start, rangeEnd: end, rangeLabel: label }
        }
        const { start, end } = getDateRange(scope, offset)
        // week và month đều dùng range format DD/MM – DD/MM (đồng bộ với RangeReport).
        // month offset=0: 01/M – ngày hiện tại; month offset<0: 01/M – cuối-tháng-M.
        const label = `${fmt(start)} – ${fmt(end)}`
        return { rangeStart: start, rangeEnd: end, rangeLabel: label }
    }, [scope, offset])

    const canGoForward = offset < 0

    // Reuse todayExpenses for scope=day offset=0 → 0 query thêm.
    // Other scopes: fetch with cache (key by address + range bounds).
    useEffect(() => {
        if (activeTab !== 'refill' || !selectedAddress?.id) return

        if (scope === 'day' && offset === 0) {
            const today = (todayExpenses || [])
                .filter(e => e.is_refill)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            setRefills(today)
            return
        }

        const fromIso = rangeStart.toISOString()
        const toIso = rangeEnd.toISOString()
        const cacheKey = `${selectedAddress.id}|${fromIso}|${toIso}`
        const cached = refillCacheRef.current.get(cacheKey)
        if (cached) {
            setRefills(cached)
            return
        }
        setIsLoadingRefills(true)
        fetchRefillExpensesInRange(selectedAddress.id, fromIso, toIso)
            .then(data => {
                refillCacheRef.current.set(cacheKey, data)
                setRefills(data)
            })
            .finally(() => setIsLoadingRefills(false))
    }, [activeTab, scope, offset, selectedAddress?.id, rangeStart, rangeEnd, todayExpenses])

    const refillsByIngredient = useMemo(() => {
        const map = {}
        refills.forEach(e => {
            const ing = e.metadata?.ingredient
            if (!ing) return
            if (!map[ing]) map[ing] = { ingredient: ing, count: 0, totalQty: 0, totalSpent: 0 }
            map[ing].count += 1
            map[ing].totalQty += Number(e.metadata?.qty) || 0
            map[ing].totalSpent += Number(e.amount) || 0
        })
        return Object.values(map).sort((a, b) => b.totalSpent - a.totalSpent)
    }, [refills])

    const rangeTotal = useMemo(
        () => refills.reduce((s, e) => s + (Number(e.amount) || 0), 0),
        [refills]
    )

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
            await renameIngredient(oldKey, newKey)
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
            refillCacheRef.current.clear()
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

    const showFooterCreateForm = !isSorting && activeTab === 'list' && canEdit
    const showFooterSortControls = isSorting && activeTab === 'list'

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
                            <div
                                onClick={() => setActiveTab('list')}
                                className={`flex-1 border shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${activeTab === 'list'
                                    ? 'bg-primary/5 border-primary/20'
                                    : 'bg-surface-light border-border/60 opacity-60 hover:opacity-100'
                                    }`}
                            >
                                <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Nguyên liệu</span>
                                <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{allIngredients.length} loại</span>
                            </div>
                            <div
                                onClick={() => setActiveTab('refill')}
                                className={`flex-1 border shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${activeTab === 'refill'
                                    ? 'bg-primary/10 border-primary/30'
                                    : 'bg-surface-light border-border/60 opacity-60 hover:opacity-100'
                                    }`}
                            >
                                <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Nhật ký</span>
                                {/* <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">Biến động kho</span> */}
                            </div>
                        </div>
                    )}
                </div>

                {/* Đi chợ: range selector dưới tab strip */}
                {!isSorting && activeTab === 'refill' && (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between bg-surface-light border border-border/60 rounded-[12px] px-1 py-1">
                            <button
                                onClick={() => setOffset(p => p - 1)}
                                className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all"
                            >
                                <ChevronLeft size={18} />
                            </button>
                            <span className="text-[13px] font-black text-text capitalize">{rangeLabel}</span>
                            <button
                                onClick={() => canGoForward && setOffset(p => p + 1)}
                                disabled={!canGoForward}
                                className={`w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all disabled:opacity-20`}
                            >
                                <ChevronRight size={18} />
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { key: 'week', label: 'Tuần này' },
                                { key: 'day', label: 'Hôm nay' },
                                { key: 'month', label: 'Tháng này' }
                            ].map(s => (
                                <button
                                    key={s.key}
                                    onClick={() => { setScope(s.key); setOffset(0) }}
                                    className={`py-2 rounded-[12px] text-[12px] font-black border transition-colors ${scope === s.key
                                        ? 'bg-primary/10 border-primary/40 text-primary'
                                        : 'bg-surface-light border-border/60 text-text-secondary hover:bg-border/30'
                                        }`}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </header>

            {/* Main content */}
            <main className="flex-1 overflow-y-auto px-4 py-4 pb-48 bg-bg">
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
                ) : activeTab === 'list' ? (
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
                ) : (
                    /* ===== Tab Đi chợ ===== (scope/offset đã ở trên header) */
                    <div className="flex flex-col gap-3">
                        <div className="bg-surface rounded-[16px] border border-border/60 p-4 grid grid-cols-2 gap-3">
                            <div className="flex flex-col items-center">
                                <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">Cập nhật</span>
                                <span className="text-[16px] font-black text-text tabular-nums mt-1">{refills.length} lần</span>
                            </div>

                            <div className="flex flex-col items-center">
                                <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">Tổng cộng</span>
                                <span className="text-[16px] font-black text-primary tabular-nums mt-1">{formatVND(rangeTotal)}</span>
                            </div>

                        </div>

                        {isLoadingRefills || (scope === 'day' && offset === 0 && isLoadingHistory && refills.length === 0) ? (
                            <div className="flex flex-col gap-2 animate-pulse">
                                {[1, 2, 3].map(i => <div key={i} className="bg-surface-light rounded-[14px] h-16" />)}
                            </div>
                        ) : refillsByIngredient.length === 0 ? (
                            <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                                Chưa có phiếu nhập nguyên vật liệu nào trong {rangeLabel}.
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {refillsByIngredient.map(row => {
                                    const unit = getIngredientUnit(row.ingredient, ingredientUnits[row.ingredient])
                                    return (
                                        <div
                                            key={row.ingredient}
                                            onClick={() => navigate(`/ingredients/${row.ingredient}`)}
                                            className="bg-surface border border-border/60 rounded-[14px] p-3 flex items-center gap-3 cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
                                        >
                                            <div className="flex flex-col flex-1 min-w-0">
                                                <span className="text-[14px] font-black text-text leading-tight truncate">
                                                    {ingredientLabel(row.ingredient)}
                                                </span>
                                                <span className="text-[11px] font-bold text-text-secondary tabular-nums">
                                                    {row.count} lần · {Math.round(row.totalQty * 10) / 10} {unit}
                                                </span>
                                            </div>
                                            <span className="text-[14px] font-black text-primary tabular-nums shrink-0">
                                                {formatVND(row.totalSpent)}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
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
                    onClose={() => setRestockIngredient(null)}
                    onConfirm={async ({ ingredient: ing, qty, totalCost }) => {
                        const result = await processIngredientRestock(
                            selectedAddress?.id,
                            ing,
                            qty,
                            totalCost,
                            profile?.name
                        )
                        // Invalidate cached refill ranges (mới có expense → các range chứa hôm nay đều phải refetch)
                        refillCacheRef.current.clear()
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
        </div>
    )
}
