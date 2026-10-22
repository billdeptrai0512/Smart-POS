import { describe, it, expect } from 'vitest'
import { buildGroupPrepPlan } from './prepToday'

// Redbull: quầy 2 lon (sàn 3), kho 12 lon, thùng 24 → cần thật 1 lon.
const branch = { id: 'a', name: 'a', forecast: {}, counterStock: { redbull: 2 },
    ingredientsList: [{ ingredient: 'redbull', unit: 'lon', pack_size: 24, pack_unit: 'thùng', min_counter_stock: 3, min_stock: 0 }] as never }

describe('buildGroupPrepPlan', () => {
    it('địa chỉ lẻ so kho với lượng cần thật, không làm tròn thùng', () => {
        expect(buildGroupPrepPlan({ branches: [branch], pool: { redbull: 12 }, minAsFloor: true })[0]).toMatchObject({ totalPull: 1, buy: 0 })
    })
    it('kho tổng nhóm vẫn rút nguyên thùng', () => {
        expect(buildGroupPrepPlan({ branches: [branch], pool: { redbull: 12 } })[0]).toMatchObject({ totalPull: 24, buy: 12 })
    })
})
