import type { Row } from '../types/domain'
import { norm } from './onboardingHint'

// Ngày bán giả của demo (guest) — localRepository.ts seed 3 ngày cùng thứ các tuần trước (cho dự báo
// "Cần chuẩn bị") và sinh hôm nay khi khách gửi đơn đầu tiên.
// budget = tồn kho + quầy của Mẫu mặc định theo NVL. Bán cho tới khi không còn ly nào lọt: mỗi ly được nhận
// khi mọi NVL của nó vẫn ≤ cap × budget, và ưu tiên ly làm NVL "đầy nhất" vơi đi (cân bằng) → các NVL cạn gần
// cùng lúc, "Bổ sung tồn kho" cuối ngày ra gần đủ danh sách như quán thật. Số đơn vì vậy theo tồn kho mẫu.
// Món dùng NVL không có trong budget bị loại (bán là âm quầy). ~1/3 ly chọn tùy chọn "Lớn" nếu món có.
export type Budget = Record<string, number>

const CAP = 0.85 // tối đa 85% tồn mỗi NVL — chừa chỗ cho đơn của khách + hao hụt kiểm kê
const MAX = 200  // trần an toàn số ly/ngày

// Số ly theo giờ (giờ VN 0..23) — dáng 1 chi nhánh mang đi thật: đỉnh sáng 7–8h, lặng trưa, nhích nhẹ chiều.
// Chỉ dùng làm TỈ LỆ để rải giờ đơn, không phải số ly thật.
const HOURLY = [0, 0, 0, 0, 0, 0, 34, 58, 60, 29, 6, 2, 10, 4, 11, 8, 10, 12, 9, 6, 4, 2, 0, 0]
const HOUR = 3_600_000
const hourVN = (ms: number) => Math.floor(ms / HOUR + 7) % 24

// n mốc giờ trong [from, to], rải theo HOURLY (giờ nào bị cắt bởi from/to thì trọng số theo phần còn lại).
// Khoảng không có giờ nào có trọng số (vd 0–6h) → rải đều. Trả về đã sắp tăng dần.
// shift (ms): đọc HOURLY theo giờ ảo t+shift — vd khung 12h–20h với shift −6h vẫn có đỉnh sáng (ở 13–14h thật).
export function demoTimes(n: number, from: number, to: number, rand: () => number = Math.random, shift = 0) {
    const segs: { start: number; end: number; w: number }[] = []
    for (let t = from; t < to;) {
        const end = Math.min(to, (Math.floor((t + shift) / HOUR) + 1) * HOUR - shift)
        segs.push({ start: t, end, w: HOURLY[hourVN(t + shift)] * (end - t) / HOUR })
        t = end
    }
    const total = segs.reduce((s, x) => s + x.w, 0)
    const pick = () => {
        if (!total) return from + rand() * (to - from)
        let r = rand() * total
        const s = segs.find(x => (r -= x.w) < 0) ?? segs[segs.length - 1]
        return s.start + rand() * (s.end - s.start)
    }
    return Array.from({ length: n }, pick).map(Math.round).sort((a, b) => a - b)
}

const addUsage =(u: Budget, rows: Row[]) => {
    for (const r of rows) {
        const a = Number(r.amount)
        if (a) u[r.ingredient] = (u[r.ingredient] || 0) + a
    }
    return u
}

export function generateDemoOrders({ products, recipes, ingredients, extras = [], extraIngredients = [], budget, addressId, from, to, shift = 0, rand = Math.random }: {
    products: Row[]; recipes: Row[]; ingredients: Row[]; extras?: Row[]; extraIngredients?: Row[]; budget: Budget; addressId: string
    from: number; to: number; shift?: number; rand?: () => number
}): Row[] {
    const unitCost = Object.fromEntries(ingredients.map(i => [i.ingredient, Number(i.unit_cost) || 0]))
    // Biến thể bán được: món gốc + món kèm "Lớn". usage có thể âm (Lớn = +1 ly lớn −1 ly nhỏ).
    type Variant = { p: Row; extra?: Row; usage: Budget; price: number }
    const fits = (u: Budget) => Object.entries(u).every(([i, a]) => a <= 0 || budget[i] > 0)
    const variants: Variant[] = []
    for (const p of products) {
        if (p.is_divider || !(Number(p.price) > 0)) continue
        const base = addUsage({}, recipes.filter(r => r.product_id === p.id))
        if (!Object.values(base).some(a => a > 0) || !fits(base)) continue
        variants.push({ p, usage: base, price: Number(p.price) })
        const lon = extras.find(e => e.product_id === p.id && norm(e.name) === 'lớn')
        if (!lon) continue
        const big = addUsage({ ...base }, extraIngredients.filter(e => e.extra_id === lon.id))
        if (fits(big)) variants.push({ p, extra: lon, usage: big, price: Number(p.price) + (Number(lon.price) || 0) })
    }

    const used: Budget = {}
    const positive = new Map(variants.map(v => [v, Object.entries(v.usage).filter(([, a]) => a > 0)]))
    const after = (v: Variant) => Math.max(...positive.get(v)!.map(([i, a]) => ((used[i] || 0) + a) / budget[i]))
    const drinks: Variant[] = []
    let pool = variants
    while (drinks.length < MAX) {
        // Chấm điểm 1 lần mỗi vòng (used chỉ đổi sau khi chọn ly), lọc và xếp dùng chung.
        const score = new Map(pool.map(v => [v, after(v)]))
        pool = pool.filter(v => score.get(v)! <= CAP)
        if (!pool.length) break
        // Ly lớn chỉ ~1/3 khi còn lựa chọn; trong nhóm còn lại lấy ngẫu nhiên 1 trong 3 ly làm NVL ít vơi nhất.
        const big = rand() < 1 / 3
        const side = pool.filter(v => !!v.extra === big)
        const ranked = (side.length ? side : pool).slice().sort((a, b) => score.get(a)! - score.get(b)!)
        const v = ranked[Math.floor(rand() * Math.min(3, ranked.length))]
        for (const [i, a] of Object.entries(v.usage)) used[i] = (used[i] || 0) + a
        drinks.push(v)
    }

    // Phần lớn đơn 1 ly, thỉnh thoảng 2 ly; giờ đặt theo dáng giờ cao điểm (demoTimes).
    const groups: Variant[][] = []
    for (let i = 0; i < drinks.length; i += groups.at(-1)!.length) groups.push(drinks.slice(i, i + (rand() < 0.2 ? 2 : 1)))
    const times = demoTimes(groups.length, from, to, rand, shift)
    return groups.map((g, k) => {
        const items = g.map(v => ({
            id: crypto.randomUUID(), product_id: v.p.id, quantity: 1, options: v.extra?.name ?? null,
            extra_ids: v.extra ? [v.extra.id] : [], topping_ids: [], discount_amount: 0, note: null,
            unit_cost: Math.round(Object.entries(v.usage).reduce((s, [i, a]) => s + a * (unitCost[i] || 0), 0)),
        }))
        return {
            id: crypto.randomUUID(),
            address_id: addressId,
            created_at: new Date(times[k]).toISOString(),
            total: g.reduce((s, v) => s + v.price, 0),
            total_cost: items.reduce((s, i) => s + i.unit_cost, 0),
            discount_amount: 0,
            payment_method: null, // như đơn POS thật — Kết ca đối soát theo tổng, không theo từng đơn
            staff_name: 'Nhân viên A',
            table_name: null,
            order_items: items,
        }
    })
}
