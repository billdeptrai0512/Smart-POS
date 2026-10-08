import { describe, it, expect } from 'vitest'
import { buildGroupPrepPlan } from './prepToday'

const cfg = (over = {}) => ({ ingredient: 'ca_phe', unit: 'kg', pack_size: 1, pack_unit: 'bịch', min_counter_stock: 0, tare_weight: 0, min_stock: 0, ...over })
const branch = (id, over = {}) => ({ id, name: id, ingredientsList: [cfg(over.cfg)], counterStock: { ca_phe: 0 }, forecast: { ca_phe: 3 }, ...over })

describe('buildGroupPrepPlan', () => {
    it('6 chi nhánh cùng cần 3kg, pool 5kg → tổng cần 18, phải mua 13 (bản từng chi nhánh báo "đủ")', () => {
        const branches = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => branch(id))
        const [row] = buildGroupPrepPlan({ branches, pool: { ca_phe: 5 } })
        expect(row.totalPull).toBe(18)
        expect(row.buy).toBe(13)
        expect(row.branches).toHaveLength(6)
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
