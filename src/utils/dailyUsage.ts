import type { Row } from '../types/domain'
import { calculateEstimatedConsumption, isLiveOrder, orderItemsOf, usedOf, type ExtraIngredients, type RecipeRow, type UsageMap } from './inventory'
import { dateStringVN, nextDayStr } from './dateVN'

// Các ngày VN ĐÃ QUA trong [fromDay, today) chưa có dòng lưu (daily_ingredient_usage) — cần tính
// và ghi lần này. Hôm nay luôn bị loại: còn chạy nên không bao giờ lưu.
// stored: { 'YYYY-MM-DD': usageMap } (các dòng đã đọc từ DB)
export function missingUsageDays(stored: Row, fromDay: string, today: string) {
    const out: string[] = []
    for (let day = fromDay; day < today; day = nextDayStr(day)) if (!(day in stored)) out.push(day)
    return out
}

// Tiêu hao từng ngày trong `days` tính từ đơn (đơn ngoài `days` hoặc đã xoá bị bỏ qua).
// Mọi ngày trong `days` đều có entry, kể cả {} khi không có đơn: dòng rỗng vẫn phải lưu, nếu
// không ngày đó mãi bị coi là "chưa tính" và lần nào mở trang cũng tải đơn lại.
// → { 'YYYY-MM-DD': { ingredient: usedAmount } }
export function usageByDay(orders: Row[], days: string[], recipes: RecipeRow[], extraIngredients: ExtraIngredients) {
    const itemsByDay = Object.fromEntries(days.map(day => [day, [] as Row[]]))
    for (const o of orders) {
        if (!isLiveOrder(o)) continue
        const items = itemsByDay[dateStringVN(new Date(o.created_at))]
        if (items) items.push(...orderItemsOf(o))
    }
    return Object.fromEntries(days.map(day => [day, calculateEstimatedConsumption(itemsByDay[day], recipes, extraIngredients)]))
}

// Tiêu hao của từng NVL trong chính ngày đếm, chỉ tính các đơn tạo SAU giờ đếm của nó (`counter_counted_at`).
// ordersByDay: { 'YYYY-MM-DD': đơn của ngày đó } — chỉ cần ngày đếm của các dòng có giờ đếm.
// → { ingredient: usedAmount }
export function usageAfterCount(rows: Row[], ordersByDay: Record<string, Row[]>, recipes: RecipeRow[], extraIngredients: ExtraIngredients) {
    const perDay: Record<string, { at: number; used: UsageMap }[]> = {}
    const out: UsageMap = {}
    for (const r of rows) {
        const day = r.counter_counted_on
        if (!r.counter_counted_at || !ordersByDay[day]) continue
        perDay[day] ??= ordersByDay[day].filter(isLiveOrder).map(o => ({
            at: new Date(o.created_at).getTime(),
            used: calculateEstimatedConsumption(orderItemsOf(o), recipes, extraIngredients),
        }))
        const since = new Date(r.counter_counted_at).getTime()
        out[r.ingredient] = perDay[day].reduce((sum, o) => (o.at >= since ? sum + usedOf(o.used, r.ingredient) : sum), 0)
    }
    return out
}
