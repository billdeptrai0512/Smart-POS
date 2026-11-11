// Nghi vấn bán thiếu ghi nhận — phần "lặp lại mấy ngày gần đây".
// Chốt việc tách buildDayCandidateSets (quét lịch sử, đắt, đứng yên khi gõ) ra khỏi
// attachRepeatHistory (gắn repeatDays, rẻ, chạy mỗi keystroke) không đổi kết quả.
// Nguồn: src/utils/inventory.ts

import { describe, it, expect } from 'vitest'
import { findMissingCupCandidates, buildDayCandidateSets, attachRepeatHistory } from '../../src/utils/inventory'

// 1 món 2 nguyên liệu — đủ để cross-check (findMissingCupCandidates bỏ qua món <2 NVL).
const products = [{ id: 'p1', name: 'Cà phê sữa', price: 25000, is_active: true }]
const recipes = [
    { product_id: 'p1', ingredient: 'ca_phe', amount: 20 },
    { product_id: 'p1', ingredient: 'sua', amount: 30 },
]
const ingredientsList = [
    { ingredient: 'ca_phe', unit_cost: 100 },
    { ingredient: 'sua', unit_cost: 50 },
]
// Hụt đúng tỉ lệ 3 ly: 60g cà phê + 90ml sữa.
const haoHut3Cups = { ca_phe: -60, sua: -90 }
// Ngày sạch: đếm khớp hết.
const haoHutClean = { ca_phe: 0, sua: 0 }

const candidatesFor = (haoHutByIngredient) =>
    findMissingCupCandidates({ ingredientsList, haoHutByIngredient, recipes, products })

describe('buildDayCandidateSets + attachRepeatHistory', () => {
    it('đếm số ngày lịch sử món đó CŨNG bị nghi', () => {
        const sets = buildDayCandidateSets({
            ingredientsList,
            historicalDailyHaoHut: { '2026-08-01': haoHut3Cups, '2026-08-02': haoHutClean, '2026-08-03': haoHut3Cups },
            recipes,
            products,
        })
        const out = attachRepeatHistory(candidatesFor(haoHut3Cups), sets)

        expect(out).toHaveLength(1)
        expect(out[0].productId).toBe('p1')
        expect(out[0].repeatDays).toBe(2)      // 08-01 và 08-03
        expect(out[0].repeatWindowDays).toBe(3) // tổng số ngày có dữ liệu
    })

    it('không có lịch sử → repeatDays 0, repeatWindowDays 0', () => {
        const sets = buildDayCandidateSets({ ingredientsList, historicalDailyHaoHut: {}, recipes, products })
        const out = attachRepeatHistory(candidatesFor(haoHut3Cups), sets)

        expect(sets).toEqual([])
        expect(out[0].repeatDays).toBe(0)
        expect(out[0].repeatWindowDays).toBe(0)
    })

    it('hôm nay không nghi gì → trả rỗng, không đụng tới lịch sử', () => {
        const sets = buildDayCandidateSets({
            ingredientsList,
            historicalDailyHaoHut: { '2026-08-01': haoHut3Cups },
            recipes,
            products,
        })
        expect(attachRepeatHistory(candidatesFor(haoHutClean), sets)).toEqual([])
    })

    it('sort ưu tiên repeatDays — món lặp nhiều ngày lên trước', () => {
        // Giả lập 2 candidate hôm nay, chỉ p2 xuất hiện trong lịch sử.
        const today = [
            { productId: 'p1', matches: [1, 2], confidence: 0.9 },
            { productId: 'p2', matches: [1, 2], confidence: 0.5 },
        ]
        const out = attachRepeatHistory(today, [new Set(['p2']), new Set(['p2'])])

        expect(out.map(c => c.productId)).toEqual(['p2', 'p1'])
        expect(out[0].repeatDays).toBe(2)
    })

    it('cùng số ngày lặp → % khớp cao hơn lên trước (không xét số nguyên liệu khớp)', () => {
        const today = [
            { productId: 'nhieuNVL', matches: [1, 2, 3, 4], confidence: 0.55 },
            { productId: 'khop', matches: [1, 2], confidence: 1 },
        ]
        expect(attachRepeatHistory(today, []).map(c => c.productId)).toEqual(['khop', 'nhieuNVL'])
    })
})

describe('findMissingCupCandidates — chỉ đích danh món + số ly', () => {
    const menu = [
        { id: 'sua', name: 'Cà phê sữa', price: 16000, is_active: true },
        { id: 'mat', name: 'Matcha latte', price: 21000, is_active: true },
        { id: 'tra', name: 'Trà đá', price: 0, is_active: true },
    ]
    const rec = [
        { product_id: 'sua', ingredient: 'ca_phe', amount: 17 }, { product_id: 'sua', ingredient: 'sua_dac', amount: 36 },
        { product_id: 'sua', ingredient: 'cup', amount: 1 }, { product_id: 'sua', ingredient: 'lid', amount: 1 },
        { product_id: 'mat', ingredient: 'matcha', amount: 15 }, { product_id: 'mat', ingredient: 'sua_tuoi', amount: 60 },
        { product_id: 'mat', ingredient: 'cup', amount: 1 }, { product_id: 'mat', ingredient: 'lid', amount: 1 },
        { product_id: 'tra', ingredient: 'cup', amount: 1 }, { product_id: 'tra', ingredient: 'lid', amount: 1 },
    ]
    const ings = [
        { ingredient: 'ca_phe', unit_cost: 500 }, { ingredient: 'sua_dac', unit_cost: 50 }, { ingredient: 'matcha', unit_cost: 1000 },
        { ingredient: 'sua_tuoi', unit_cost: 35 }, { ingredient: 'cup', unit_cost: 600 }, { ingredient: 'lid', unit_cost: 400 },
    ]
    const find = (haoHutByIngredient: Record<string, number>) => findMissingCupCandidates({ ingredientsList: ings, haoHutByIngredient, recipes: rec, products: menu })

    it('hụt đúng 2 ly cà phê sữa → chỉ cà phê sữa, 2 ly, ~100%; matcha (chỉ chung ly/nắp) không bị nghi', () => {
        const out = find({ ca_phe: -34, sua_dac: -72, cup: -2, lid: -2, matcha: 0, sua_tuoi: 0 })
        expect(out.map(c => c.productId)).toEqual(['sua'])
        expect(out[0].estimatedCups).toBe(2)
        expect(out[0].confidence).toBeGreaterThan(0.95)
        expect(out[0].estimatedRevenue).toBe(32000)
    })
    it('chỉ hụt 1 ly + 1 nắp → không nghi món nào (món có NVL riêng không hụt bị trừ điểm)', () => {
        expect(find({ ca_phe: 0, sua_dac: 0, cup: -1, lid: -1, matcha: 0, sua_tuoi: 0 })).toEqual([])
    })
    it('hụt rải rác nhỏ ở mọi NVL → không đủ 50% để nghi', () => {
        expect(find({ ca_phe: -5, sua_dac: -3, cup: -1, lid: 0, matcha: -2, sua_tuoi: -10 })).toEqual([])
    })
})
