import { useState, useCallback, useEffect, useRef } from 'react'
import { fetchIngredientStocks } from '../services/orderService'
import { estimateOpeningStocks } from '../services/counterEstimate'
import { useCounterCalc } from './useCounterCalc'
import { dateStringVN } from '../utils/dateVN'
import { fetchYesterdayShiftClosing } from '../services/reportService'
import { parseInventoryReport } from '../utils/inventory'

// Kho tổng (warehouse_stock, hiện tại) + tồn quầy ĐẦU KỲ suy ra từ phiếu chốt
// hôm qua (counter_stock = remaining của hôm qua). Tách khỏi useShiftInventoryState
// vì phần fetch/tính toán này không cần đọc baseline — chỉ TRẢ dữ liệu, caller
// (useShiftInventoryState) tự quyết seed openingInputs/baseline từ `counters`.
//
// `seedReady`/`seedYesterdayClosing` (từ DailyReportPage, xem useShiftInventoryState)
// — khi cha đã fetch sẵn phiếu chốt hôm qua rồi thì dùng thẳng, khỏi tự query trùng.
//
// `estimateOpening` (chỉ xem HÔM NAY): NVL hôm qua không có số đếm thì Đầu kỳ = tồn quầy ước tính theo lý thuyết
// (estimateOpeningStocks) thay vì 0. `seedTodayClosing` để trừ phần nhập thêm hôm nay khỏi ước tính — đi qua ref
// để reload không đổi identity mỗi lần phiếu hôm nay đổi (kéo theo tải lại tồn kho).
export function useWarehouseStockSync(addressId, { seedReady, isDayScope, seedYesterdayClosing, seedTodayClosing, estimateOpening }) {
    const [warehouseStocks, setWarehouseStocks] = useState({})
    const [openingStock, setOpeningStock] = useState({})
    const calcRef = useCounterCalc()
    const todayClosingRef = useRef(seedTodayClosing)
    useEffect(() => { todayClosingRef.current = seedTodayClosing })

    // addressId === undefined guarded by the sole caller (useShiftInventoryState.reloadStocks)
    // before this is ever invoked — no guard duplicated here.
    const reload = useCallback(() => {
        const yesterdayPromise = seedReady
            ? Promise.resolve(seedYesterdayClosing)
            : isDayScope ? Promise.resolve(undefined) : fetchYesterdayShiftClosing(addressId)
        return Promise.all([
            fetchIngredientStocks(addressId),
            yesterdayPromise,
        ]).then(async ([rows, yesterdayClosing]) => {
            const warehouses = {}
            ; (rows || []).forEach(r => {
                if (typeof r.warehouse_stock === 'number') warehouses[r.ingredient] = r.warehouse_stock
            })
            setWarehouseStocks(warehouses)

            const counters = {}
            ;(parseInventoryReport(yesterdayClosing?.inventory_report) || []).forEach(item => {
                if (item && item.ingredient && typeof item.remaining === 'number') counters[item.ingredient] = item.remaining
            })
            if (estimateOpening) {
                const today = todayClosingRef.current
                const isToday = today?.closed_at && dateStringVN(new Date(today.closed_at)) === dateStringVN()
                const estimates = await estimateOpeningStocks(rows, addressId, calcRef.current, isToday ? today : null)
                for (const [ingredient, value] of Object.entries(estimates)) if (!(ingredient in counters)) counters[ingredient] = value
            }
            setOpeningStock(counters)
            return { counters }
        })
    }, [addressId, seedReady, seedYesterdayClosing, isDayScope, estimateOpening, calcRef])

    return { warehouseStocks, openingStock, reload }
}
