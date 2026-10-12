import type { Row } from '../types/domain'
import { fetchOrdersSince } from './reportService'
import { fetchStoredUsage, saveUsageDays } from './dailyUsageService'
import { estimateCounterRow, type ExtraIngredients, type RecipeRow, type UsageMap } from '../utils/inventory'
import { missingUsageDays, usageAfterCount, usageByDay } from '../utils/dailyUsage'
import { dateStringVN, addDaysVN, nextDayStr } from '../utils/dateVN'

// Xa hơn số ngày này thì giữ số đếm thô: tải cả chục nghìn đơn chỉ để ước tính một NVL bỏ quên là không đáng.
const MAX_DAYS = 60

interface CounterCalc { recipes: RecipeRow[]; extraIngredients: ExtraIngredients; canPersist: boolean }

// Công thức của địa chỉ = các dòng recipes có address_id đúng địa chỉ đó. Context còn rỗng hoặc đang là của địa chỉ trước
// (vừa đổi địa chỉ) thì chưa dùng được — callers cũng dùng nó làm dep để tính lại khi công thức tải xong.
export const recipesBelongTo = (recipes: Row[], addressId: string | null) => recipes.length > 0 && recipes.every(r => r.address_id === addressId)

// Tiêu hao cho các dòng cần ước tính. Ngày ĐÃ QUA đọc từ daily_ingredient_usage; ngày nào chưa có thì tính từ đơn
// rồi ghi lại (đóng băng — lần sau khỏi tải đơn); HÔM NAY tính trực tiếp từ đơn (bỏ qua khi !includeToday).
// Công thức chưa phải của địa chỉ này → KHÔNG ước tính (số tính từ công thức sai còn tệ hơn số thô). `canPersist` =
// context đã tải xong, mới được ghi số đóng băng. → null nếu không có gì để ước tính. Có thể ném lỗi — caller bắt.
async function loadUsage(rows: Row[], addressId: string, { recipes, extraIngredients, canPersist }: CounterCalc, includeToday: boolean) {
    if (!recipesBelongTo(recipes, addressId)) return null
    const today = dateStringVN()
    const floor = dateStringVN(addDaysVN(new Date(), -MAX_DAYS))
    let oldest: string | null = null
    // Ngày đếm của các dòng có giờ đếm: đơn của ngày đó sau giờ đếm cũng phải trừ (usageAfterCount).
    const stampedDays = new Set<string>()
    for (const r of rows) {
        const on = r.counter_counted_on
        // Quầy + nhập thêm = 0 thì ước tính chắc chắn cũng 0 (kẹp ≥ 0) — không đáng tải đơn cả tháng vì NVL đó.
        if (r.counter_stock + r.restock_since_count <= 0 || !on || on < floor) continue
        if (on < today && (!oldest || on < oldest)) oldest = on
        if (r.counter_counted_at && (on < today || includeToday)) stampedDays.add(on)
    }
    if (!oldest && !stampedDays.size) return null
    const fromDay = oldest ? nextDayStr(oldest) : today
    const [stored, todayOrders] = await Promise.all([
        oldest ? fetchStoredUsage(addressId, fromDay, today) : {},
        includeToday ? fetchOrdersSince(addressId, today) : [],
    ])
    const missing = missingUsageDays(stored, fromDay, today)
    let computed: Record<string, UsageMap> = {}
    if (missing.length) {
        // Chỉ tải đúng khoảng ngày thiếu: hôm nay đã có ở trên, các ngày đã lưu ngoài khoảng khỏi tải lại.
        const window = await fetchOrdersSince(addressId, missing[0], nextDayStr(missing.at(-1)!))
        computed = usageByDay(window, missing, recipes, extraIngredients)
        if (canPersist) saveUsageDays(addressId, computed)
    }
    const used = { ...stored, ...computed }
    if (includeToday) Object.assign(used, usageByDay(todayOrders, [today], recipes, extraIngredients))
    // Ngày đếm trong quá khứ: ngày đó đã đóng băng nguyên ngày nên phần sau giờ đếm phải tính lại từ đơn của riêng ngày đó.
    const ordersByDay: Record<string, Row[]> = {}
    await Promise.all([...stampedDays].map(async day => {
        ordersByDay[day] = day === today ? todayOrders : await fetchOrdersSince(addressId, day, nextDayStr(day))
    }))
    const afterCount = usageAfterCount(rows, ordersByDay, recipes, extraIngredients)
    return { used, today, fromDay, afterCount }
}

// rows = kết quả fetchIngredientStocks của MỘT địa chỉ. NVL chưa đếm hôm nay thì tồn quầy được nối theo lý thuyết
// (estimateCounterRow). Công thức là của địa chỉ đang chọn — chỉ gọi cho địa chỉ đó.
// Lỗi → trả số thô, không làm hỏng trang.
export async function withCounterEstimate(rows: Row[] | null | undefined, addressId: string | null, calc: CounterCalc) {
    if (!addressId || !rows?.length) return rows
    try {
        const usage = await loadUsage(rows, addressId, calc, true)
        return usage ? rows.map(r => estimateCounterRow(r, usage.used, usage)) : rows
    } catch (err) {
        console.error('withCounterEstimate', err)
        return rows
    }
}

// Đầu kỳ HÔM NAY = tồn quầy ước tính cuối hôm qua, tính từ lần đếm gần nhất TRƯỚC hôm nay (prior_* của RPC): cùng công
// thức estimateCounterRow, tiêu hao chỉ tới hết hôm qua. Không phụ thuộc NVL có được đếm hôm nay hay chưa, nên số này
// không đổi khi quản lý đếm Cuối kỳ → hao hụt luôn so với cùng một Đầu kỳ. Đếm đúng hôm qua thì bằng số đếm.
// Trả mọi NVL ước tính được (caller cho nó thắng số trong phiếu gần nhất). → { ingredient: số }
export async function estimateOpeningStocks(rows: Row[] | null | undefined, addressId: string | null | undefined, calc: CounterCalc) {
    if (!addressId || !rows?.length) return {}
    try {
        const priorRows = rows.filter(r => r.prior_counted_on).map(r => ({
            ingredient: r.ingredient, warehouse_stock: r.warehouse_stock,
            counter_stock: r.prior_counter_stock, counter_counted_on: r.prior_counted_on, counter_counted_at: r.prior_counted_at, restock_since_count: r.prior_restock_since,
        }))
        const usage = await loadUsage(priorRows, addressId, calc, false)
        if (!usage) return {}
        const out: UsageMap = {}
        for (const r of priorRows) {
            const e = estimateCounterRow(r, usage.used, usage)
            if (e.counter_estimated) out[r.ingredient] = e.counter_stock
        }
        return out
    } catch (err) {
        console.error('estimateOpeningStocks', err)
        return {}
    }
}
