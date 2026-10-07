import { fetchOrdersSince } from './reportService'
import { calculateEstimatedConsumption, estimateCounterRow, orderItemsOf, nextDayStr } from '../utils/inventory'
import { dateStringVN, addDaysVN } from '../utils/dateVN'

// Xa hơn số ngày này thì giữ số đếm thô: tải cả chục nghìn đơn chỉ để ước tính một NVL bỏ quên là không đáng.
const MAX_DAYS = 60

// rows = kết quả fetchIngredientStocks của MỘT địa chỉ. NVL chưa đếm hôm nay thì tồn quầy được nối theo
// lý thuyết (estimateCounterRow). Tiêu hao dùng công thức của địa chỉ đang chọn — chỉ gọi cho địa chỉ đó.
// Lỗi tải đơn → trả số thô (như trước đây), không làm hỏng trang tồn kho.
export async function withCounterEstimate(rows, addressId, { recipes, extraIngredients }) {
    if (!addressId || !rows?.length) return rows
    const today = dateStringVN()
    const floor = dateStringVN(addDaysVN(new Date(), -MAX_DAYS))
    let oldest = null
    for (const r of rows) {
        const on = r.counter_counted_on
        // Quầy + nhập thêm = 0 thì ước tính chắc chắn cũng 0 (kẹp ≥ 0) — không đáng tải đơn cả tháng vì NVL đó.
        if (r.counter_stock + r.restock_since_count <= 0) continue
        if (on && on < today && on >= floor && (!oldest || on < oldest)) oldest = on
    }
    if (!oldest) return rows
    const fromDay = nextDayStr(oldest)
    try {
        const orders = await fetchOrdersSince(addressId, fromDay)
        const itemsByDay = {}
        for (const o of orders) (itemsByDay[dateStringVN(new Date(o.created_at))] ??= []).push(...orderItemsOf(o))
        const usedByDay = Object.fromEntries(
            Object.entries(itemsByDay).map(([day, items]) => [day, calculateEstimatedConsumption(items, recipes, extraIngredients)])
        )
        return rows.map(r => estimateCounterRow(r, usedByDay, { today, fromDay }))
    } catch (err) {
        console.error('withCounterEstimate', err)
        return rows
    }
}
