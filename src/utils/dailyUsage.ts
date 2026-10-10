import type { Row } from '../types/domain'
import { calculateEstimatedConsumption, isLiveOrder, orderItemsOf, type ExtraIngredients, type RecipeRow } from './inventory'
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
