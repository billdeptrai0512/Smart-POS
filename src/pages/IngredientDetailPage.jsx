import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import {
    fetchIngredientRestockHistory, fetchIngredientStocks,
    deleteIngredientCost, upsertIngredientCost, renameIngredient,
    adjustIngredientStock, recordInvoicePayment,
} from '../services/orderService'
import { usePOS } from '../contexts/POSContext'

// Same canonicalisation IngredientManagementPage uses: lower-case, snake_case.
const normalizeKey = (raw) => raw.trim().toLowerCase().replace(/\s+/g, '_')
import {
    ingredientLabel, getIngredientUnit,
    INGREDIENT_CATEGORIES, normalizeIngredientCategory,
} from '../utils/ingredients'
import { formatVND, formatVNDInput, parseVNDInput } from '../utils'
import { formatPackedQty } from '../utils/inventory'
import MoneyInput from '../components/common/MoneyInput'
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
    const { isManager, isAdmin, profile } = useAuth()
    const { refreshTodayExpenses } = usePOS()
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
    const [editingMinStock, setEditingMinStock] = useState(false)
    const [minStockInput, setMinStockInput] = useState('')
    const [editingName, setEditingName] = useState(false)
    const [nameInput, setNameInput] = useState('')
    const [editingStock, setEditingStock] = useState(false)
    const [stockInput, setStockInput] = useState('')
    const [editingUnit, setEditingUnit] = useState(false)
    const [unitInput, setUnitInput] = useState('')

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
        let totalSpent = 0, totalQty = 0, qtyForAvg = 0, totalOwing = 0, totalPaidInMonth = 0
        // `fromDate` / `toDate` xác định cửa sổ tháng đang xem — payments có paid_at
        // trong cửa sổ này được tính vào "Đã trả" của tháng. Một payment có thể trả
        // cho invoice tháng khác, nên paid không = invoice.amount khớp 1-1.
        const monthStartMs = new Date(fromDate).getTime()
        const monthEndMs = new Date(toDate).getTime()
        history.forEach(e => {
            totalSpent += e.amount || 0
            const qty = e.metadata?.qty || 0
            totalQty += qty
            if (!e.metadata?.adjustment) qtyForAvg += qty
            const paid = (e.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
            totalOwing += Math.max(0, (e.amount || 0) - paid)
            for (const p of e.payments || []) {
                const t = new Date(p.paid_at).getTime()
                if (t >= monthStartMs && t <= monthEndMs) totalPaidInMonth += p.amount || 0
            }
        })
        const avgPrice = qtyForAvg > 0 ? Math.round(totalSpent / qtyForAvg) : 0
        return { totalSpent, totalQty, avgPrice, totalOwing, totalPaidInMonth, count: history.length }
    }, [history, fromDate, toDate])

    // Payment sheet state — open with selected invoice; null = closed.
    const [paymentInvoice, setPaymentInvoice] = useState(null)

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
        const newCost = parseVNDInput(costInput)
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

    async function reloadStock() {
        if (!selectedAddress?.id) return
        const stocks = await fetchIngredientStocks(selectedAddress.id)
        setStockData(stocks.find(s => s.ingredient === ingredientKey))
    }

    async function reloadHistory() {
        if (!selectedAddress?.id) return
        const hist = await fetchIngredientRestockHistory(selectedAddress.id, ingredientKey, fromDate, toDate)
        setHistory(hist)
    }

    async function handleRecordPayment({ amount, paymentMethod, paidAt }) {
        if (!paymentInvoice) return
        setSaving(true)
        try {
            await recordInvoicePayment(
                selectedAddress?.id,
                paymentInvoice.id,
                amount,
                paymentMethod,
                profile?.name,
                paidAt,
            )
            await Promise.all([reloadHistory(), refreshTodayExpenses?.()])
            setPaymentInvoice(null)
        } catch (err) {
            showError(err, 'Ghi nhận thanh toán')
        } finally { setSaving(false) }
    }

    async function saveStock() {
        const newTotal = Number(stockInput)
        setEditingStock(false)
        if (!Number.isFinite(newTotal) || newTotal < 0) return
        const current = currentStock || 0
        const delta = newTotal - current
        if (delta === 0) return
        setSaving(true)
        try {
            await adjustIngredientStock(selectedAddress?.id, ingredientKey, delta, profile?.name)
            await Promise.all([reloadStock(), refreshTodayExpenses?.()])
        } catch (err) {
            showError(err, 'Hiệu chỉnh tồn')
        } finally { setSaving(false) }
    }

    async function saveUnit() {
        const newUnit = (unitInput || '').trim() || 'đv'
        setEditingUnit(false)
        if (newUnit === unit) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, newUnit, { category: config.category })
            refreshProducts?.()
        } catch (err) {
            showError(err, 'Lưu đơn vị')
        } finally { setSaving(false) }
    }

    async function saveName() {
        const newKey = normalizeKey(nameInput || '')
        setEditingName(false)
        if (!newKey || newKey === ingredientKey) return
        setSaving(true)
        try {
            await renameIngredient(ingredientKey, newKey, selectedAddress?.id)
            refreshProducts?.()
            // URL param drives every fetch on this page — repoint at the new key
            // so the page keeps showing the same ingredient under its new name.
            navigate(`/ingredients/${newKey}`, { replace: true, state: location.state })
        } catch (err) {
            showError(err, 'Đổi tên nguyên liệu')
        } finally { setSaving(false) }
    }

    async function saveMinStock() {
        const raw = String(minStockInput).replace(/[^\d]/g, '')
        const newMin = raw ? Number(raw) : 0
        setEditingMinStock(false)
        if (newMin === (minStock || 0)) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, {
                category: config.category,
                packSize: config.pack_size,
                packUnit: config.pack_unit,
                minStock: newMin,
            })
            refreshProducts?.()
        } catch (err) {
            showError(err, 'Lưu tồn tối thiểu')
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
                onBack={() => navigate(location.state?.from || '/ingredients', { state: { viewMode: location.state?.viewMode } })}
                onDelete={canEdit ? handleDelete : null}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 bg-bg space-y-4">
                {viewMode === 'details' ? (
                    <DetailsTab
                        ingredientKey={ingredientKey}
                        nameLabel={titleLabel}
                        unit={unit}
                        cost={cost}
                        category={category}
                        packSize={packSize}
                        packUnit={packUnit}
                        minStock={minStock}
                        currentStock={currentStock}
                        canEdit={canEdit}
                        saving={saving}
                        editingName={editingName}
                        nameInput={nameInput}
                        onStartEditName={() => { setNameInput(titleLabel); setEditingName(true) }}
                        onNameInputChange={setNameInput}
                        onSaveName={saveName}
                        onCancelName={() => setEditingName(false)}
                        editingStock={editingStock}
                        stockInput={stockInput}
                        onStartEditStock={() => {
                            const v = currentStock !== null ? Math.round(currentStock * 10) / 10 : 0
                            setStockInput(String(v))
                            setEditingStock(true)
                        }}
                        onStockInputChange={setStockInput}
                        onSaveStock={saveStock}
                        onCancelStock={() => setEditingStock(false)}
                        editingUnit={editingUnit}
                        unitInput={unitInput}
                        onStartEditUnit={() => { setUnitInput(unit); setEditingUnit(true) }}
                        onUnitInputChange={setUnitInput}
                        onSaveUnit={saveUnit}
                        onCancelUnit={() => setEditingUnit(false)}
                        editingCost={editingCost}
                        costInput={costInput}
                        onStartEditCost={() => { setCostInput(formatVNDInput(cost)); setEditingCost(true) }}
                        onCostInputChange={setCostInput}
                        onSaveCost={saveCost}
                        onCancelCost={() => setEditingCost(false)}
                        editingMinStock={editingMinStock}
                        minStockInput={minStockInput}
                        onStartEditMinStock={() => {
                            // Soft sync: first-time setup with a pack config pre-fills the
                            // pack size, since "min = 1 pack" matches how owners reason about
                            // restock thresholds. User can overwrite freely before saving.
                            const seed = minStock != null
                                ? String(minStock)
                                : (packSize ? String(packSize) : '')
                            setMinStockInput(seed)
                            setEditingMinStock(true)
                        }}
                        onMinStockInputChange={setMinStockInput}
                        onSaveMinStock={saveMinStock}
                        onCancelMinStock={() => setEditingMinStock(false)}
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
                        onOpenPayment={canEdit ? setPaymentInvoice : null}
                    />
                )}
            </main>

            {paymentInvoice && (
                <PaymentSheet
                    invoice={paymentInvoice}
                    saving={saving}
                    onClose={() => setPaymentInvoice(null)}
                    onConfirm={handleRecordPayment}
                />
            )}

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
    nameLabel, unit, cost, category, packSize, packUnit, minStock, currentStock,
    canEdit, saving,
    editingName, nameInput,
    onStartEditName, onNameInputChange, onSaveName, onCancelName,
    editingStock, stockInput,
    onStartEditStock, onStockInputChange, onSaveStock, onCancelStock,
    editingUnit, unitInput,
    onStartEditUnit, onUnitInputChange, onSaveUnit, onCancelUnit,
    editingCost, costInput,
    onStartEditCost, onCostInputChange, onSaveCost, onCancelCost,
    editingMinStock, minStockInput,
    onStartEditMinStock, onMinStockInputChange, onSaveMinStock, onCancelMinStock,
    onChangeCategory, onConfigurePack,
}) {
    const hasPack = !!(packSize && packUnit)
    return (
        <div className="flex flex-col gap-3">
            <section className="bg-surface rounded-[18px] border border-border/60 p-4 flex flex-col divide-y divide-border/40">
                <Row label="Tên">
                    {editingName && canEdit ? (
                        <input
                            autoFocus
                            type="text"
                            value={nameInput}
                            onChange={e => onNameInputChange(e.target.value)}
                            onBlur={onSaveName}
                            onKeyDown={e => {
                                if (e.key === 'Enter') onSaveName()
                                if (e.key === 'Escape') onCancelName()
                            }}
                            className="w-40 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right focus:outline-none focus:border-primary/50"
                        />
                    ) : (
                        <button
                            onClick={canEdit ? onStartEditName : undefined}
                            className={`text-[13px] font-bold text-text text-right ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                        >
                            {nameLabel}
                        </button>
                    )}
                </Row>
                <Row label="Tồn kho">
                    {editingStock && canEdit ? (
                        <div className="flex items-center gap-1">
                            <input
                                autoFocus
                                type="text"
                                inputMode="decimal"
                                value={stockInput}
                                onChange={e => onStockInputChange(e.target.value.replace(/[^\d.]/g, ''))}
                                onBlur={onSaveStock}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') onSaveStock()
                                    if (e.key === 'Escape') onCancelStock()
                                }}
                                className="w-24 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[14px] font-black text-text text-right tabular-nums focus:outline-none focus:border-primary/50"
                            />
                            <span className="text-[12px] text-text-dim font-medium">{unit}</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-end gap-0.5 leading-tight">
                            <button
                                onClick={canEdit ? onStartEditStock : undefined}
                                className={`text-[14px] font-black text-text tabular-nums ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                            >
                                {currentStock !== null ? Math.round(currentStock * 10) / 10 : '—'}
                                <span className="text-text-dim font-medium ml-1">{unit}</span>
                            </button>
                            {hasPack && currentStock !== null && currentStock >= packSize && (
                                <span className="text-[11px] font-medium text-text-dim tabular-nums">
                                    = {formatPackedQty(currentStock, packSize, packUnit, unit, { compact: true })}
                                </span>
                            )}
                        </div>
                    )}
                </Row>
                <Row label="Đơn vị">
                    {editingUnit && canEdit ? (
                        <input
                            autoFocus
                            type="text"
                            value={unitInput}
                            onChange={e => onUnitInputChange(e.target.value)}
                            onBlur={onSaveUnit}
                            onKeyDown={e => {
                                if (e.key === 'Enter') onSaveUnit()
                                if (e.key === 'Escape') onCancelUnit()
                            }}
                            className="w-20 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right focus:outline-none focus:border-primary/50"
                        />
                    ) : (
                        <button
                            onClick={canEdit ? onStartEditUnit : undefined}
                            className={`text-[13px] font-bold text-text ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                        >
                            {unit}
                        </button>
                    )}
                </Row>
                <Row label="Giá vốn">
                    {canEdit && editingCost ? (
                        <div className="flex items-center gap-1">
                            <MoneyInput
                                value={costInput}
                                onChange={onCostInputChange}
                                onBlur={onSaveCost}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') onSaveCost()
                                    if (e.key === 'Escape') onCancelCost()
                                }}
                                autoFocus
                                size="sm"
                                className="w-32"
                            />
                            <span className="text-[12px] text-text-dim font-medium">/{unit}</span>
                        </div>
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
                            className="bg-transparent border-0 text-[13px] font-bold text-text text-right focus:outline-none cursor-pointer"
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
                {(minStock != null || canEdit) && (
                    <Row label="Tồn tối thiểu">
                        {editingMinStock && canEdit ? (
                            <div className="flex items-center gap-1">
                                <input
                                    autoFocus
                                    type="text"
                                    inputMode="numeric"
                                    value={minStockInput}
                                    onChange={e => onMinStockInputChange(e.target.value.replace(/[^\d]/g, ''))}
                                    onBlur={onSaveMinStock}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') onSaveMinStock()
                                        if (e.key === 'Escape') onCancelMinStock()
                                    }}
                                    className="w-20 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right tabular-nums focus:outline-none focus:border-primary/50"
                                />
                                <span className="text-[12px] text-text-dim font-medium">{unit}</span>
                            </div>
                        ) : minStock != null ? (
                            <button
                                onClick={canEdit ? onStartEditMinStock : undefined}
                                className={`flex flex-col items-end gap-0.5 leading-tight text-[13px] font-bold text-text tabular-nums ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                            >
                                <span>
                                    {minStock} <span className="text-text-dim font-medium">{unit}</span>
                                </span>
                                {hasPack && minStock >= packSize && (
                                    <span className="text-[11px] font-medium text-text-dim">
                                        = {formatPackedQty(minStock, packSize, packUnit, unit, { compact: true })}
                                    </span>
                                )}
                            </button>
                        ) : (
                            <button
                                onClick={onStartEditMinStock}
                                className="text-[13px] font-bold text-primary hover:underline"
                            >
                                + Thêm mức tối thiểu
                            </button>
                        )}
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
function HistoryTab({ loading, summary, history, unit, monthLabel, monthOffset, onMonthChange, onOpenPayment }) {
    const hasOwing = summary.totalOwing > 0
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
                // Grid 2×2 khi có nợ (gọn trên mobile hơn 4 cột), 1×3 khi không nợ.
                // "Tiền nhập" = nghĩa vụ phát sinh trong tháng (theo created_at).
                // "Đã trả" = cash-out NVL trong tháng (theo paid_at, có thể trả cho invoice tháng khác).
                <div className={`bg-surface rounded-[16px] border border-border/60 p-4 grid gap-3 ${hasOwing ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">Tiền nhập</span>
                        <span className="text-[15px] font-black text-text tabular-nums mt-1">{formatVND(summary.totalSpent)}</span>
                    </div>
                    <div className="flex flex-col items-center">
                        <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">Lượng nhập</span>
                        <span className="text-[15px] font-black text-text tabular-nums mt-1">{summary.totalQty} {unit}</span>
                    </div>
                    {!hasOwing ? (
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">TB/đơn vị</span>
                            <span className="text-[15px] font-black text-primary tabular-nums mt-1">{formatVND(summary.avgPrice)}</span>
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-col items-center">
                                <span className="text-[10px] font-black text-success uppercase tracking-wider">Đã trả</span>
                                <span className="text-[15px] font-black text-success tabular-nums mt-1">{formatVND(summary.totalPaidInMonth)}</span>
                            </div>
                            <div className="flex flex-col items-center">
                                <span className="text-[10px] font-black text-warning uppercase tracking-wider">Còn nợ</span>
                                <span className="text-[15px] font-black text-warning tabular-nums mt-1">{formatVND(summary.totalOwing)}</span>
                            </div>
                        </>
                    )}
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
                        const isAdjust = !!entry.metadata?.adjustment
                        const paid = (entry.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
                        const owing = Math.max(0, (entry.amount || 0) - paid)
                        const status = isAdjust ? null
                            : owing <= 0 ? 'paid'
                            : paid <= 0 ? 'unpaid'
                            : 'partial'
                        const clickable = status === 'unpaid' || status === 'partial'
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                onClick={() => clickable && onOpenPayment && onOpenPayment(entry)}
                                disabled={!clickable || !onOpenPayment}
                                className={`text-left bg-surface rounded-[14px] border border-border/60 p-3 flex items-center gap-3 transition-all ${clickable && onOpenPayment ? 'cursor-pointer hover:border-primary/40 active:scale-[0.99]' : 'cursor-default'}`}
                            >
                                <div className="flex flex-col items-center shrink-0 w-12">
                                    <span className="text-[13px] font-black text-text tabular-nums">{dateStr}</span>
                                    <span className="text-[10px] font-bold text-text-dim tabular-nums">{timeStr}</span>
                                </div>
                                <div className="flex flex-col flex-1 min-w-0">
                                    <span className={`text-[13px] font-bold ${qty > 0 ? 'text-success' : qty < 0 ? 'text-danger' : 'text-text'}`}>
                                        {qty > 0 ? '+' : ''}{qty} {unit}
                                    </span>
                                    <span className="text-[11px] text-text-secondary truncate">
                                        {entry.staff_name || 'Không rõ'} · {isAdjust ? 'Hiệu chỉnh' : `${formatVND(unitPrice)}/${unit}`}
                                    </span>
                                    {status && status !== 'paid' && (
                                        <span className={`text-[10px] font-bold mt-0.5 ${status === 'unpaid' ? 'text-warning' : 'text-info'}`}>
                                            {status === 'unpaid' ? `Còn nợ ${formatVND(owing)}` : `Trả 1 phần: ${formatVND(paid)}/${formatVND(entry.amount)}`}
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-col items-end shrink-0">
                                    <span className={`text-[14px] font-black tabular-nums ${isAdjust ? 'text-text-secondary' : 'text-danger'}`}>
                                        {isAdjust ? '0đ' : `-${formatVND(entry.amount)}`}
                                    </span>
                                    {status === 'paid' && (
                                        <span className="text-[10px] font-bold text-success mt-0.5">Đã trả</span>
                                    )}
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </>
    )
}

// ─── Payment sheet ───────────────────────────────────────────────────────────
function PaymentSheet({ invoice, saving, onClose, onConfirm }) {
    const today = (() => {
        const d = new Date()
        const tz = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }))
        return tz.toISOString().slice(0, 10)
    })()
    const paidPrev = (invoice.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
    const owing = Math.max(0, (invoice.amount || 0) - paidPrev)
    const [amountInput, setAmountInput] = useState(formatVNDInput(owing))
    const [paymentMethod, setPaymentMethod] = useState('cash')
    const [paidDate, setPaidDate] = useState(today)
    const amount = parseVNDInput(amountInput)
    const isValid = amount > 0 && amount <= owing

    const handleConfirm = () => {
        if (!isValid || saving) return
        onConfirm({
            amount,
            paymentMethod,
            paidAt: paidDate !== today
                ? new Date(`${paidDate}T12:00:00+07:00`).toISOString()
                : new Date().toISOString(),
        })
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-5 animate-slide-up"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Ghi nhận thanh toán</span>
                        <span className="text-[16px] font-black text-text leading-tight">{invoice.name}</span>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all">
                        <span className="text-[18px]">×</span>
                    </button>
                </div>

                <div className="flex flex-col gap-2 p-3 bg-warning/5 border border-warning/20 rounded-[12px]">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-text-secondary">Hoá đơn gốc</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">{formatVND(invoice.amount)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-text-secondary">Đã trả</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">{formatVND(paidPrev)}</span>
                    </div>
                    <div className="flex items-center justify-between pt-1.5 border-t border-warning/20">
                        <span className="text-[12px] font-black text-warning">Còn nợ</span>
                        <span className="text-[15px] font-black text-warning tabular-nums">{formatVND(owing)}</span>
                    </div>
                </div>

                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Số tiền trả</label>
                        <MoneyInput value={amountInput} onChange={setAmountInput} size="lg" />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Ngày trả</label>
                        <input
                            type="date"
                            value={paidDate}
                            max={today}
                            onChange={e => setPaidDate(e.target.value)}
                            className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[14px] font-bold text-text focus:outline-none focus:border-primary/50"
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Phương thức</span>
                        <div className="flex items-center gap-0.5 bg-surface-light border border-border/60 rounded-lg p-0.5">
                            <button onClick={() => setPaymentMethod('cash')} className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'cash' ? 'bg-primary text-white' : 'text-text-secondary'}`}>Tiền mặt</button>
                            <button onClick={() => setPaymentMethod('transfer')} className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'transfer' ? 'bg-primary text-white' : 'text-text-secondary'}`}>Chuyển khoản</button>
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleConfirm}
                    disabled={!isValid || saving}
                    className="w-full py-3.5 rounded-[14px] bg-primary text-white text-[15px] font-black uppercase tracking-wide hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                >
                    {saving ? 'Đang lưu...' : 'Xác nhận thanh toán'}
                </button>
            </div>
        </div>
    )
}
