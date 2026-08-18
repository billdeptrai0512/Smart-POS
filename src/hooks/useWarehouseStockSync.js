import { useState, useCallback } from 'react'
import { fetchIngredientStocks } from '../services/orderService'
import { fetchYesterdayShiftClosing } from '../services/reportService'

// Kho tổng (warehouse_stock, hiện tại) + tồn quầy ĐẦU KỲ suy ra từ phiếu chốt
// hôm qua (counter_stock = remaining của hôm qua). Tách khỏi useShiftInventoryState
// vì phần fetch/tính toán này không cần đọc baseline — chỉ TRẢ dữ liệu, caller
// (useShiftInventoryState) tự quyết seed openingInputs/baseline từ `openings`.
//
// `seedReady`/`seedYesterdayClosing` (từ DailyReportPage, xem useShiftInventoryState)
// — khi cha đã fetch sẵn phiếu chốt hôm qua rồi thì dùng thẳng, khỏi tự query trùng.
export function useWarehouseStockSync(addressId, { seedReady, isDayScope, seedYesterdayClosing }) {
    const [warehouseStocks, setWarehouseStocks] = useState({})
    const [openingStock, setOpeningStock] = useState({})

    // addressId === undefined guarded by the sole caller (useShiftInventoryState.reloadStocks)
    // before this is ever invoked — no guard duplicated here.
    const reload = useCallback(() => {
        const yesterdayPromise = seedReady
            ? Promise.resolve(seedYesterdayClosing)
            : isDayScope ? Promise.resolve(undefined) : fetchYesterdayShiftClosing(addressId)
        return Promise.all([
            fetchIngredientStocks(addressId),
            yesterdayPromise,
        ]).then(([rows, yesterdayClosing]) => {
            const warehouses = {}
            ; (rows || []).forEach(r => {
                if (typeof r.warehouse_stock === 'number') warehouses[r.ingredient] = r.warehouse_stock
            })
            setWarehouseStocks(warehouses)

            let yesterdayReport = []
            if (yesterdayClosing && yesterdayClosing.inventory_report) {
                yesterdayReport = yesterdayClosing.inventory_report
                if (typeof yesterdayReport === 'string') {
                    try { yesterdayReport = JSON.parse(yesterdayReport) } catch { yesterdayReport = [] }
                }
            }

            const counters = {}, openings = {}
            if (Array.isArray(yesterdayReport)) {
                yesterdayReport.forEach(item => {
                    if (item && item.ingredient && typeof item.remaining === 'number') {
                        counters[item.ingredient] = item.remaining
                        openings[item.ingredient] = String(item.remaining)
                    }
                })
            }
            setOpeningStock(counters)
            return { openings }
        })
    }, [addressId, seedReady, seedYesterdayClosing, isDayScope])

    return { warehouseStocks, openingStock, reload }
}
