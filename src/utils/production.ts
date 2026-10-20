import type { Row } from '../types/domain'
import { r1, usedOf, type UsageMap } from './inventory'
import { dateStringVN } from './dateVN'

// Một lần "Sản xuất mẻ" (production_batches, migration 20261027). Tiêu hao RÒNG của nó: nguyên liệu gốc +inputs, thành phẩm
// −output_qty → tồn quầy (= đếm + nhập − tiêu hao) và hao hụt tự đúng mà không cần cột/RPC kho mới.
// Chỉ phủ lên (overlay) tiêu hao đọc từ đơn — KHÔNG đóng băng vào daily_ingredient_usage, nên hủy mẻ là hoàn lại ngay.
export interface ProductionRow { created_at: string; output_ingredient: string; output_qty: number; inputs: Record<string, number>; cancelled_at?: string | null }

const addNet = (map: UsageMap, p: ProductionRow) => {
    for (const [ing, qty] of Object.entries(p.inputs || {})) map[ing] = (map[ing] ?? 0) + Number(qty)
    map[p.output_ingredient] = (map[p.output_ingredient] ?? 0) - Number(p.output_qty)
}
const round = (map: UsageMap): UsageMap => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, r1(v)] as const).filter(([, v]) => v !== 0))

/** Tiêu hao ròng của các mẻ còn hiệu lực (bỏ mẻ đã hủy). */
export function productionUsage(rows: ProductionRow[] = []): UsageMap {
    const out: UsageMap = {}
    for (const p of rows) if (!p.cancelled_at) addNet(out, p)
    return round(out)
}

/** Cộng tiêu hao của mẻ vào tiêu hao từng ngày; ngày không có trong `usedByDay` thì bỏ qua (ngoài khoảng đang tính). */
// createDays: báo cáo muốn thấy cả ngày chỉ có mẻ (không có đơn); ước tính tồn quầy thì KHÔNG (ngoài khoảng đang tính).
export function overlayProduction(usedByDay: Record<string, UsageMap>, rows: ProductionRow[] = [], createDays = false) {
    const byDay: Record<string, ProductionRow[]> = {}
    for (const p of rows) if (!p.cancelled_at) (byDay[dateStringVN(new Date(p.created_at))] ??= []).push(p)
    const out: Record<string, UsageMap> = { ...usedByDay }
    for (const [day, list] of Object.entries(byDay)) {
        if (!createDays && !(day in usedByDay)) continue
        const merged = { ...usedByDay[day] }
        for (const p of list) addNet(merged, p)
        out[day] = round(merged)
    }
    return out
}

/** Tiêu hao ròng của mẻ trong đúng 1 ngày VN ('YYYY-MM-DD'). */
export const productionOnDay = (rows: ProductionRow[] = [], day: string) => productionUsage(rows.filter(p => dateStringVN(new Date(p.created_at)) === day))

/** Phần mẻ SAU giờ đếm của chính ngày đếm (cùng ý với usageAfterCount cho đơn) → { ingredient: ròng }. */
export function productionAfterCount(stockRows: Row[], rows: ProductionRow[] = []): UsageMap {
    const out: UsageMap = {}
    for (const r of stockRows) {
        if (!r.counter_counted_at) continue
        const since = new Date(r.counter_counted_at).getTime()
        const net: UsageMap = {}
        for (const p of rows) {
            if (p.cancelled_at || dateStringVN(new Date(p.created_at)) !== r.counter_counted_on || new Date(p.created_at).getTime() < since) continue
            addNet(net, p)
        }
        const v = usedOf(net, r.ingredient)
        if (v) out[r.ingredient] = v
    }
    return out
}

/** Gộp `a` + `b` theo từng nguyên liệu (dùng cộng afterCount của đơn với của mẻ). */
export const mergeUsage = (a: UsageMap, b: UsageMap): UsageMap => {
    const out = { ...a }
    for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v
    return out
}

