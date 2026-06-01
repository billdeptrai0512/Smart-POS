import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { usePOS } from '../contexts/POSContext'
import {
    fetchIngredientRestockHistory, fetchIngredientStocks,
    deleteIngredientCost, upsertIngredientCost, renameIngredient,
    adjustIngredientStock, recordInvoicePayment, cancelRestock,
} from '../services/orderService'
import {
    ingredientLabel, getIngredientUnit,
    normalizeIngredientCategory, normalizeIngredientKey,
} from '../utils/ingredients'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import PackConfigModal from '../components/IngredientManagementPage/PackConfigModal'
import IngredientDetailsTab from '../components/IngredientManagementPage/IngredientDetailsTab'
import IngredientHistoryTab from '../components/IngredientManagementPage/IngredientHistoryTab'
import InvoicePaymentSheet from '../components/IngredientManagementPage/InvoicePaymentSheet'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'

// Page-level orchestrator: fetches data, owns the canonical state (stock, history,
// config), and exposes per-field save callbacks. All edit-mode UI state lives
// inside child components — see IngredientDetailsTab for the inverted control.
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
    const [paymentInvoice, setPaymentInvoice] = useState(null)

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

    // Derived view from context — single source of truth, never a local copy.
    const config = useMemo(
        () => (ingredientConfigs || []).find(c => c.ingredient === ingredientKey) || {},
        [ingredientConfigs, ingredientKey]
    )
    const unit = getIngredientUnit(ingredientKey, ingredientUnits[ingredientKey])
    const cost = ingredientCosts[ingredientKey] || 0
    const category = normalizeIngredientCategory(config.category)
    const packSize = config.pack_size ?? null
    const packUnit = config.pack_unit ?? null
    // `??` so an explicit 0 round-trips faithfully (DB column NULL stays as null;
    // a stored 0 stays as 0). See ingredientService.upsertIngredientCost for the
    // matching write-side rule.
    const minStock = config.min_stock ?? null
    const currentStock = stockData?.current_stock ?? null

    // Stocks only depend on address+key — refetching on month-arrow taps would
    // burn one extra round-trip per nav.
    useEffect(() => {
        if (!selectedAddress?.id || !ingredientKey) return
        fetchIngredientStocks(selectedAddress.id)
            .then(stocks => setStockData(stocks.find(s => s.ingredient === ingredientKey)))
    }, [selectedAddress?.id, ingredientKey])

    // History is scoped to the displayed month.
    useEffect(() => {
        if (!selectedAddress?.id || !ingredientKey) return
        setLoading(true)
        fetchIngredientRestockHistory(selectedAddress.id, ingredientKey, fromDate, toDate)
            .then(setHistory)
            .finally(() => setLoading(false))
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

    // ── Save callbacks for child rows ───────────────────────────────────────
    async function saveCategory(newCat) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, { category: newCat })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu nhóm nguyên liệu') }
        finally { setSaving(false) }
    }

    async function savePackConfig({ packSize: ps, packUnit: pu }) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, {
                packSize: ps, packUnit: pu, minStock: config.min_stock,
            })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu quy cách đóng gói') }
        finally { setSaving(false) }
    }

    async function saveCost(newCost) {
        if (newCost === cost) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, newCost, selectedAddress?.id, unit, { category: config.category })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu giá vốn') }
        finally { setSaving(false) }
    }

    async function saveStock(newTotal) {
        const current = currentStock || 0
        const delta = newTotal - current
        if (delta === 0) return
        setSaving(true)
        try {
            // Snapshot the WAREHOUSE side, not current_stock (which includes the
            // counter). The Nhật ký card renders the warehouse trajectory; that's
            // what staff need to reason about when reviewing past adjustments.
            // Only pass beforeStock when stocks are loaded — a pre-load save would
            // otherwise snapshot a fake 0 baseline. The metadata then writes no
            // snapshot for this entry; UI degrades gracefully.
            const snapshotOpts = stockData
                ? { beforeStock: stockData.warehouse_stock }
                : {}
            await adjustIngredientStock(selectedAddress?.id, ingredientKey, delta, profile?.name, snapshotOpts)
            await Promise.all([reloadStock(), refreshTodayExpenses?.()])
        } catch (err) { showError(err, 'Hiệu chỉnh tồn') }
        finally { setSaving(false) }
    }

    async function saveUnit(newUnit) {
        if (newUnit === unit) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, newUnit, { category: config.category })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu đơn vị') }
        finally { setSaving(false) }
    }

    async function saveName(newDisplayName) {
        const newKey = normalizeIngredientKey(newDisplayName)
        if (!newKey || newKey === ingredientKey) return
        setSaving(true)
        try {
            await renameIngredient(ingredientKey, newKey, selectedAddress?.id)
            refreshProducts?.()
            // URL param drives every fetch on this page — repoint at the new key
            // so the page keeps showing the same ingredient under its new name.
            navigate(`/ingredients/${newKey}`, { replace: true, state: location.state })
        } catch (err) { showError(err, 'Đổi tên nguyên liệu') }
        finally { setSaving(false) }
    }

    async function saveMinStock(newMin) {
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
        } catch (err) { showError(err, 'Lưu tồn tối thiểu') }
        finally { setSaving(false) }
    }

    async function handleRecordPayment({ amount, paymentMethod, paidAt }) {
        if (!paymentInvoice) return
        setSaving(true)
        try {
            await recordInvoicePayment(
                selectedAddress?.id, paymentInvoice.id,
                amount, paymentMethod, profile?.name, paidAt,
            )
            await Promise.all([reloadHistory(), refreshTodayExpenses?.()])
            setPaymentInvoice(null)
        } catch (err) { showError(err, 'Ghi nhận thanh toán') }
        finally { setSaving(false) }
    }

    async function handleCancelRestock(entry) {
        const qty = entry?.metadata?.qty || 0
        const label = ingredientLabel(ingredientKey)
        if (!window.confirm(
            `Hủy phiếu nhập ${qty > 0 ? '+' : ''}${qty} ${unit} ${label}?\n` +
            `Tồn kho sẽ giảm lại ${qty} ${unit}, hoàn tiền đã trả, và tính lại giá vốn.`
        )) return
        setSaving(true)
        try {
            await cancelRestock(selectedAddress?.id, entry.id, profile?.name)
            await Promise.all([reloadHistory(), reloadStock(), refreshProducts?.(), refreshTodayExpenses?.()])
        } catch (err) { showError(err, 'Hủy phiếu nhập kho') }
        finally { setSaving(false) }
    }

    async function handleDelete() {
        const label = ingredientLabel(ingredientKey)
        if (!window.confirm(`Xóa nguyên liệu "${label}"? Hành động này sẽ gỡ nó khỏi tất cả công thức liên quan.`)) return
        try {
            await deleteIngredientCost(ingredientKey, selectedAddress?.id)
            refreshProducts?.()
            navigate('/ingredients')
        } catch (err) { showError(err, 'Xóa nguyên liệu') }
    }

    const titleLabel = ingredientLabel(ingredientKey)
    const stockSubtitle = currentStock !== null ? `${Math.round(currentStock * 10) / 10} ${unit}` : '—'

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <IngredientDetailHeader
                title={titleLabel}
                subtitle={`Tồn: ${stockSubtitle}`}
                onBack={() => navigate('/ingredients', { state: location.state })}
                onDelete={canEdit ? handleDelete : null}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 bg-bg space-y-4">
                {viewMode === 'details' ? (
                    <IngredientDetailsTab
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
                        onSaveName={saveName}
                        onSaveStock={saveStock}
                        onSaveUnit={saveUnit}
                        onSaveCost={saveCost}
                        onSaveMinStock={saveMinStock}
                        onChangeCategory={saveCategory}
                        onConfigurePack={() => setPackModalOpen(true)}
                    />
                ) : (
                    <IngredientHistoryTab
                        loading={loading}
                        summary={summary}
                        history={history}
                        unit={unit}
                        monthLabel={monthLabel}
                        monthOffset={monthOffset}
                        onMonthChange={setMonthOffset}
                        onOpenPayment={canEdit ? setPaymentInvoice : null}
                        onCancelRestock={canEdit ? handleCancelRestock : null}
                    />
                )}
            </main>

            {paymentInvoice && (
                <InvoicePaymentSheet
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
