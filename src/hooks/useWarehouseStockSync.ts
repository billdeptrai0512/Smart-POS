import { useState, useCallback, useRef } from 'react'
import { fetchIngredientStocks } from '../services/orderService'
import { estimateOpening, recipesBelongTo, type OpeningPeriods, type OpeningNotes } from '../services/counterEstimate'
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
// `estimateOpening` (chỉ xem HÔM NAY): Đầu kỳ = tồn quầy ước tính theo lý thuyết (estimateOpening) thay vì số
// remaining của phiếu gần nhất (có thể là 0 nếu NVL không đếm, hoặc số cũ nếu phiếu cách vài ngày).
export function useWarehouseStockSync(addressId: string | null, { seedReady, isDayScope, seedYesterdayClosing, estimateOpening: estimateOpeningOn }: {
    seedReady?: boolean; isDayScope?: boolean; seedYesterdayClosing?: Row | null; estimateOpening?: boolean
}) {
    const [warehouseStocks, setWarehouseStocks] = useState<UsageMap>({})
    const [openingStock, setOpeningStock] = useState<UsageMap>({})
    const [openingPeriods, setOpeningPeriods] = useState<OpeningPeriods>({})
    const [openingNotes, setOpeningNotes] = useState<OpeningNotes>({})
    const calcRef = useCounterCalc()
    // Công thức tải xong sau lần reload đầu → reload đổi identity để tính lại Đầu kỳ ước tính (xem recipesBelongTo).
    const recipesReady = recipesBelongTo(useProducts().recipes, addressId)

    // Bắn RPC tồn kho SỚM (song song với lúc cha còn chờ phiếu chốt); reload kế tiếp dùng đúng lượt này 1 lần — khỏi nối tiếp.
    const early = useRef<{ id: string | null; p: ReturnType<typeof fetchIngredientStocks> } | null>(null)
    const prefetch = useCallback(() => {
        const p = fetchIngredientStocks(addressId)
        p.catch(() => {}) // lỗi để reload xử lý như cũ
        early.current = { id: addressId, p }
    }, [addressId])

    const reload = useCallback(() => {
        const e = early.current
        early.current = null
        const yesterdayPromise = seedReady
            ? Promise.resolve(seedYesterdayClosing)
            : isDayScope ? Promise.resolve(undefined) : fetchYesterdayShiftClosing(addressId)
        return Promise.all([
            e && e.id === addressId ? e.p : fetchIngredientStocks(addressId),
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
            const { stocks, periods, notes } = estimateOpeningOn && recipesReady ? await estimateOpening(rows, addressId, calcRef.current) : { stocks: {}, periods: {}, notes: {} }
            Object.assign(counters, stocks)
            setOpeningPeriods(periods)
            setOpeningNotes(notes)
            setOpeningStock(counters)
            return { counters }
        })
    }, [addressId, seedReady, seedYesterdayClosing, isDayScope, estimateOpeningOn, calcRef, recipesReady])

    return { warehouseStocks, openingStock, openingPeriods, openingNotes, reload, prefetch }
}
