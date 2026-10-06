import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useHistory } from '../contexts/HistoryContext'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './useToast'
import { useShiftInventoryState } from './useShiftInventoryState'
import { fetchLastWeekSameDayOrderItems } from '../services/reportService'
import { getPendingOrders } from './useOfflineSync'
import { calculateEstimatedConsumption, orderItemsOf, isLiveOrder, averageIngredientMaps, r1 } from '../utils/inventory'
import {
    buildPrepTodayList, buildDepletedList, mergePrepItems, isPrepDone, isPrepFilled,
    buildWarehousePrepList, buildTodayBoughtMap, HISTORY_OFFSETS_TODAY, HISTORY_OFFSETS_TOMORROW,
} from '../utils/prepToday'
import { ingredientLabel } from '../utils/ingredients'
import { isSameDayVN, dateStringVN } from '../utils/dateVN'

// Notice dữ liệu ở đỉnh /pos ("Chuẩn bị hôm nay") và /ingredients ("Bổ sung tồn kho"): danh sách tính
// TRỰC TIẾP theo đơn đang bán, ghi xuống qua đúng đường của /daily-report (useShiftInventoryState.
// pushInventory — merge RPC theo delta, Realtime) nên 2 máy không đè nhau. Mỗi hook chỉ mount ở trang
// của mình — cùng lúc không bao giờ có 2 instance (3 trang là 3 route khác nhau).

// Ảnh chụp kết quả tính gần nhất theo (loại, địa chỉ, ngày). Vào lại trang thì dải hiện NGAY từ ảnh chụp
// (stale-while-revalidate) thay vì đợi ~8 request mới có số — dải khỏi nháy vào/ra và khỏi đẩy nội dung trang xuống
// muộn; tính xong (`ready`) thì thay bằng số thật. Chỉ để HIỂN THỊ: thao tác ghi vẫn chờ `ready`.
// ponytail: Map module-level, không persist qua reload; quá hạn thì bỏ — nâng lên localStorage nếu cần cả lúc mở app.
const SNAPSHOT_TTL_MS = 10 * 60_000
const snapshots = new Map()
function useSnapshot(kind, live, ready) {
    const { selectedAddress } = useAddress()
    const key = `${kind}|${selectedAddress.id}|${dateStringVN()}`
    useEffect(() => { if (ready) snapshots.set(key, { live, t: Date.now() }) })
    // Chỉ đọc ảnh chụp lúc mount (đó là lúc cần nó); đổi địa chỉ/ngày giữa chừng (key khác) thì không dùng ảnh của key cũ.
    const [seed] = useState(() => {
        const s = snapshots.get(key)
        return s && Date.now() - s.t <= SNAPSHOT_TTL_MS ? { key, live: s.live } : null
    })
    return ready || seed?.key !== key ? live : seed.live
}

// Phần chung: nạp đơn hôm nay + dự báo cùng thứ 3 tuần trước + trạng thái kiểm kê, và báo `ready`.
function useShiftPrepBase(offsets) {
    const { selectedAddress } = useAddress()
    const { recipes, extraIngredients, ingredientConfigs } = useProducts()
    const { todayOrders, todayExpenses, handleLoadHistory } = useHistory()
    const { toast, showToast, showError } = useToast()
    const todayISO = dateStringVN()

    const onConflict = useCallback((ingredient) => {
        showToast(`${ingredientLabel(ingredient)}: vừa được cập nhật từ máy khác, kiểm tra lại`, 'warning')
    }, [showToast])
    // Danh mục NVL lấy từ ProductContext (đã nạp sẵn) — khỏi fetch lại ingredient_costs/ingredient_groups mỗi lần vào trang.
    const inventory = useShiftInventoryState(selectedAddress.id, selectedAddress.ingredient_sort_order, todayISO, onConflict, undefined, { ingredientRows: ingredientConfigs })

    // Các trang này KHÔNG tự nạp đơn hôm nay (chỉ /history, /daily-report nạp) — không nạp thì usedMap
    // thiếu cả đơn đã bán trước khi mở máy ⇒ Lý thuyết sai, và systemTotalRevenue (chụp vào phiếu chốt khi
    // push tạo phiếu mới) thiếu. Nạp hỏng ⇒ không tính gì (ready=false) thay vì tính trên dữ liệu thiếu.
    const [historyOk, setHistoryOk] = useState(false)
    useEffect(() => {
        let alive = true
        Promise.resolve(handleLoadHistory()).then(ok => { if (alive) setHistoryOk(ok !== false) })
        return () => { alive = false }
        // handleLoadHistory đổi identity mỗi render (hàm thường trong POSContext) — chỉ nạp lại khi đổi địa chỉ/ngày.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAddress.id, todayISO])

    // Dự báo cùng thứ — service cache theo address+offset+day nên mở lại trang rẻ. Tải hỏng thì service ném lỗi
    // (không cache) → weeks giữ null → ready=false: thà không báo còn hơn báo trên "lịch sử rỗng" giả.
    const [weeks, setWeeks] = useState(null)
    useEffect(() => {
        let alive = true
        Promise.all(offsets.map(d => fetchLastWeekSameDayOrderItems(selectedAddress.id, d)))
            .then(w => { if (alive) setWeeks(w) })
            .catch(() => {})
        return () => { alive = false }
        // offsets là hằng số module của từng hook.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAddress.id, todayISO])

    // Đơn hôm nay (online + chờ đồng bộ). todayOrders đổi mỗi đơn mới → usedMap tính lại.
    const offlineToday = useMemo(
        () => getPendingOrders().filter(o => isSameDayVN(new Date(o.createdAt), new Date())),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [todayOrders])
    const liveOrders = useMemo(() => [...todayOrders, ...offlineToday].filter(isLiveOrder), [todayOrders, offlineToday])
    const usedMap = useMemo(
        () => calculateEstimatedConsumption(liveOrders.flatMap(orderItemsOf), recipes, extraIngredients),
        [liveOrders, recipes, extraIngredients])
    const systemTotalRevenue = useMemo(() => liveOrders.reduce((sum, o) => sum + (o.total || 0), 0), [liveOrders])
    const forecastMap = useMemo(
        () => averageIngredientMaps((weeks || []).map(items => calculateEstimatedConsumption(
            items.map(i => ({ productId: i.product_id, qty: i.quantity, extras: (i.extra_ids || []).map(id => ({ id })) })),
            recipes, extraIngredients))),
        [weeks, recipes, extraIngredients])

    // Chưa tải xong thì mọi map rỗng ⇒ NVL nào cũng trông "chưa soạn" ⇒ notice nháy sai. Chờ đủ.
    const ready = historyOk && weeks !== null && inventory.closingLoaded && inventory.stocksLoaded && !inventory.isLoadingIngredients
    const common = {
        ingredientsList: inventory.ingredientsList, openingInputs: inventory.openingInputs, openingStock: inventory.openingStock,
        warehouseStocks: inventory.warehouseStocks, usedMap,
    }
    return { inventory, ready, common, forecastMap, usedMap, systemTotalRevenue, todayExpenses, toast, showToast, showError, handleLoadHistory }
}

// /pos — "Chuẩn bị hôm nay": NVL cần lấy từ kho dự trữ ra quầy (soạn sáng nay chưa xong, hoặc Lý thuyết ở
// quầy đã về 0 giữa ca). Nhân viên xác nhận ngay trong modal → ghi vào Nhập thêm (restock) của ca.
export function usePrepNotice() {
    const { profile } = useAuth()
    const { inventory, ready, common, forecastMap, systemTotalRevenue, toast, showToast, showError } = useShiftPrepBase(HISTORY_OFFSETS_TODAY)
    const { restockInputs, skipped } = inventory

    const items = useMemo(() => {
        if (!ready) return []
        return mergePrepItems(
            buildPrepTodayList({ ...common, lastWeekUsedMap: forecastMap }),
            buildDepletedList({ ...common, restockInputs, inventoryInputs: inventory.inventoryInputs, skipped, effectiveWarehouseStocks: inventory.effectiveWarehouseStocks }),
            restockInputs)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, common.ingredientsList, common.openingInputs, common.openingStock, common.warehouseStocks, common.usedMap,
        inventory.effectiveWarehouseStocks, inventory.inventoryInputs, forecastMap, restockInputs, skipped])

    const checked = useMemo(
        () => Object.fromEntries(items.map(it => [it.ingredient, isPrepDone(it, restockInputs, skipped)])),
        [items, restockInputs, skipped])
    const pendingCount = items.filter(it => !checked[it.ingredient]).length
    const view = useSnapshot('pos', { items, checked, skipped, pendingCount }, ready)

    // Autosave debounce — cùng kiểu triggerAutoSave của /daily-report: gom nhiều tick thành 1 lần đẩy,
    // ref luôn trỏ bản mới nhất để timer đọc đúng state hiện tại.
    const pushRef = useRef(null)
    const timerRef = useRef(null)
    pushRef.current = async () => {
        if (!inventory.isDirty) return
        if (inventory.restockOverflowIngredients.length > 0) {
            showToast('Số lấy ra vượt kho dự trữ — nhập kho trước', 'error')
            return
        }
        try {
            const row = await inventory.pushInventory(profile?.id, systemTotalRevenue)
            if (row) await inventory.reloadStocks() // kho dự trữ đã trừ → số "Tồn kho" trong modal tươi lại
        } catch (err) {
            showError(err, 'Lưu nhập thêm từ kho')
        }
    }
    const schedulePush = useCallback(() => {
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => pushRef.current?.(), 450)
    }, [])
    // Rời trang trong lúc timer chờ → đẩy NGAY thay vì bỏ (nếu bỏ, lần xác nhận vừa bấm mất im lặng).
    useEffect(() => () => {
        if (timerRef.current) { clearTimeout(timerRef.current); pushRef.current?.() }
    }, [])

    // Xác nhận "đã lấy từ kho ra quầy". Món sáng nay: tick/untick như /daily-report (đổ số quy đổi nguyên
    // bịch, kẹp theo kho). Món đã hết giữa ca: CỘNG THÊM 1 lần vào Nhập thêm (không bỏ tick — Lý thuyết
    // > 0 lại thì tự rớt khỏi danh sách).
    const confirmPrep = useCallback((ingredient) => {
        const it = items.find(i => i.ingredient === ingredient)
        if (!it) return
        const filled = isPrepFilled(restockInputs[ingredient])
        const noStock = () => showToast(`${ingredientLabel(ingredient)}: kho dự trữ đã hết, nhập kho trước`, 'error')
        let next
        if (it.kind === 'depleted') {
            if (it.fillQty <= 0) return noStock()
            next = r1(Number(restockInputs[ingredient] || 0) + it.fillQty)
        } else {
            const fill = it.warehouse != null ? Math.min(it.fillQty, it.warehouse) : it.fillQty
            if (!filled && !(fill > 0)) return noStock()
            next = filled ? '' : fill
        }
        inventory.onRestockChange(ingredient, String(next))
        if (next !== '' && skipped[ingredient]) inventory.onSkipToggle(ingredient, false) // nhập thêm ⇄ bỏ qua loại trừ nhau
        schedulePush()
    }, [items, restockInputs, skipped, inventory, schedulePush, showToast])

    const toggleSkip = useCallback((ingredient) => {
        const willSkip = !skipped[ingredient]
        inventory.onSkipToggle(ingredient, willSkip)
        if (willSkip && isPrepFilled(restockInputs[ingredient])) inventory.onRestockChange(ingredient, '')
        schedulePush()
    }, [skipped, restockInputs, inventory, schedulePush])

    return { ...view, ready, confirmPrep, toggleSkip, toast }
}

// /ingredients — "Bổ sung tồn kho": NVL cần MUA thêm cho ngày mai. Mua qua RestockModal của caller (không
// ghi restock ở đây) nên chỉ trả danh sách + hàm tươi lại sau khi mua.
export function useWarehousePrep() {
    const { inventory, ready, common, forecastMap, todayExpenses, toast, handleLoadHistory } = useShiftPrepBase(HISTORY_OFFSETS_TOMORROW)

    const items = useMemo(() => {
        if (!ready) return []
        return buildWarehousePrepList({
            ...common, effectiveWarehouseStocks: inventory.effectiveWarehouseStocks, restockInputs: inventory.restockInputs,
            inventoryInputs: inventory.inventoryInputs, nextDowUsedMap: forecastMap, todayBoughtMap: buildTodayBoughtMap(todayExpenses),
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, todayExpenses, common.ingredientsList, common.openingInputs, common.openingStock, common.warehouseStocks, common.usedMap,
        inventory.effectiveWarehouseStocks, inventory.restockInputs, inventory.inventoryInputs, forecastMap])

    // Sau khi mua/nhập kho: tươi lại tồn kho + danh sách NVL của hook để danh sách tính lại.
    const reload = useCallback(
        () => Promise.all([inventory.reloadStocks?.(), inventory.reloadIngredients?.(), handleLoadHistory()]),
        [inventory, handleLoadHistory])

    const view = useSnapshot('warehouse', { items }, ready)

    return { items: view.items, ready, ingredientsList: inventory.ingredientsList, warehouseStocks: inventory.warehouseStocks, reload, toast }
}
