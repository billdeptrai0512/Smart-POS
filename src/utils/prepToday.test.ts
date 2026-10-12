import { describe, it, expect } from 'vitest'
import { buildGroupPrepPlan, buildPrepTodayList } from './prepToday'

const cfg = (over = {}) => ({ ingredient: 'ca_phe', unit: 'kg', pack_size: 1, pack_unit: 'bịch', min_counter_stock: 0, tare_weight: 0, min_stock: 0, ...over })
const branch = (id: string, over: Record<string, any> = {}) => ({ id, name: id, ingredientsList: [cfg(over.cfg)], counterStock: { ca_phe: 0 }, forecast: { ca_phe: 3 }, ...over })

describe('buildPrepTodayList + phiếu chia hàng', () => {
    const base = { ingredientsList: [cfg({ pack_size: 2 })], openingInputs: {}, openingStock: { ca_phe: 0 }, usedMap: {}, lastWeekUsedMap: { ca_phe: 3 } }
    it('có phiếu → tick đổ đúng số kho đã soạn, không phải số bịch theo dự báo', () => {
        const [it] = buildPrepTodayList({ ...base, sent: { ca_phe: { qty: 5, packed: true } } })
        expect([it.need, it.fillQty, it.sent, it.sentPacked]).toEqual([3, 5, 5, true])
    })
    it('dự báo không cần nhưng kho đã chia → vẫn có dòng để chi nhánh ghi nhận', () => {
        const noNeed = { ...base, lastWeekUsedMap: {}, openingStock: { ca_phe: 9 } }
        expect(buildPrepTodayList(noNeed)).toEqual([])
        const [it] = buildPrepTodayList({ ...noNeed, sent: { ca_phe: { qty: 4, packed: false } } })
        expect([it.fillQty, it.reason]).toEqual([4, undefined])
    })
})

describe('buildGroupPrepPlan', () => {
    it('6 chi nhánh cùng cần 3kg, pool 5kg → tổng cần 18, phải mua 13 (bản từng chi nhánh báo "đủ")', () => {
        const branches = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => branch(id))
        const [row] = buildGroupPrepPlan({ branches, pool: { ca_phe: 5 } })
        expect(row.totalPull).toBe(18)
        expect(row.buy).toBe(13)
        expect(row.branches).toHaveLength(6)
        expect(buildGroupPrepPlan({ branches: [branch('a', { sampleDays: 1 })], pool: {} })[0].branches[0].sampleDays).toBe(1) // UI gắn nhãn "ước lượng"
    })

    it('trừ tồn quầy + bì, làm tròn bịch, min_stock lấy max chứ không cộng dồn', () => {
        const branches = [
            branch('a', { counterStock: { ca_phe: 2.5 }, cfg: { pack_size: 2, tare_weight: 0.5, min_stock: 4 } }),
            branch('b', { cfg: { min_stock: 6 } }),
        ]
        const [row] = buildGroupPrepPlan({ branches, pool: { ca_phe: 10 } })
        // a: quầy thật 2.0, cần 3 → pull 1 → 1 bịch 2kg. b: cần 3.
        expect(row.branches.map(x => x.qty)).toEqual([2, 3])
        expect(row.minStock).toBe(6)
        expect(row.buy).toBe(1) // 6 + 5 − 10
    })

    it('đủ hàng và không ai cần rút → không có dòng', () => {
        const branches = [branch('a', { counterStock: { ca_phe: 9 } })]
        expect(buildGroupPrepPlan({ branches, pool: { ca_phe: 1 } })).toEqual([])
    })
})
