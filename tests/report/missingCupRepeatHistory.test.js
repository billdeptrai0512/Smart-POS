// Nghi vấn bán thiếu ghi nhận — phần "lặp lại mấy ngày gần đây".
// Chốt việc tách buildDayCandidateSets (quét lịch sử, đắt, đứng yên khi gõ) ra khỏi
// attachRepeatHistory (gắn repeatDays, rẻ, chạy mỗi keystroke) không đổi kết quả.
// Nguồn: src/utils/inventory.js

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
})
