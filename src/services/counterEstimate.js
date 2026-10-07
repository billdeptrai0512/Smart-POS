import { fetchOrdersSince } from './reportService'
import { fetchStoredUsage, saveUsageDays } from './dailyUsageService'
import { estimateCounterRow, parseInventoryReport } from '../utils/inventory'
import { missingUsageDays, usageByDay } from '../utils/dailyUsage'
import { dateStringVN, addDaysVN, nextDayStr } from '../utils/dateVN'

// Xa hơn số ngày này thì giữ số đếm thô: tải cả chục nghìn đơn chỉ để ước tính một NVL bỏ quên là không đáng.
const MAX_DAYS = 60

// Tiêu hao cho các dòng cần ước tính. Ngày ĐÃ QUA đọc từ daily_ingredient_usage; ngày nào chưa có thì tính từ đơn
// rồi ghi lại (đóng băng — lần sau khỏi tải đơn); HÔM NAY tính trực tiếp từ đơn (bỏ qua khi !includeToday).
// Công thức của địa chỉ = các dòng recipes có address_id đúng địa chỉ đó: context còn rỗng hoặc đang là của địa chỉ
// trước (vừa đổi địa chỉ) thì KHÔNG ước tính — số tính từ công thức sai còn tệ hơn số thô. `canPersist` = context
// đã tải xong, mới được ghi số đóng băng. → null nếu không có gì để ước tính. Có thể ném lỗi — caller bắt.
async function loadUsage(rows, addressId, { recipes, extraIngredients, canPersist }, includeToday) {
    if (!recipes.length || !recipes.every(r => r.address_id === addressId)) return null
    const today = dateStringVN()
    const floor = dateStringVN(addDaysVN(new Date(), -MAX_DAYS))
    let oldest = null
    for (const r of rows) {
        const on = r.counter_counted_on
        // Quầy + nhập thêm = 0 thì ước tính chắc chắn cũng 0 (kẹp ≥ 0) — không đáng tải đơn cả tháng vì NVL đó.
        if (r.counter_stock + r.restock_since_count <= 0) continue
        if (on && on < today && on >= floor && (!oldest || on < oldest)) oldest = on
    }
    if (!oldest) return null
    const fromDay = nextDayStr(oldest)
    const [stored, todayOrders] = await Promise.all([
        fetchStoredUsage(addressId, fromDay, today),
        includeToday ? fetchOrdersSince(addressId, today) : [],
    ])
    const missing = missingUsageDays(stored, fromDay, today)
    let computed = {}
    if (missing.length) {
        // Chỉ tải đúng khoảng ngày thiếu: hôm nay đã có ở trên, các ngày đã lưu ngoài khoảng khỏi tải lại.
        const window = await fetchOrdersSince(addressId, missing[0], nextDayStr(missing.at(-1)))
        computed = usageByDay(window, missing, recipes, extraIngredients)
        if (canPersist) saveUsageDays(addressId, computed)
    }
    const used = { ...stored, ...computed }
    if (includeToday) Object.assign(used, usageByDay(todayOrders, [today], recipes, extraIngredients))
    return { used, today, fromDay }
}

// rows = kết quả fetchIngredientStocks của MỘT địa chỉ. NVL chưa đếm hôm nay thì tồn quầy được nối theo lý thuyết
// (estimateCounterRow). Công thức là của địa chỉ đang chọn — chỉ gọi cho địa chỉ đó.
// Lỗi → trả số thô, không làm hỏng trang.
export async function withCounterEstimate(rows, addressId, calc) {
    if (!addressId || !rows?.length) return rows
    try {
        const usage = await loadUsage(rows, addressId, calc, true)
        return usage ? rows.map(r => estimateCounterRow(r, usage.used, usage)) : rows
    } catch (err) {
        console.error('withCounterEstimate', err)
        return rows
    }
}

// Đầu kỳ HÔM NAY = tồn quầy ước tính cuối hôm qua. Cùng công thức, nhưng bỏ tiêu hao hôm nay và trừ phần nhập thêm
// hôm nay (restock_since_count có cả phiếu hôm nay) — todayClosing phải là phiếu của ĐÚNG hôm nay (hoặc null).
// Trả mọi NVL ước tính được; caller chỉ dùng cho NVL mà hôm qua KHÔNG có số đếm. → { ingredient: số }
export async function estimateOpeningStocks(rows, addressId, calc, todayClosing) {
    if (!addressId || !rows?.length) return {}
    try {
        const usage = await loadUsage(rows, addressId, calc, false)
        if (!usage) return {}
        const todayRestock = {}
        for (const it of parseInventoryReport(todayClosing?.inventory_report) || []) {
            if (it?.ingredient) todayRestock[it.ingredient] = it.restock || 0
        }
        const out = {}
        for (const r of rows) {
            const e = estimateCounterRow({ ...r, restock_since_count: r.restock_since_count - (todayRestock[r.ingredient] || 0) }, usage.used, usage)
            if (e.counter_estimated) out[r.ingredient] = e.counter_stock
        }
        return out
    } catch (err) {
        console.error('estimateOpeningStocks', err)
        return {}
    }
}
