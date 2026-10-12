import { useState, useEffect, useMemo, useCallback } from 'react'
import { withCounterEstimate, recipesBelongTo } from '../services/counterEstimate'
import { useCounterCalc } from '../hooks/useCounterCalc'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useHistory } from '../contexts/HistoryContext'
import {
    fetchIngredientRestockHistory, fetchIngredientStocks, fetchIngredientWithdrawals,
    deleteIngredientCost, upsertIngredientCost, renameIngredient,
    adjustIngredientStock, setCounterStock, recordInvoicePayment, cancelRestock,
    editIngredientRestock, mergeShiftClosingInventory, fetchIngredientDailyContext,
    processIngredientRestock, setIngredientsGroup,
} from '../services/orderService'
import { formatVND } from '../utils'
import { pack2Of } from '../utils/inventory'
import {
    ingredientLabel, getIngredientUnit,
    normalizeIngredientCategory, normalizeIngredientKey,
} from '../utils/ingredients'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import PackConfigModal, { type PackConfigValues } from '../components/IngredientManagementPage/PackConfigModal'
import IngredientDetailsTab, { IngredientStockPanel, IngredientCounterPanel, DeleteIngredientButton } from '../components/IngredientManagementPage/IngredientDetailsTab'
import IngredientHistoryTab from '../components/IngredientManagementPage/IngredientHistoryTab'
import IngredientHistoryFilterSheet, { kindOf, type HistoryKind } from '../components/IngredientManagementPage/IngredientHistoryFilterSheet'
import InvoicePaymentSheet, { type InvoicePayment } from '../components/IngredientManagementPage/InvoicePaymentSheet'
import RestockModal, { type RestockPayload } from '../components/IngredientManagementPage/RestockModal'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'
import { useSavingAction } from '../hooks/useSavingAction'
import { useCashClosedToday } from '../hooks/useCashClosedToday'
import { restockInitialFrom } from '../utils/restockInitial'
import { useConfirm } from '../contexts/ConfirmContext'
import { dateStringVN } from '../utils/dateVN'
import { calcRangeWithLabel } from '../utils/rangeCalc'
import { useDateScope } from '../hooks/useDateScope'
import { DateRangePicker } from '../components/HistoryPage/HistoryHeader'
import { fetchPackedConfirmations } from '../services/warehouseTransferService'
import { findCoffeeIngredient, nextIngredientSetupField } from '../utils/onboardingHint'
import { isRecipeProgressDone, readOnboardingState, writeOnboardingState } from '../utils/onboardingStorage'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'
import type { Row, UUID } from '../types/domain'

// Page-level orchestrator: fetches data, owns the canonical state (stock, history,
// config), and exposes per-field save callbacks. All edit-mode UI state lives
// inside child components — see IngredientDetailsTab for the inverted control.
export default function IngredientDetailPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { ingredientKey } = useParams() as { ingredientKey: string }
    const { ingredientCosts, ingredientUnits, ingredientConfigs, ingredientGroups, refreshProducts, recipes } = useProducts()
    const calcRef = useCounterCalc()
    const { addressId, selectedAddress, siblingsByAddress } = useAddress()
    const warehouseSiblings = addressId ? siblingsByAddress[addressId] : null
    const warehouseGroupNote = warehouseSiblings?.length
        ? `Dùng chung với: ${warehouseSiblings.map(a => a.name).join(', ')}`
        : null
    // Nhật ký phải thấy phiếu nhập/rút ở CẢ NHÓM khi có kho tổng chung — 1 phần tử khi độc lập.
    // Khoá theo id: warehouseSiblings đổi tham chiếu mỗi lần addresses refetch → loadHistory chạy lại, spinner nháy.
    const siblingKey = (warehouseSiblings || []).map(a => a.id).join(',')
    const groupAddressIds = useMemo(
        () => addressId ? [addressId, ...(siblingKey ? siblingKey.split(',') : [])] : [],
        [addressId, siblingKey]
    )
    const hasAddress = !!selectedAddress
    const addressNameById = useMemo(() => {
        const map: Record<string, string> = {}
        if (addressId && selectedAddress) map[addressId] = selectedAddress.name
        for (const a of warehouseSiblings || []) map[a.id] = a.name
        return map
    }, [addressId, selectedAddress, warehouseSiblings])
    const { isManager, isAdmin, profile, isGuest } = useAuth()
    const { refreshTodayExpenses } = useHistory()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()

    // ?tab=history: vào thẳng Nhật ký (vd từ dòng công nợ nhiều phiếu ở modal Bổ sung tồn kho).
    const [viewMode, setViewMode] = useState(() => new URLSearchParams(location.search).get('tab') === 'history' ? 'history' : 'details')
    const [history, setHistory] = useState<Row[]>([])
    const [loading, setLoading] = useState(true)
    const [stockData, setStockData] = useState<Row | null>(null)
    const [dailyContext, setDailyContext] = useState<Row | null>(null)
    const { saving, withSaving, setSaving } = useSavingAction(showError)
    const [packModalOpen, setPackModalOpen] = useState(false)
    const [paymentInvoice, setPaymentInvoice] = useState<Row | null>(null)
    const [editingEntry, setEditingEntry] = useState<Row | null>(null)
    const [restockOpen, setRestockOpen] = useState(false)
    // Đã chốt ca tiền hôm nay chưa → default phân loại tiền mặt khi nhập kho.
    const cashClosedToday = useCashClosedToday(addressId, restockOpen)

    // Khoảng ngày của tab Nhật ký — cùng hook với /history, /report; mặc định tháng này.
    const dateScope = useDateScope({ scope: 'month', offset: 0 })
    const { scope: dScope, offset: dOffset, customRange: dCustom } = dateScope
    const { fromDate, toDate, rangeLabel } = useMemo(() => {
        const { start, end, label } = calcRangeWithLabel(dScope, dOffset, dCustom)
        return { fromDate: start.toISOString(), toDate: end.toISOString(), rangeLabel: label }
    }, [dScope, dOffset, dCustom])

    // Derived view from context — single source of truth, never a local copy.
    const config = useMemo<Row>(
        () => (ingredientConfigs || []).find(c => c.ingredient === ingredientKey) || {},
        [ingredientConfigs, ingredientKey]
    )
    const unit = getIngredientUnit(ingredientKey, ingredientUnits[ingredientKey])
    const cost = ingredientCosts[ingredientKey] || 0
    const category = normalizeIngredientCategory(config.category)
    const packSize = config.pack_size ?? null
    const packUnit = config.pack_unit ?? null
    const pack2 = useMemo(() => pack2Of(config), [config])   // 1 thùng = 12 hộp (size tính theo cấp 1)
    // `??` so an explicit 0 round-trips faithfully (DB column NULL stays as null;
    // a stored 0 stays as 0). See ingredientCostService.upsertIngredientCost for the
    // matching write-side rule.
    const minStock = config.min_stock ?? null          // tồn KHO ít nhất
    const minCounterStock = config.min_counter_stock ?? null   // tồn QUẦY ít nhất
    // Khối lượng bì của hộp/chai đựng tại quầy — null/0 = không có bì.
    const tareWeight = config.tare_weight ?? null
    // Mặc định true (chưa migrate / phiếu cũ → vẫn kiểm kê).
    const countInAudit = config.count_in_audit ?? true
    const currentStock = stockData?.current_stock ?? null

    // Stocks only depend on address+key — refetching on month-arrow taps would
    // burn one extra round-trip per nav.
    // Tồn quầy NVL chưa đếm hôm nay = ước tính theo lý thuyết (withCounterEstimate; chỉ dòng của NVL này).
    const recipesReady = recipesBelongTo(recipes, addressId)   // công thức tải xong sau lần đọc đầu → đọc lại để có ước tính
    const fetchStockRow = useCallback(async (addressId: UUID | null) => {
        const row = (await fetchIngredientStocks(addressId)).find((s: Row) => s.ingredient === ingredientKey)
        return row ? (await withCounterEstimate([row], addressId, calcRef.current))?.[0] : row
    }, [ingredientKey, calcRef])

    useEffect(() => {
        if (!hasAddress || !ingredientKey) return
        fetchStockRow(addressId).then(setStockData)
    }, [hasAddress, addressId, ingredientKey, fetchStockRow, recipesReady])

    // Đầu ngày/Lấy ra/Nhập mới cho panel Kiểm kê — cùng nguồn dữ liệu với card ở /inventory.
    useEffect(() => {
        if (!hasAddress || !ingredientKey) return
        fetchIngredientDailyContext(addressId)
            .then(map => setDailyContext(map[ingredientKey] || null))
    }, [hasAddress, addressId, ingredientKey])

    // History is scoped to the displayed month. Gồm 2 nguồn xen kẽ theo thời gian:
    // phiếu nhập/hiệu chỉnh (expenses) + lượt "Rút ra quầy" (restock trong phiếu
    // chốt ca). Lượt rút là chuyển kho nội bộ — không tiền, không payments.
    const loadHistory = useCallback(async () => {
        const [hist, withdrawals, packed] = await Promise.all([
            fetchIngredientRestockHistory(groupAddressIds, ingredientKey, fromDate, toDate),
            fetchIngredientWithdrawals(groupAddressIds, ingredientKey, fromDate, toDate),
            // Người xác nhận SOẠN (ngày trước) của từng lượt rút — chỉ nhóm kho chung có; lỗi/chưa có phiếu thì bỏ qua.
            groupAddressIds.length > 1 ? fetchPackedConfirmations(groupAddressIds, ingredientKey, fromDate, toDate).catch(() => []) : Promise.resolve([]),
        ])
        const packedBy = new Map(packed.map(p => [`${p.address_id}|${p.for_date}`, p]))
        const withdrawalEntries = withdrawals.map(w => ({
            id: `wd-${w.id}`,
            created_at: w.created_at,
            is_withdrawal: true,
            amount: 0,
            payments: [],
            staff_name: w.staff_name,
            address_id: w.address_id,
            // before/after kho — card vẽ "Tồn kho X → Y" y hệt phiếu nhập/hiệu chỉnh.
            metadata: {
                qty: w.qty, before_stock: w.before_stock, after_stock: w.after_stock,
                // Soạn cho ngày này = phiếu "Soạn cho ngày mai" của hôm trước (for_date = ngày rút); staff_name = người nhận.
                packed_by: packedBy.get(`${w.address_id}|${dateStringVN(new Date(w.created_at))}`),
            },
        }))
        return ([...hist, ...withdrawalEntries] as Row[])
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }, [groupAddressIds, ingredientKey, fromDate, toDate])

    const reloadStock = useCallback(async () => {
        if (!hasAddress) return
        setStockData(await fetchStockRow(addressId))
    }, [hasAddress, addressId, fetchStockRow])

    const reloadHistory = useCallback(async () => {
        if (!hasAddress) return
        setHistory(await loadHistory())
    }, [hasAddress, loadHistory])

    useEffect(() => {
        if (!hasAddress || !ingredientKey) return
        setLoading(true)
        loadHistory()
            .then(setHistory)
            .finally(() => setLoading(false))
    }, [loadHistory, hasAddress, ingredientKey])

    // Kho tổng chung: lọc nhật ký theo địa chỉ (mọi loại thẻ — nhập kho, hiệu chỉnh, rút ra quầy). null = tất cả.
    const [addressFilter, setAddressFilter] = useState<string | null>(null)
    const [kindFilter, setKindFilter] = useState<HistoryKind | null>(null)
    const [filterOpen, setFilterOpen] = useState(false)
    const shownHistory = useMemo(() => history.filter(e =>
        (!addressFilter || e.address_id === addressFilter) && (!kindFilter || kindFilter === kindOf(e))
    ), [history, addressFilter, kindFilter])

    const summary = useMemo(() => {
        let totalQty = 0, totalSpent = 0, totalOwing = 0, totalPaidInMonth = 0
        let importCount = 0, withdrawCount = 0, adjustCount = 0
        // `fromDate` / `toDate` xác định cửa sổ đang xem — payments có paid_at
        // trong cửa sổ này được tính vào "Đã trả". Một payment có thể trả
        // cho invoice kỳ khác, nên paid không = invoice.amount khớp 1-1.
        const monthStartMs = new Date(fromDate).getTime()
        const monthEndMs = new Date(toDate).getTime()
        shownHistory.forEach(e => {
            // Lượt rút ra quầy không phải mua hàng — chỉ đếm số lần, không tính tiền.
            const kind = kindOf(e)
            if (kind === 'withdrawal') { withdrawCount += 1; return }
            if (kind === 'adjustment') adjustCount += 1
            else if (kind === 'restock') { importCount += 1; totalQty += e.metadata?.qty || 0 }
            totalSpent += e.amount || 0
            const paid = (e.payments || []).reduce((s: number, p: Row) => s + (p.amount || 0), 0)
            totalOwing += Math.max(0, (e.amount || 0) - paid)
            for (const p of e.payments || []) {
                const t = new Date(p.paid_at).getTime()
                if (t >= monthStartMs && t <= monthEndMs) totalPaidInMonth += p.amount || 0
            }
        })
        return { totalQty, totalSpent, totalOwing, totalPaidInMonth, importCount, withdrawCount, adjustCount }
    }, [shownHistory, fromDate, toDate])

    // ── Save callbacks for child rows ───────────────────────────────────────
    // category đi theo section của nhóm (trigger DB ép) — client chỉ gán group_id.
    async function saveGroup(groupId: UUID | null) {
        await withSaving('Lưu nhóm nguyên liệu', async () => {
            if (!addressId) throw new Error('Cần chọn một địa chỉ cụ thể (không áp dụng cho Mẫu mặc định)')
            await setIngredientsGroup([ingredientKey], addressId, groupId)
            refreshProducts?.()
        })
    }

    // Ghi một phần cấu hình giá/quy cách của nguyên liệu (upsertIngredientCost) rồi làm tươi context.
    const saveCost = (ctx: string, opts: Parameters<typeof upsertIngredientCost>[4], unitOverride = unit) =>
        withSaving(ctx, async () => {
            await upsertIngredientCost(ingredientKey, cost, addressId, unitOverride, opts)
            refreshProducts?.()
        })

    function saveCountInAudit(next: boolean) {
        if (next !== countInAudit) return saveCost('Lưu thiết lập kiểm kê', { countInAudit: next })
    }

    const savePackConfig = ({ packSize: ps, packUnit: pu, pack2Size: ps2, pack2Unit: pu2 }: PackConfigValues) =>
        saveCost('Lưu quy cách đóng gói', { packSize: ps, packUnit: pu, pack2Size: ps2, pack2Unit: pu2, minStock: config.min_stock })

    // Sửa KHO SAU (warehouse) = nhập số tuyệt đối. delta so với kho sau hiện tại
    // (KHÔNG so với tổng) → chỉ tác động warehouse, không đụng quầy.
    async function saveWarehouse(newWarehouse: number) {
        const current = stockData?.warehouse_stock ?? 0
        const delta = newWarehouse - current
        if (delta === 0) return
        await withSaving('Hiệu chỉnh kho sau', async () => {
            // Snapshot kho sau để Nhật ký vẽ "Tồn X → Y". Chỉ truyền khi stocks đã load.
            const snapshotOpts = stockData ? { beforeStock: stockData.warehouse_stock } : {}
            await adjustIngredientStock(addressId, ingredientKey, delta, profile?.name ?? null, snapshotOpts)
            await Promise.all([reloadStock(), refreshTodayExpenses?.()])
            showToast('Đã hiệu chỉnh kho sau', 'success')
        })
    }

    // Sửa TỒN QUẦY (counter) = nhập số tuyệt đối. Ghi thẳng `remaining` vào phiếu
    // chốt mới nhất → khớp với số chốt ca ở Hao hụt.
    // Chưa có phiếu chốt nào (địa chỉ mới) → ghi thành Đầu kỳ (khoá) của phiếu hôm nay
    // thay vì báo lỗi, để nhập tồn quầy lúc setup ban đầu vẫn hoạt động; chốt ca đầu
    // tiên sẽ tự tính hao hụt dựa trên Đầu kỳ này.
    async function saveCounter(newCounter: number) {
        await withSaving('Sửa tồn quầy', async () => {
            const res = await setCounterStock(addressId, ingredientKey, newCounter)
            if (!res) {
                await mergeShiftClosingInventory(addressId, [{
                    ingredient: ingredientKey,
                    unit,
                    opening: newCounter,
                    opening_locked: true,
                    remaining: null,
                    restock: null,
                    skipped: false,
                }], null)
            }
            await reloadStock()
            showToast('Đã sửa tồn quầy', 'success')
        })
    }

    function saveUnit(newUnit: string) {
        if (newUnit !== unit) return saveCost('Lưu đơn vị', { category: config.category }, newUnit)
    }

    async function saveName(newDisplayName: string) {
        const newKey = normalizeIngredientKey(newDisplayName)
        if (!newKey || newKey === ingredientKey) return
        await withSaving('Đổi tên nguyên liệu', async () => {
            if (!addressId) throw new Error('Cần chọn một địa chỉ cụ thể (không áp dụng cho Mẫu mặc định)')
            await renameIngredient(ingredientKey, newKey, addressId)
            refreshProducts?.()
            // URL param drives every fetch on this page — repoint at the new key
            // so the page keeps showing the same ingredient under its new name.
            navigate(`/inventory/stocking/${newKey}`, { replace: true, state: location.state })
        })
    }

    function saveMinStock(newMin: number) {
        if (newMin !== (minStock || 0)) {
            return saveCost('Lưu tồn tối thiểu', { category: config.category, packSize: config.pack_size, packUnit: config.pack_unit, minStock: newMin })
        }
    }

    function saveMinCounter(newMin: number) {
        if (newMin !== (minCounterStock || 0)) return saveCost('Lưu tồn quầy tối thiểu', { minCounterStock: newMin })
    }

    function saveTareWeight(newTare: number) {
        if (newTare !== (tareWeight || 0)) {
            // newTare 0 = xoá bì
            return saveCost('Lưu khối lượng bì', { category: config.category, packSize: config.pack_size, packUnit: config.pack_unit, tareWeight: newTare || null })
        }
    }

    async function handleRestock({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }: RestockPayload) {
        // beforeStock only used by guest / default-address paths; the address RPC
        // computes its own authoritative snapshot. Only include when stocks đã load.
        const snapshot = stockData ? { beforeStock: stockData.warehouse_stock } : {}
        const result = await processIngredientRestock(addressId, ing, qty, profile?.name ?? null, {
            subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
            ...snapshot,
        })
        await Promise.all([reloadStock(), reloadHistory(), refreshProducts?.(), refreshTodayExpenses?.()])
        showToast('Đã nhập kho', 'success')
        return result
    }

    async function handleRecordPayment({ amount, paymentMethod, paidAt, cashPhase }: InvoicePayment) {
        if (!paymentInvoice) return
        await withSaving('Ghi nhận thanh toán', async () => {
            // Kho tổng nhóm: hoá đơn đang trả nợ có thể ghi nhận ở địa chỉ KHÁC địa chỉ đang xem —
            // dùng address_id thật của hoá đơn để invalidate đúng cache báo cáo.
            await recordInvoicePayment(
                paymentInvoice.address_id || addressId, paymentInvoice.id,
                amount, paymentMethod, profile?.name, paidAt, cashPhase,
            )
            await Promise.all([reloadHistory(), refreshTodayExpenses?.()])
            setPaymentInvoice(null)
            showToast('Đã ghi nhận thanh toán', 'success')
        })
    }

    async function handleCancelRestock(entry: Row) {
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
        await withSaving(isAdjust ? 'Hủy hiệu chỉnh tồn' : 'Hủy phiếu nhập kho', async () => {
            // Kho tổng nhóm: Nhật ký có thể hiện phiếu ghi nhận ở địa chỉ KHÁC (đang xem chỉ là 1
            // thành viên) — phải hủy đúng theo address_id thật của phiếu, không phải địa chỉ đang xem.
            await cancelRestock(entry.address_id || addressId, entry.id, profile?.name)
            await Promise.all([reloadHistory(), reloadStock(), refreshProducts?.(), refreshTodayExpenses?.()])
            showToast(isAdjust ? 'Đã hủy hiệu chỉnh tồn' : 'Đã hủy phiếu nhập kho', 'success')
        })
    }

    async function handleEditRestock(entry: Row, form: RestockPayload) {
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
            // Kho tổng nhóm: khớp lý do ở handleCancelRestock — sửa đúng theo address_id thật.
            await editIngredientRestock(entry.address_id || addressId, entry.id, {
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
        await withSaving('Xóa nguyên liệu', async () => {
            await deleteIngredientCost(ingredientKey, addressId)
            refreshProducts?.()
            navigate('/inventory/stocking')
        })
    }

    const titleLabel = ingredientLabel(ingredientKey)
    // Có quy đổi → giá theo đơn vị đóng gói (dễ đối chiếu với hóa đơn NCC); không thì
    // theo đơn vị gốc.
    const costSubtitle = packSize && packUnit
        ? `1 ${packUnit} = ${formatVND(cost * packSize)}`
        : `1 ${unit} = ${formatVND(cost)}`

    // Onboarding phase 6 (CUỐI CÙNG, "Cài đặt nguyên liệu") — hint lần lượt 4 field trên đúng
    // ingredient "Cà phê", sau khi phase 5 (công thức) đã xong. nextIngredientSetupField trả về
    // field ĐẦU TIÊN chưa xong theo đúng thứ tự hiện trên UI — xem onboardingHint.ts.
    const recipeProgress = useOnboardingProgress('recipeProgress', { isGuest, addressId })
    const isCoffee = isGuest && findCoffeeIngredient(ingredientConfigs)?.ingredient === ingredientKey
    // Tick "Nhập tồn kho cuối ngày" của guide. Mọi đường lưu kho đều reloadStock() → stockData
    // mới nên 1 effect phủ hết. ponytail: kho Cà phê nhập ở trang khác thì chỉ tick khi mở
    // trang này — hint bước 6 vốn dẫn khách vào đây.
    const warehouseSet = !!stockData?.warehouse_stock_set
    useEffect(() => {
        const id = addressId
        if (!isCoffee || !warehouseSet || !id || readOnboardingState(id).stockProgress.coffeeWarehouseSet) return
        writeOnboardingState(id, { stockProgress: { coffeeWarehouseSet: true } })
    }, [isCoffee, warehouseSet, addressId])
    const setupField = isCoffee && isRecipeProgressDone(recipeProgress)
        ? nextIngredientSetupField(config, stockData?.warehouse_stock_set)
        : null
    const hintWarehouse = setupField === 'warehouse'
    const hintPack = setupField === 'pack'
    const hintMinStock = setupField === 'minStock'
    const hintTare = setupField === 'tare'

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <IngredientDetailHeader
                title={titleLabel}
                subtitle={viewMode === 'history' ? undefined : costSubtitle}
                onBack={() => navigate('/inventory/stocking', { state: location.state })}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onAdd={canEdit ? () => setRestockOpen(true) : undefined}
                onFilter={viewMode === 'history' ? () => setFilterOpen(true) : undefined}
                filterActive={!!addressFilter || !!kindFilter}
                dateNav={viewMode === 'history' ? (
                    <DateRangePicker
                        scope={dScope}
                        rangeLabel={rangeLabel}
                        rangeStartISO={dateStringVN(new Date(fromDate))}
                        rangeEndISO={dateStringVN(new Date(toDate))}
                        dayInputValue={dateScope.dayInputValue}
                        customRange={dCustom}
                        todayISO={dateScope.todayISO}
                        canGoForwardDay={dateScope.canGoForwardDay}
                        canGoForward={dateScope.canGoForwardPeriod}
                        onPrevDay={dateScope.goPrevDay}
                        onNextDay={dateScope.goNextDay}
                        onOffsetPrev={dateScope.goOffsetPrev}
                        onOffsetNext={dateScope.goOffsetNext}
                        onRangeChange={dateScope.applyRange}
                        onShiftRange={dateScope.shiftRange}
                        canShiftRangeForward={dateScope.canShiftRangeForward}
                        onPresetSelect={dateScope.applyPreset}
                    />
                ) : undefined}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-48 bg-bg space-y-4">
                {viewMode === 'details' ? (
                    <>
                        <IngredientDetailsTab
                            nameLabel={titleLabel}
                            unit={unit}
                            category={category}
                            groupId={config.group_id ?? null}
                            groups={ingredientGroups}
                            packSize={packSize}
                            packUnit={packUnit}
                            pack2={pack2}
                            countInAudit={countInAudit}
                            onToggleAudit={saveCountInAudit}
                            hintPack={hintPack}
                            canEdit={canEdit}
                            saving={saving}
                            onSaveName={saveName}
                            onSaveUnit={saveUnit}
                            onChangeGroup={saveGroup}
                            onConfigurePack={() => setPackModalOpen(true)}
                        />
                        <IngredientStockPanel
                            unit={unit}
                            packSize={packSize}
                            packUnit={packUnit}
                            pack2={pack2}
                            warehouseStock={stockData?.warehouse_stock ?? null}
                            warehouseGroupNote={warehouseGroupNote}
                            hintWarehouse={hintWarehouse}
                            minStock={minStock}
                            hintMinStock={hintMinStock}
                            dailyContext={dailyContext}
                            canEdit={canEdit}
                            onSaveWarehouse={saveWarehouse}
                            onSaveMinStock={saveMinStock}
                        />
                        <IngredientCounterPanel
                            unit={unit}
                            packSize={packSize}
                            packUnit={packUnit}
                            pack2={pack2}
                            tareWeight={tareWeight}
                            hintTare={hintTare}
                            onSaveTareWeight={saveTareWeight}
                            minCounterStock={minCounterStock}
                            onSaveMinCounter={saveMinCounter}
                            counterStock={stockData?.counter_stock ?? null}
                            counterCountedOn={stockData?.counter_counted_on ?? null}
                            counterCountedAt={stockData?.counter_counted_at ?? null}
                            currentStock={currentStock}
                            canEdit={canEdit}
                            onSaveCounter={saveCounter}
                        />
                        <DeleteIngredientButton canEdit={canEdit} onDelete={handleDelete} />
                    </>
                ) : (
                    <IngredientHistoryTab
                        loading={loading}
                        summary={summary}
                        history={shownHistory}
                        unit={unit}
                        packSize={packSize}
                        packUnit={packUnit}
                        pack2={pack2}
                        rangeLabel={rangeLabel}
                        onOpenPayment={canEdit ? setPaymentInvoice : undefined}
                        onCancelRestock={canEdit ? handleCancelRestock : undefined}
                        onEditRestock={canEdit ? setEditingEntry : undefined}
                        addressNameById={groupAddressIds.length > 1 ? addressNameById : null}
                    />
                )}
            </main>

            {filterOpen && (
                <IngredientHistoryFilterSheet
                    onClose={() => setFilterOpen(false)}
                    kind={kindFilter}
                    onKind={setKindFilter}
                    addressNameById={groupAddressIds.length > 1 ? addressNameById : null}
                    addressFilter={addressFilter}
                    onAddressFilter={setAddressFilter}
                />
            )}

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
                    onClose={() => setPackModalOpen(false)}
                    ingredientLabel={titleLabel}
                    baseUnit={unit}
                    currentPackSize={packSize}
                    currentPackUnit={packUnit}
                    currentPack2={pack2}
                    onSave={async (cfg) => {
                        await savePackConfig(cfg)
                        setPackModalOpen(false)
                    }}
                />
            )}

            {restockOpen && (
                <RestockModal
                    ingredient={ingredientKey}
                    unit={unit}
                    packSize={packSize}
                    packUnit={packUnit}
                    pack2={pack2}
                    cashClosedToday={cashClosedToday}
                    onClose={() => setRestockOpen(false)}
                    onConfirm={handleRestock}
                />
            )}

            {editingEntry && (
                <RestockModal
                    ingredient={ingredientKey}
                    unit={unit}
                    packSize={packSize}
                    packUnit={packUnit}
                    pack2={pack2}
                    cashClosedToday={false}
                    mode="edit"
                    initial={restockInitialFrom(editingEntry)}
                    onConfirm={(form) => handleEditRestock(editingEntry, form)}
                    onDelete={() => { setEditingEntry(null); handleCancelRestock(editingEntry) }}
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
