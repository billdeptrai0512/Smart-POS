import { fetchOrdersSince } from './reportService'
import { fetchStoredUsage, saveUsageDays } from './dailyUsageService'
import { estimateCounterRow } from '../utils/inventory'
import { missingUsageDays, usageByDay } from '../utils/dailyUsage'
import { dateStringVN, addDaysVN, nextDayStr } from '../utils/dateVN'

// Xa hơn số ngày này thì giữ số đếm thô: tải cả chục nghìn đơn chỉ để ước tính một NVL bỏ quên là không đáng.
const MAX_DAYS = 60

// rows = kết quả fetchIngredientStocks của MỘT địa chỉ. NVL chưa đếm hôm nay thì tồn quầy được nối theo
// lý thuyết (estimateCounterRow). Tiêu hao các ngày ĐÃ QUA đọc từ daily_ingredient_usage; ngày nào chưa có
// thì tính từ đơn rồi ghi lại (đóng băng — lần sau khỏi tải đơn); HÔM NAY luôn tính trực tiếp.
// Công thức là của địa chỉ đang chọn — chỉ gọi cho địa chỉ đó. `canPersist` = context công thức đã tải xong
// (không thì có thể đang là công thức cũ/rỗng và sẽ bị đóng băng sai). Lỗi → trả số thô, không làm hỏng trang.
export async function withCounterEstimate(rows, addressId, { recipes, extraIngredients, canPersist }) {
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
        const [stored, todayOrders] = await Promise.all([
            fetchStoredUsage(addressId, fromDay, today),
            fetchOrdersSince(addressId, today),
        ])
        const missing = missingUsageDays(stored, fromDay, today)
        let computed = {}
        if (missing.length) {
            // Chỉ tải đúng khoảng ngày thiếu: hôm nay đã có ở trên, các ngày đã lưu ngoài khoảng khỏi tải lại.
            const window = await fetchOrdersSince(addressId, missing[0], nextDayStr(missing.at(-1)))
            computed = usageByDay(window, missing, recipes, extraIngredients)
            const recipesAreThisAddress = recipes.length > 0 && recipes.every(r => r.address_id === addressId)
            if (canPersist && recipesAreThisAddress) saveUsageDays(addressId, computed)
        }
        const used = { ...stored, ...computed, ...usageByDay(todayOrders, [today], recipes, extraIngredients) }
        return rows.map(r => estimateCounterRow(r, used, { today, fromDay }))
    } catch (err) {
        console.error('withCounterEstimate', err)
        return rows
    }
}
