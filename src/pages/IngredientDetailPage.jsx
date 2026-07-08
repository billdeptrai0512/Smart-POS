import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useHistory } from '../contexts/HistoryContext'
import {
    fetchIngredientRestockHistory, fetchIngredientStocks, fetchIngredientWithdrawals,
    deleteIngredientCost, upsertIngredientCost, renameIngredient,
    adjustIngredientStock, setCounterStock, recordInvoicePayment, cancelRestock,
    editIngredientRestock,
} from '../services/orderService'
import { supabase } from '../lib/supabaseClient'
import {
    ingredientLabel, getIngredientUnit,
    normalizeIngredientCategory, normalizeIngredientKey,
} from '../utils/ingredients'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import PackConfigModal from '../components/IngredientManagementPage/PackConfigModal'
import IngredientDetailsTab from '../components/IngredientManagementPage/IngredientDetailsTab'
import IngredientHistoryTab from '../components/IngredientManagementPage/IngredientHistoryTab'
import InvoicePaymentSheet from '../components/IngredientManagementPage/InvoicePaymentSheet'
import RestockModal from '../components/IngredientManagementPage/RestockModal'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../contexts/ConfirmContext'
import { dateStringVN, timeStringVN } from '../utils/dateVN'

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
    const { refreshTodayExpenses } = useHistory()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()

    const [viewMode, setViewMode] = useState('details')
    const [history, setHistory] = useState([])
    const [loading, setLoading] = useState(true)
    const [stockData, setStockData] = useState(null)
    const [saving, setSaving] = useState(false)
    const [packModalOpen, setPackModalOpen] = useState(false)
    const [paymentInvoice, setPaymentInvoice] = useState(null)
    const [editingEntry, setEditingEntry] = useState(null)

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
    // Khối lượng bì của hộp/chai đựng tại quầy — null/0 = không có bì.
    const tareWeight = config.tare_weight ?? null
    // Mặc định true (chưa migrate / phiếu cũ → vẫn kiểm kê).
    const countInAudit = config.count_in_audit ?? true
    const currentStock = stockData?.current_stock ?? null

    // Stocks only depend on address+key — refetching on month-arrow taps would
    // burn one extra round-trip per nav.
    useEffect(() => {
        if (!selectedAddress?.id || !ingredientKey) return
        fetchIngredientStocks(selectedAddress.id)
            .then(stocks => setStockData(stocks.find(s => s.ingredient === ingredientKey)))
    }, [selectedAddress?.id, ingredientKey])

    // History is scoped to the displayed month. Gồm 2 nguồn xen kẽ theo thời gian:
    // phiếu nhập/hiệu chỉnh (expenses) + lượt "Rút ra quầy" (restock trong phiếu
    // chốt ca). Lượt rút là chuyển kho nội bộ — không tiền, không payments.
    const loadHistory = useCallback(async () => {
        const [hist, withdrawals] = await Promise.all([
            fetchIngredientRestockHistory(selectedAddress.id, ingredientKey, fromDate, toDate),
            fetchIngredientWithdrawals(selectedAddress.id, ingredientKey, fromDate, toDate),
        ])
        const withdrawalEntries = withdrawals.map(w => ({
            id: `wd-${w.id}`,
            created_at: w.created_at,
            is_withdrawal: true,
            amount: 0,
            payments: [],
            staff_name: w.staff_name,
            // before/after kho — card vẽ "Tồn kho X → Y" y hệt phiếu nhập/hiệu chỉnh.
            metadata: { qty: w.qty, before_stock: w.before_stock, after_stock: w.after_stock },
        }))
        return [...hist, ...withdrawalEntries]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }, [selectedAddress?.id, ingredientKey, fromDate, toDate])

    useEffect(() => {
        if (!selectedAddress?.id || !ingredientKey) return
        setLoading(true)
        loadHistory()
            .then(setHistory)
            .finally(() => setLoading(false))
    }, [loadHistory])

    // Realtime subscription
    useEffect(() => {
        if (!supabase || !selectedAddress?.id || !ingredientKey) return

        const channel = supabase
            .channel(`ingredient-detail-${ingredientKey}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'expenses',
                    filter: `address_id=eq.${selectedAddress.id}`
                },
                () => {
                    reloadHistory()
                    reloadStock()
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'expense_payments',
                    filter: `address_id=eq.${selectedAddress.id}`
                },
                () => {
                    reloadHistory()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [selectedAddress?.id, ingredientKey])

    const summary = useMemo(() => {
        let totalSpent = 0, totalQty = 0, totalOwing = 0, totalPaidInMonth = 0
        // `fromDate` / `toDate` xác định cửa sổ tháng đang xem — payments có paid_at
        // trong cửa sổ này được tính vào "Đã trả" của tháng. Một payment có thể trả
        // cho invoice tháng khác, nên paid không = invoice.amount khớp 1-1.
        const monthStartMs = new Date(fromDate).getTime()
        const monthEndMs = new Date(toDate).getTime()
        let purchaseCount = 0
        history.forEach(e => {
            // Lượt rút ra quầy không phải mua hàng — không tính vào tổng tiền/lượng nhập.
            if (e.is_withdrawal) return
            purchaseCount += 1
            totalSpent += e.amount || 0
            const qty = e.metadata?.qty || 0
            totalQty += qty
            const paid = (e.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
            totalOwing += Math.max(0, (e.amount || 0) - paid)
            for (const p of e.payments || []) {
                const t = new Date(p.paid_at).getTime()
                if (t >= monthStartMs && t <= monthEndMs) totalPaidInMonth += p.amount || 0
            }
        })
        return { totalSpent, totalQty, totalOwing, totalPaidInMonth, count: purchaseCount }
    }, [history, fromDate, toDate])

    async function reloadStock() {
        if (!selectedAddress?.id) return
        const stocks = await fetchIngredientStocks(selectedAddress.id)
        setStockData(stocks.find(s => s.ingredient === ingredientKey))
    }
    async function reloadHistory() {
        if (!selectedAddress?.id) return
        setHistory(await loadHistory())
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

    async function saveCountInAudit(next) {
        if (next === countInAudit) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, { countInAudit: next })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu thiết lập kiểm kê') }
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

    // Sửa KHO SAU (warehouse) = nhập số tuyệt đối. delta so với kho sau hiện tại
    // (KHÔNG so với tổng) → chỉ tác động warehouse, không đụng quầy.
    async function saveWarehouse(newWarehouse) {
        const current = stockData?.warehouse_stock ?? 0
        const delta = newWarehouse - current
        if (delta === 0) return
        setSaving(true)
        try {
            // Snapshot kho sau để Nhật ký vẽ "Tồn X → Y". Chỉ truyền khi stocks đã load.
            const snapshotOpts = stockData ? { beforeStock: stockData.warehouse_stock } : {}
            await adjustIngredientStock(selectedAddress?.id, ingredientKey, delta, profile?.name, snapshotOpts)
            await Promise.all([reloadStock(), refreshTodayExpenses?.()])
            showToast('Đã hiệu chỉnh kho sau', 'success')
        } catch (err) { showError(err, 'Hiệu chỉnh kho sau') }
        finally { setSaving(false) }
    }

    // Sửa TỒN QUẦY (counter) = nhập số tuyệt đối. Ghi thẳng `remaining` vào phiếu
    // chốt mới nhất → khớp với số chốt ca ở Hao hụt.
    async function saveCounter(newCounter) {
        if (newCounter === (stockData?.counter_stock ?? 0)) return
        setSaving(true)
        try {
            const res = await setCounterStock(selectedAddress?.id, ingredientKey, newCounter)
            if (!res) { showError(new Error('Chưa có phiếu chốt ca nào để ghi tồn quầy.'), 'Sửa tồn quầy'); return }
            await reloadStock()
            showToast('Đã sửa tồn quầy', 'success')
        } catch (err) { showError(err, 'Sửa tồn quầy') }
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

    async function saveTareWeight(newTare) {
        if (newTare === (tareWeight || 0)) return
        setSaving(true)
        try {
            await upsertIngredientCost(ingredientKey, cost, selectedAddress?.id, unit, {
                category: config.category,
                packSize: config.pack_size,
                packUnit: config.pack_unit,
                tareWeight: newTare || null, // 0 = xoá bì
            })
            refreshProducts?.()
        } catch (err) { showError(err, 'Lưu khối lượng bì') }
        finally { setSaving(false) }
    }

    async function handleRecordPayment({ amount, paymentMethod, paidAt, cashPhase }) {
        if (!paymentInvoice) return
        setSaving(true)
        try {
            await recordInvoicePayment(
                selectedAddress?.id, paymentInvoice.id,
                amount, paymentMethod, profile?.name, paidAt, cashPhase,
            )
            await Promise.all([reloadHistory(), refreshTodayExpenses?.()])
            setPaymentInvoice(null)
            showToast('Đã ghi nhận thanh toán', 'success')
        } catch (err) { showError(err, 'Ghi nhận thanh toán') }
        finally { setSaving(false) }
    }

    async function handleCancelRestock(entry) {
        const qty = entry?.metadata?.qty || 0
        const isAdjust = !!entry?.metadata?.adjustment
        const label = ingredientLabel(ingredientKey)
        const qtyStr = `${qty > 0 ? '+' : ''}${qty} ${unit}`
        // Reverting a +454 restock removes 454; reverting a −454 adjustment adds 454 back.
        const revertStr = `${qty > 0 ? '−' : '+'}${Math.abs(qty)} ${unit}`
        const head = isAdjust
            ? `Hủy hiệu chỉnh ${qtyStr} ${label}?`
            : `Hủy phiếu nhập ${qtyStr} ${label}?`
        const detail = isAdjust
            ? `Tồn kho sẽ thay đổi ${revertStr} để hoàn lại hiện trạng.`
            : `Tồn kho ${revertStr}, hoàn tiền đã trả, và tính lại giá vốn.`
        if (!await confirm({ title: head, detail, danger: true, confirmLabel: 'Hủy phiếu' })) return
        setSaving(true)
        try {
            await cancelRestock(selectedAddress?.id, entry.id, profile?.name)
            await Promise.all([reloadHistory(), reloadStock(), refreshProducts?.(), refreshTodayExpenses?.()])
            showToast(isAdjust ? 'Đã hủy hiệu chỉnh tồn' : 'Đã hủy phiếu nhập kho', 'success')
        } catch (err) { showError(err, isAdjust ? 'Hủy hiệu chỉnh tồn' : 'Hủy phiếu nhập kho') }
        finally { setSaving(false) }
    }

    async function handleEditRestock(entry, form) {
        setSaving(true)
        const originalHistory = [...history]
        const originalStockData = stockData ? { ...stockData } : null

        const purchaseDate = form.purchaseDate
            || new Date(`${dateStringVN()}T12:00:00+07:00`).toISOString()
        const qtyNum = Number(form.qty)
        const subtotalNum = Number(form.subtotal)
        const discountNum = Number(form.discount)
        const extraCostNum = Number(form.extraCost)
        const paidNum = Number(form.paid)
        const amountDue = Math.max(0, subtotalNum - discountNum + extraCostNum)
        const paidAmount = Math.min(paidNum, amountDue)

        // Optimistic history update
        const updatedHistory = history.map(h => {
            if (h.id === entry.id) {
                return {
                    ...h,
                    amount: amountDue,
                    discount_amount: discountNum,
                    extra_cost: extraCostNum,
                    payment_method: form.paymentMethod,
                    created_at: purchaseDate,
                    metadata: {
                        ...h.metadata,
                        qty: qtyNum,
                        subtotal: subtotalNum,
                        cash_phase: form.cashPhase,
                        after_stock: (h.metadata?.before_stock || 0) + qtyNum,
                    },
                    payments: paidAmount > 0 ? [{
                        amount: paidAmount,
                        payment_method: form.paymentMethod,
                        paid_at: purchaseDate,
                        cash_phase: form.cashPhase,
                        staff_name: profile?.name,
                    }] : []
                }
            }
            return h
        })

        const qtyDelta = qtyNum - (Number(entry.metadata?.qty) || 0)
        if (stockData && qtyDelta !== 0) {
            setStockData({
                ...stockData,
                current_stock: (stockData.current_stock || 0) + qtyDelta,
                warehouse_stock: (stockData.warehouse_stock || 0) + qtyDelta
            })
        }

        setHistory(updatedHistory)
        setEditingEntry(null)

        try {
            await editIngredientRestock(selectedAddress?.id, entry.id, {
                qty: qtyNum,
                subtotal: subtotalNum,
                discount: discountNum,
                extraCost: extraCostNum,
                paid: paidAmount,
                paymentMethod: form.paymentMethod,
                purchaseDate,
                cashPhase: form.cashPhase,
                staffName: profile?.name,
            })
            await Promise.all([reloadHistory(), reloadStock(), refreshProducts?.(), refreshTodayExpenses?.()])
            showToast('Đã sửa phiếu nhập kho', 'success')
        } catch (err) {
            setHistory(originalHistory)
            setStockData(originalStockData)
            showError(err, 'Sửa phiếu nhập kho')
        }
        finally { setSaving(false) }
    }

    async function handleDelete() {
        const label = ingredientLabel(ingredientKey)
        if (!await confirm({ title: `Xóa nguyên liệu "${label}"?`, detail: 'Sẽ gỡ khỏi tất cả công thức liên quan.', danger: true, confirmLabel: 'Xóa' })) return
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
                        tareWeight={tareWeight}
                        warehouseStock={stockData?.warehouse_stock ?? null}
                        counterStock={stockData?.counter_stock ?? null}
                        currentStock={currentStock}
                        countInAudit={countInAudit}
                        canEdit={canEdit}
                        saving={saving}
                        onSaveName={saveName}
                        onSaveWarehouse={saveWarehouse}
                        onSaveCounter={saveCounter}
                        onSaveUnit={saveUnit}
                        onSaveCost={saveCost}
                        onSaveMinStock={saveMinStock}
                        onSaveTareWeight={saveTareWeight}
                        onChangeCategory={saveCategory}
                        onToggleAudit={saveCountInAudit}
                        onConfigurePack={() => setPackModalOpen(true)}
                    />
                ) : (
                    <IngredientHistoryTab
                        loading={loading}
                        summary={summary}
                        history={history}
                        unit={unit}
                        packSize={packSize}
                        packUnit={packUnit}
                        monthLabel={monthLabel}
                        monthOffset={monthOffset}
                        onMonthChange={setMonthOffset}
                        onOpenPayment={canEdit ? setPaymentInvoice : null}
                        onCancelRestock={canEdit ? handleCancelRestock : null}
                        onEditRestock={canEdit ? setEditingEntry : null}
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

            {editingEntry && (
                <RestockModal
                    ingredient={ingredientKey}
                    unit={unit}
                    packSize={packSize}
                    packUnit={packUnit}
                    cashClosedToday={false}
                    mode="edit"
                    initial={{
                        qty: editingEntry.metadata?.qty ?? 0,
                        subtotal: editingEntry.metadata?.subtotal ?? editingEntry.amount ?? 0,
                        discount: editingEntry.discount_amount ?? 0,
                        extraCost: editingEntry.extra_cost ?? 0,
                        paid: (editingEntry.payments || []).reduce((s, p) => s + (p.amount || 0), 0),
                        paymentMethod: editingEntry.payment_method || 'cash',
                        cashPhase: editingEntry.metadata?.cash_phase || 'post_close',
                        purchaseDate: dateStringVN(new Date(editingEntry.created_at)),
                        purchaseTime: timeStringVN(new Date(editingEntry.created_at)),
                    }}
                    onConfirm={(form) => handleEditRestock(editingEntry, form)}
                    onClose={() => setEditingEntry(null)}
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
