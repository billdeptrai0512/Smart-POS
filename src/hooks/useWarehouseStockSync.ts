import { useState, useCallback } from 'react'
import { fetchIngredientStocks } from '../services/orderService'
import { estimateOpeningStocks, recipesBelongTo } from '../services/counterEstimate'
import { useCounterCalc } from './useCounterCalc'
import { useProducts } from '../contexts/ProductContext'
import { fetchYesterdayShiftClosing } from '../services/reportService'
import { parseInventoryReport, type UsageMap } from '../utils/inventory'
import type { Row } from '../types/domain'

// Kho tổng (warehouse_stock, hiện tại) + tồn quầy ĐẦU KỲ suy ra từ phiếu chốt
// hôm qua (counter_stock = remaining của hôm qua). Tách khỏi useShiftInventoryState
// vì phần fetch/tính toán này không cần đọc baseline — chỉ TRẢ dữ liệu, caller
// (useShiftInventoryState) tự quyết seed openingInputs/baseline từ `counters`.
//
// `seedReady`/`seedYesterdayClosing` (từ DailyReportPage, xem useShiftInventoryState)
// — khi cha đã fetch sẵn phiếu chốt hôm qua rồi thì dùng thẳng, khỏi tự query trùng.
//
// `estimateOpening` (chỉ xem HÔM NAY): Đầu kỳ = tồn quầy ước tính theo lý thuyết (estimateOpeningStocks) thay vì số
// remaining của phiếu gần nhất (có thể là 0 nếu NVL không đếm, hoặc số cũ nếu phiếu cách vài ngày).
export function useWarehouseStockSync(addressId: string | null | undefined, { seedReady, isDayScope, seedYesterdayClosing, estimateOpening }: {
    seedReady?: boolean; isDayScope?: boolean; seedYesterdayClosing?: Row | null; estimateOpening?: boolean
}) {
    const [warehouseStocks, setWarehouseStocks] = useState<UsageMap>({})
    const [openingStock, setOpeningStock] = useState<UsageMap>({})
    const calcRef = useCounterCalc()
    // Công thức tải xong sau lần reload đầu → reload đổi identity để tính lại Đầu kỳ ước tính (xem recipesBelongTo).
    const recipesReady = recipesBelongTo(useProducts().recipes, addressId)

    // addressId === undefined guarded by the sole caller (useShiftInventoryState.reloadStocks)
    // before this is ever invoked — no guard duplicated here.
    const reload = useCallback(() => {
        const yesterdayPromise = seedReady
            ? Promise.resolve(seedYesterdayClosing)
            : isDayScope ? Promise.resolve(undefined) : fetchYesterdayShiftClosing(addressId ?? null)
        return Promise.all([
            fetchIngredientStocks(addressId ?? null),
            yesterdayPromise,
        ]).then(async ([rows, yesterdayClosing]) => {
            const warehouses: UsageMap = {}
            ; (rows || []).forEach((r: Row) => {
                if (typeof r.warehouse_stock === 'number') warehouses[r.ingredient] = r.warehouse_stock
            })
            setWarehouseStocks(warehouses)

            const counters: UsageMap = {}
            ;(parseInventoryReport(yesterdayClosing?.inventory_report) || []).forEach(item => {
                if (item && item.ingredient && typeof item.remaining === 'number') counters[item.ingredient] = item.remaining
            })
            // Ước tính thắng số trong phiếu: "phiếu hôm qua" là phiếu GẦN NHẤT trước hôm nay (có thể cách vài ngày); ước tính
            // tính từ lần đếm thật cuối + nhập thêm − tiêu hao các ngày đã qua, và đếm hôm qua thì hai số trùng nhau.
            if (estimateOpening && recipesReady) Object.assign(counters, await estimateOpeningStocks(rows, addressId, calcRef.current))
            setOpeningStock(counters)
            return { counters }
        })
    }, [addressId, seedReady, seedYesterdayClosing, isDayScope, estimateOpening, calcRef, recipesReady])

    return { warehouseStocks, openingStock, reload }
}
