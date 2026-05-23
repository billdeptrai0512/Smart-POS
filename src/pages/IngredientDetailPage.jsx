import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import {
    fetchIngredientRestockHistory, fetchIngredientStocks,
    deleteIngredientCost, upsertIngredientCost,
} from '../services/orderService'
import {
    ingredientLabel, getIngredientUnit,
    INGREDIENT_CATEGORIES, normalizeIngredientCategory,
} from '../components/common/recipeUtils'
import { formatVND } from '../utils'
import { formatPackedQty } from '../utils/inventory'
import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import PackConfigModal from '../components/IngredientManagementPage/PackConfigModal'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'

export default function IngredientDetailPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { ingredientKey } = useParams()
    const { ingredientCosts, ingredientUnits, ingredientConfigs, refreshProducts } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showError } = useToast()

    const [viewMode, setViewMode] = useState('details')
    const [history, setHistory] = useState([])
    const [loading, setLoading] = useState(true)
    const [stockData, setStockData] = useState(null)
    const [saving, setSaving] = useState(false)
    const [packModalOpen, setPackModalOpen] = useState(false)
    const [editingCost, setEditingCost] = useState(false)
    const [costInput, setCostInput] = useState('')

    // Month navigation (Nhật ký tab)
    const [monthOffset, setMonthOffset] = useState(0)
    const targetMonth = useMemo(() => {
        const d = new Date()
        d.setMonth(d.getMonth() + monthOffset)
        return d
    }, [monthOffset])

    const monthLabel = targetMonth.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })

    const { fromDate, toDate } = useMemo(() => {
        const from = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1)
        const to = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59)
        return { fromDate: from.toISOString(), toDate: to.toISOString() }
    }, [targetMonth])

    const config = useMemo(
        () => (ingredientConfigs || []).find(c => c.ingredient === ingredientKey) || {},
        [ingredientConfigs, ingredientKey]
    )
    const unit = getIngredientUnit(ingredientKey, ingredientUnits[ingredientKey])
    const cost = ingredientCosts[ingredientKey] || 0
    const category = normalizeIngredientCategory(config.category)
    const packSize = config.pack_size || null
    const packUnit = config.pack_unit || null
    const minStock = config.min_stock || null
    const currentStock = stockData?.current_stock ?? null

    // Load history & stock
    useEffect(() => {
        if (!selectedAddress?.id || !ingredientKey) return
        setLoading(true)
        Promise.all([
            fetchIngredientRestockHistory(selectedAddress.id, ingredientKey, fromDate, toDate),
            fetchIngredientStocks(selectedAddress.id)
        ]).then(([hist, stocks]) => {
            setHistory(hist)
            setStockData(stocks.find(s => s.ingredient === ingredientKey))
        }).finally(() => setLoading(false))
    }, [selectedAddress?.id, ingredientKey, fromDate, toDate])

    const summary = useMemo(() => {
        let totalSpent = 0, totalQty = 0, qtyForAvg = 0
        history.forEach(e => {
            totalSpent += e.amount || 0
            const qty = e.metadata?.qty || 0
            totalQty += qty
            if (!e.metadata?.adjustment) qtyForAvg += qty
        })
        const avgPrice = qtyForAvg > 0 ? Math.round(totalSpent / qtyForAvg) : 0
        return { totalSpent, totalQty, avgPrice, count: history.length }
    }, [history])

    // ── Handlers ────────────────────────────────────────────────────────────
    async function saveCategory(newCat) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, { category: newCat })
            refreshProducts?.()
        } catch (err) {
            showError(err, 'Lưu nhóm nguyên liệu')
        } finally { setSaving(false) }
    }

    async function savePackConfig({ packSize: ps, packUnit: pu }) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, {
                packSize: ps, packUnit: pu, minStock: config.min_stock,
            })
            refreshProducts?.()
        } catch (err) {
            showError(err, 'Lưu quy cách đóng gói')
        } finally { setSaving(false) }
    }

    async function saveCost() {
        const newCost = parseInt(costInput) || 0
        setEditingCost(false)
        if (newCost === cost) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, newCost, selectedAddress?.id, unit, { category: config.category })
            refreshProducts?.()
        } catch (err) {
            showError(err, 'Lưu giá vốn')
        } finally { setSaving(false) }
    }

    async function handleDelete() {
        const label = ingredientLabel(ingredientKey)
        if (!window.confirm(`Xóa nguyên liệu "${label}"? Hành động này sẽ gỡ nó khỏi tất cả công thức liên quan.`)) return
        try {
            await deleteIngredientCost(ingredientKey, selectedAddress?.id)
            refreshProducts?.()
            navigate('/ingredients')
        } catch (err) {
            showError(err, 'Xóa nguyên liệu')
        }
    }

    const titleLabel = ingredientLabel(ingredientKey)
    const stockSubtitle = currentStock !== null ? `${Math.round(currentStock * 10) / 10} ${unit}` : '—'

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <IngredientDetailHeader
                title={titleLabel}
                subtitle={`Tồn: ${stockSubtitle}`}
                onBack={() => navigate(location.state?.from || '/ingredients')}
                onDelete={canEdit ? handleDelete : null}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 bg-bg space-y-4">
                {viewMode === 'details' ? (
                    <DetailsTab
                        ingredientKey={ingredientKey}
                        unit={unit}
                        cost={cost}
                        category={category}
                        packSize={packSize}
                        packUnit={packUnit}
                        minStock={minStock}
                        currentStock={currentStock}
                        canEdit={canEdit}
                        saving={saving}
                        editingCost={editingCost}
                        costInput={costInput}
                        onStartEditCost={() => { setCostInput(String(cost)); setEditingCost(true) }}
                        onCostInputChange={setCostInput}
                        onSaveCost={saveCost}
                        onCancelCost={() => setEditingCost(false)}
                        onChangeCategory={saveCategory}
                        onConfigurePack={() => setPackModalOpen(true)}
                    />
                ) : (
                    <HistoryTab
                        loading={loading}
                        summary={summary}
                        history={history}
                        unit={unit}
                        monthLabel={monthLabel}
                        monthOffset={monthOffset}
                        onMonthChange={setMonthOffset}
                    />
                )}
            </main>

            {packModalOpen && (
                <PackConfigModal
                    open={true}
                    onClose={() => setPackModalOpen(false)}
                    ingredientLabel={titleLabel}
                    baseUnit={unit}
                    currentPackSize={packSize}
                    currentPackUnit={packUnit}
                    onSave={async ({ packSize: ps, packUnit: pu }) => {
                        await savePackConfig({ packSize: ps, packUnit: pu })
                        setPackModalOpen(false)
                    }}
                />
            )}

            {saving && (
                <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                    <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}

// ─── Chi tiết tab ────────────────────────────────────────────────────────────
function DetailsTab({
    unit, cost, category, packSize, packUnit, minStock, currentStock,
    canEdit, saving,
    editingCost, costInput,
    onStartEditCost, onCostInputChange, onSaveCost, onCancelCost,
    onChangeCategory, onConfigurePack,
}) {
    const hasPack = !!(packSize && packUnit)
    return (
        <div className="flex flex-col gap-3">
            <section className="bg-surface rounded-[18px] border border-border/60 p-4 flex flex-col divide-y divide-border/40">
                <Row label="Tồn kho">
                    <div className="flex flex-col items-end gap-0.5 leading-tight">
                        <span className="text-[14px] font-black text-text tabular-nums">
                            {currentStock !== null ? Math.round(currentStock * 10) / 10 : '—'}
                            <span className="text-text-dim font-medium ml-1">{unit}</span>
                        </span>
                        {hasPack && currentStock !== null && currentStock >= packSize && (
                            <span className="text-[11px] font-medium text-text-dim tabular-nums">
                                = {formatPackedQty(currentStock, packSize, packUnit, unit, { compact: true })}
                            </span>
                        )}
                    </div>
                </Row>
                <Row label="Giá vốn">
                    {canEdit && editingCost ? (
                        <input
                            type="number"
                            autoFocus
                            value={costInput}
                            onChange={e => onCostInputChange(e.target.value)}
                            onBlur={onSaveCost}
                            onKeyDown={e => {
                                if (e.key === 'Enter') onSaveCost()
                                if (e.key === 'Escape') onCancelCost()
                            }}
                            className="w-28 bg-primary/10 border border-primary/30 rounded-md px-2 py-0.5 text-[14px] font-bold text-primary text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                    ) : (
                        <button
                            onClick={canEdit ? onStartEditCost : undefined}
                            className={`text-[14px] font-bold text-text tabular-nums ${canEdit ? 'cursor-pointer hover:text-primary' : ''}`}
                        >
                            {formatVND(cost)}<span className="text-text-dim font-medium">/{unit}</span>
                        </button>
                    )}
                </Row>
                <Row label="Nhóm">
                    {canEdit ? (
                        <select
                            value={category}
                            disabled={saving}
                            onChange={e => onChangeCategory(e.target.value)}
                            className="bg-transparent border-0 text-[13px] font-bold text-text focus:outline-none cursor-pointer"
                        >
                            {INGREDIENT_CATEGORIES.map(c => (
                                <option key={c.key} value={c.key}>{c.label}</option>
                            ))}
                        </select>
                    ) : (
                        <span className="text-[13px] font-bold text-text">
                            {INGREDIENT_CATEGORIES.find(c => c.key === category)?.label || 'Nguyên liệu chính'}
                        </span>
                    )}
                </Row>
                <Row label="Quy đổi">
                    {hasPack ? (
                        <button
                            onClick={canEdit ? onConfigurePack : undefined}
                            disabled={!canEdit}
                            className={`flex items-center gap-2 text-[13px] font-bold text-text tabular-nums ${canEdit ? 'hover:text-primary cursor-pointer' : 'cursor-default'}`}
                        >
                            <span>1 {packUnit} = {packSize} {unit}</span>
                            {canEdit && <Pencil size={12} className="text-text-dim" />}
                        </button>
                    ) : canEdit ? (
                        <button
                            onClick={onConfigurePack}
                            className="text-[13px] font-bold text-primary hover:underline"
                        >
                            + Thêm quy cách
                        </button>
                    ) : (
                        <span className="text-[13px] text-text-dim italic">Chưa thiết lập</span>
                    )}
                </Row>
                {minStock != null && (
                    <Row label="Tồn tối thiểu">
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {minStock} {unit}
                        </span>
                    </Row>
                )}
            </section>
        </div>
    )
}

function Row({ label, children }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="text-[12px] font-bold text-text-secondary">{label}</span>
            <div>{children}</div>
        </div>
    )
}

// ─── Nhật ký tab ─────────────────────────────────────────────────────────────
function HistoryTab({ loading, summary, history, unit, monthLabel, monthOffset, onMonthChange }) {
    return (
        <>
            <div className="flex items-center justify-between bg-surface-light rounded-[12px] px-1 py-1">
                <button
                    onClick={() => onMonthChange(monthOffset - 1)}
                    className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all"
                >
                    <ChevronLeft size={18} />
                </button>
                <span className="text-[13px] font-black text-text capitalize">{monthLabel}</span>
                <button
                    onClick={() => onMonthChange(Math.min(0, monthOffset + 1))}
                    disabled={monthOffset >= 0}
                    className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all disabled:opacity-20"
                >
                    <ChevronRight size={18} />
                </button>
            </div>

            {!loading && summary.count > 0 && (
                <div className="bg-surface rounded-[16px] border border-border/60 p-4 grid grid-cols-3 gap-3">
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">Tổng chi</span>
                        <span className="text-[16px] font-black text-danger tabular-nums mt-1">{formatVND(summary.totalSpent)}</span>
                    </div>
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">Tổng nhập</span>
                        <span className="text-[16px] font-black text-text tabular-nums mt-1">{summary.totalQty} {unit}</span>
                    </div>
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">TB/đơn vị</span>
                        <span className="text-[16px] font-black text-primary tabular-nums mt-1">{formatVND(summary.avgPrice)}</span>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex flex-col gap-3 animate-pulse">
                    {[1, 2, 3].map(i => <div key={i} className="bg-surface-light rounded-[14px] h-16" />)}
                </div>
            ) : history.length === 0 ? (
                <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-[14px] border border-border/40">
                    Chưa có lịch sử nhập kho trong {monthLabel}.
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {history.map(entry => {
                        const d = new Date(entry.created_at)
                        const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
                        const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                        const qty = entry.metadata?.qty || 0
                        const unitPrice = qty > 0 ? Math.round(entry.amount / qty) : 0
                        return (
                            <div key={entry.id} className="bg-surface rounded-[14px] border border-border/60 p-3 flex items-center gap-3">
                                <div className="flex flex-col items-center shrink-0 w-12">
                                    <span className="text-[13px] font-black text-text tabular-nums">{dateStr}</span>
                                    <span className="text-[10px] font-bold text-text-dim tabular-nums">{timeStr}</span>
                                </div>
                                <div className="flex flex-col flex-1 min-w-0">
                                    <span className={`text-[13px] font-bold ${qty > 0 ? 'text-success' : qty < 0 ? 'text-danger' : 'text-text'}`}>
                                        {qty > 0 ? '+' : ''}{qty} {unit}
                                    </span>
                                    <span className="text-[11px] text-text-secondary truncate">
                                        {entry.staff_name || 'Không rõ'} · {entry.metadata?.adjustment ? 'Hiệu chỉnh' : `${formatVND(unitPrice)}/${unit}`}
                                    </span>
                                </div>
                                <span className={`text-[14px] font-black tabular-nums shrink-0 ${entry.metadata?.adjustment ? 'text-text-secondary' : 'text-danger'}`}>
                                    {entry.metadata?.adjustment ? '0đ' : `-${formatVND(entry.amount)}`}
                                </span>
                            </div>
                        )
                    })}
                </div>
            )}
        </>
    )
}
