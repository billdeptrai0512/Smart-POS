import { describe, it, expect } from 'vitest'
import { generateDemoOrders, demoTimes } from './demoDay'

const products = [
    { id: 'div', name: 'Cà phê', price: 0, is_divider: true },
    { id: 'den', name: 'Cà phê đen', price: 14000 },        // công thức 0 hết → loại
    { id: 'sua', name: 'Cà phê sữa', price: 16000 },
    { id: 'bx', name: 'Bạc xỉu', price: 16000 },
    { id: 'tra', name: 'Trà tắc', price: 15000 },           // dùng NVL không có trong budget → loại
]
const recipes = [
    { product_id: 'den', ingredient: 'cà_phê', amount: 0 },
    { product_id: 'sua', ingredient: 'cà_phê', amount: 17 }, { product_id: 'sua', ingredient: 'sữa_đặc', amount: 36 }, { product_id: 'sua', ingredient: 'ly_nhỏ', amount: 1 },
    { product_id: 'bx', ingredient: 'cà_phê', amount: 8 }, { product_id: 'bx', ingredient: 'sữa_tươi', amount: 40 }, { product_id: 'bx', ingredient: 'ly_nhỏ', amount: 1 },
    { product_id: 'tra', ingredient: 'tắc', amount: 2 }, { product_id: 'tra', ingredient: 'ly_nhỏ', amount: 1 },
]
// "Lớn" = +1 ly lớn −1 ly nhỏ, phụ thu 6k.
const extras = [{ id: 'lon', product_id: 'sua', name: 'Lớn', price: 6000 }]
const extraIngredients = [{ extra_id: 'lon', ingredient: 'ly_lớn', amount: 1 }, { extra_id: 'lon', ingredient: 'ly_nhỏ', amount: -1 }]
const ingredients = [{ ingredient: 'cà_phê', unit_cost: 500 }, { ingredient: 'sữa_đặc', unit_cost: 50 }, { ingredient: 'ly_nhỏ', unit_cost: 600 }]
const budget: Record<string, number> = { 'cà_phê': 1000, 'sữa_đặc': 1284, 'sữa_tươi': 1000, 'ly_nhỏ': 100, 'ly_lớn': 50 }

// rand xác định (LCG) để test không chập chờn.
const lcg = (seed = 1) => () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31

describe('generateDemoOrders', () => {
    const from = Date.parse('2026-11-10T02:00:00Z'), to = from + 5 * 3600_000
    const orders = generateDemoOrders({ products, recipes, ingredients, extras, extraIngredients, budget, addressId: 'a', from, to, rand: lcg() })
    const items = orders.flatMap(o => o.order_items)
    const used: Record<string, number> = {}
    for (const it of items) {
        for (const r of recipes) if (r.product_id === it.product_id) used[r.ingredient] = (used[r.ingredient] || 0) + r.amount
        for (const e of extraIngredients) if (it.extra_ids.includes(e.extra_id)) used[e.ingredient] = (used[e.ingredient] || 0) + e.amount
    }

    it('mọi NVL dùng ≤ 85% tồn kho + quầy, và bán tới khi NVL ràng buộc gần cạn', () => {
        for (const [i, a] of Object.entries(used)) expect(a).toBeLessThanOrEqual(0.85 * budget[i])
        // sữa đặc là NVL ràng buộc của cà phê sữa — phải được vét gần tới trần, không dừng ở số ly cố định.
        expect(used['sữa_đặc']).toBeGreaterThan(0.85 * budget['sữa_đặc'] - 36)
    })
    it('có bán ly "Lớn": trừ ly lớn, hoàn ly nhỏ, cộng phụ thu', () => {
        const big = items.filter(i => i.extra_ids.includes('lon'))
        expect(big.length).toBeGreaterThan(0)
        expect(big[0].options).toBe('Lớn')
        expect(used['ly_lớn']).toBe(big.length)
        const bigOrder = orders.find(o => o.order_items.length === 1 && o.order_items[0].extra_ids.includes('lon'))
        if (bigOrder) expect(bigOrder.total).toBe(22000)
    })
    it('bỏ món không công thức, món dùng NVL ngoài kho và dòng phân mục', () => {
        expect(new Set(items.map(i => i.product_id))).toEqual(new Set(['sua', 'bx']))
    })
    it('giờ nằm trong khoảng; giá vốn gồm cả NVL', () => {
        for (const o of orders) {
            const t = Date.parse(o.created_at)
            expect(t).toBeGreaterThanOrEqual(from)
            expect(t).toBeLessThanOrEqual(to)
        }
        expect(items.find(i => i.product_id === 'sua' && !i.extra_ids.length)!.unit_cost).toBe(17 * 500 + 36 * 50 + 600)
    })
})

describe('demoTimes', () => {
    // 10/11/2026 00:00 giờ VN
    const day = Date.parse('2026-11-10T00:00:00+07:00')
    const hourOf = (ms: number) => new Date(ms + 7 * 3600_000).getUTCHours()

    it('cả ngày: dồn vào đỉnh sáng 7–8h, gần như không có đơn 0–5h và 10–11h', () => {
        const t = demoTimes(400, day, day + 24 * 3600_000, lcg(7))
        const count = (a: number, b: number) => t.filter(x => hourOf(x) >= a && hourOf(x) <= b).length
        expect(count(0, 5)).toBe(0)
        expect(count(7, 8)).toBeGreaterThan(count(10, 11) * 5)
        expect([...t].sort((a, b) => a - b)).toEqual(t)
    })
    it('khoảng chỉ gồm giờ không có trọng số → rải đều, vẫn trong khoảng', () => {
        const t = demoTimes(5, day + 3600_000, day + 2 * 3600_000, lcg(3))
        for (const x of t) { expect(x).toBeGreaterThanOrEqual(day + 3600_000); expect(x).toBeLessThanOrEqual(day + 2 * 3600_000) }
    })
    it('shift: khung 12h–20h đọc như 6h–14h → đỉnh ở 13–14h, trong khung', () => {
        const from = day + 12 * 3600_000, to = day + 20 * 3600_000
        const t = demoTimes(400, from, to, lcg(5), -6 * 3600_000)
        const count = (a: number, b: number) => t.filter(x => hourOf(x) >= a && hourOf(x) <= b).length
        for (const x of t) { expect(x).toBeGreaterThanOrEqual(from); expect(x).toBeLessThanOrEqual(to) }
        expect(count(13, 14)).toBeGreaterThan(count(18, 19) * 5)
    })
})
