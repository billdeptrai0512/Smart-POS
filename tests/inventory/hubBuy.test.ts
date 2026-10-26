// "Bổ sung tồn kho" của kho tổng — tính cần mua + giữ dòng "đã mua đủ".
// Nguồn: src/utils/hubBuy.ts

import { describe, it, expect } from 'vitest'
import { buildHubBuyItems, type HubPrep } from '../../src/utils/hubBuy'

const milk = { ingredient: 'sữa', unit: 'ml', pack_size: 1000, pack_unit: 'hộp', min_stock: 1000 }
const row = (over = {}) => ({ ingredient: 'sữa', unit: 'ml', buy: 0, pool: 0, minStock: 1000, totalPull: 0, ...over })
const prep = (plan: unknown[], pool = {}): HubPrep => ({ plan, cfgOf: { sữa: milk }, pool } as unknown as HubPrep)

describe('buildHubBuyItems', () => {
    it('cần mua làm tròn LÊN theo đơn vị nhập lớn nhất, kèm kho/tồn tối thiểu/tổng rút', () => {
        const items = buildHubBuyItems(prep([row({ buy: 2500, pool: 3000, totalPull: 4000 })]))
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({ ingredient: 'sữa', need: 3000, needPacks: 3, warehouse: 3000, minStock: 1000, have: 4000 })
    })
    it('không cần mua (buy ≤ 0) và chưa có "đã mua" → không có dòng', () => {
        expect(buildHubBuyItems(prep([row({ buy: 0 })]))).toEqual([])
        expect(buildHubBuyItems(prep([]))).toEqual([])
    })
    it('plan null → rỗng, không ném lỗi', () => {
        expect(buildHubBuyItems({ plan: null, cfgOf: {}, pool: {} } as unknown as HubPrep)).toEqual([])
    })
    it('đã mua đủ hôm nay: giữ lại dòng done khi trước lúc mua kho còn thiếu', () => {
        // kho 2500 đã gồm 2000 vừa mua → trước đó chỉ có 500 < tồn tối thiểu 1000 → dòng "xong"
        const items = buildHubBuyItems(prep([], { sữa: 2500 }), { sữa: 2000 })
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({ ingredient: 'sữa', done: true, boughtToday: 2000, warehouse: 2500, minStock: 1000 })
    })
    it('món tình cờ nhập mà vốn không thiếu → bỏ dòng', () => {
        expect(buildHubBuyItems(prep([], { sữa: 9000 }), { sữa: 2000 })).toEqual([])
    })
    it('"đã mua" bằng 0 hoặc NVL không có cấu hình → bỏ qua', () => {
        expect(buildHubBuyItems(prep([], { sữa: 100 }), { sữa: 0 })).toEqual([])
        expect(buildHubBuyItems(prep([], {}), { lạ: 500 })).toEqual([])
    })
    it('minAsFloor: tồn tối thiểu là sàn (max) thay vì cộng dồn với tổng rút', () => {
        // pull 1500, min 1000, kho 4000, mua 2000 → trước khi mua còn 2000
        const p = prep([row({ buy: 0, totalPull: 1500, pool: 4000 })], { sữa: 4000 })
        expect(buildHubBuyItems(p, { sữa: 2000 }, false)).toHaveLength(1) // 1000 + 1500 − 2000 = 500 > 0
        expect(buildHubBuyItems(p, { sữa: 2000 }, true)).toEqual([])      // max(1000, 1500) − 2000 < 0
    })
})
