import type { CartExtra } from '../types/domain'
import { r1, type ExtraIngredients, type ExtraIngRow, type RecipeRow } from './inventory'

export interface SuggestedItem { ingredient: string; amount: number; unit: string }
export interface ExtraSuggestion { name: string; price: number; /** số món của quán đang dùng tùy chọn này */ count: number; items: SuggestedItem[] }

interface Input {
    productId: string
    /** Món theo đúng thứ tự menu; divider (is_divider) mở danh mục mới. */
    products: { id: string; is_divider?: boolean | null }[]
    extrasByProduct: Record<string, CartExtra[]>
    extraIngs: ExtraIngredients
    recipes: RecipeRow[]
}

const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Gợi ý tùy chọn cho 1 món, HỌC từ các tùy chọn quán đã có ở món khác — không biết gì về loại món (nước hay đồ ăn).
// Với mỗi tên tùy chọn có ở ≥2 món: giá = trung vị CHỌN 1 giá có thật (không lấy trung bình hai giá); từng nguyên liệu của tùy chọn:
//  · món nguồn đã dùng nguyên liệu đó (tùy chọn chỉnh lượng, vd. Lớn × cà phê) → quy theo TỈ LỆ × định lượng món này
//    (món này không dùng nguyên liệu đó thì bỏ qua);
//  · món nguồn chưa có (tùy chọn THÊM nguyên liệu: thêm đường, thêm trứng, đổi ly…) → chép LƯỢNG TUYỆT ĐỐI (trung vị),
//    kể cả khi món này chưa dùng nguyên liệu đó.
// Ưu tiên mẫu từ món cùng danh mục (≥2 món), thiếu thì lấy cả quán.
export function suggestExtras({ productId, products, extrasByProduct, extraIngs, recipes }: Input): ExtraSuggestion[] {
    const catOf = new Map<string, string>()
    let cat = ''
    for (const p of products) { if (p.is_divider) cat = p.id; else catOf.set(p.id, cat) }

    const base = new Map<string, Map<string, number>>()
    for (const r of recipes) {
        if (!base.has(r.product_id)) base.set(r.product_id, new Map())
        base.get(r.product_id)!.set(r.ingredient, r.amount)
    }
    const mine = base.get(productId) ?? new Map<string, number>()
    const have = new Set((extrasByProduct[productId] || []).map(e => e.name.trim().toLowerCase()))

    type Occ = { productId: string; price: number; ings: ExtraIngRow[]; sameCat: boolean }
    const groups = new Map<string, { name: string; occs: Occ[] }>()
    for (const p of products) {
        if (p.is_divider || p.id === productId) continue
        for (const e of extrasByProduct[p.id] || []) {
            const key = e.name.trim().toLowerCase()
            if (!key || have.has(key)) continue
            const g = groups.get(key) ?? { name: e.name.trim(), occs: [] }
            g.occs.push({ productId: p.id, price: e.price, ings: extraIngs[e.id] || [], sameCat: catOf.get(p.id) === catOf.get(productId) })
            groups.set(key, g)
        }
    }

    const out: ExtraSuggestion[] = []
    for (const g of groups.values()) {
        const n = new Set(g.occs.map(o => o.productId)).size
        if (n < 2) continue
        const same = g.occs.filter(o => o.sameCat)
        const src = same.length >= 2 ? same : g.occs

        const byIng = new Map<string, { o: Occ; i: ExtraIngRow }[]>()
        for (const o of src) for (const i of o.ings) {
            if (!byIng.has(i.ingredient)) byIng.set(i.ingredient, [])
            byIng.get(i.ingredient)!.push({ o, i })
        }

        const items: SuggestedItem[] = []
        for (const [ingredient, rows] of byIng) {
            const bOf = (r: { o: Occ }) => base.get(r.o.productId)?.get(ingredient) ?? 0
            const scaled = rows.filter(r => bOf(r) > 0) // món nguồn đã dùng nguyên liệu này → tùy chọn chỉnh lượng (theo tỉ lệ)
            const added = rows.filter(r => bOf(r) <= 0) // món nguồn chưa có → tùy chọn THÊM nguyên liệu (lượng tuyệt đối)
            const m = mine.get(ingredient) ?? 0
            let amount: number
            if (m > 0 && scaled.length) amount = r1(median(scaled.map(r => r.i.amount / bOf(r))) * m)
            else if (added.length) amount = r1(median(added.map(r => r.i.amount)))
            else continue // chỉ có kiểu "chỉnh lượng" mà món này không dùng nguyên liệu đó (vd. Lớn × cà phê cho món trà)
            if (amount !== 0) items.push({ ingredient, amount, unit: rows.find(r => r.i.unit)?.i.unit ?? '' })
        }
        out.push({ name: g.name, price: src.map(o => o.price).sort((x, y) => x - y)[src.length >> 1], count: n, items })
    }
    return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5)
}
