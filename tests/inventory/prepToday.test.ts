// Chuẩn bị hôm nay — danh sách soạn sáng nay + món HẾT ở quầy giữa ca (Lý thuyết ≤ 0).
// Nguồn: src/utils/prepToday.ts

import { describe, it, expect } from 'vitest'
import { buildPrepTodayList, buildDepletedList, mergePrepItems, isPrepDone, buildTodayBoughtMap, buildGroupPrepPlan } from '../../src/utils/prepToday'

const coffee = { ingredient: 'cà_phê', unit: 'g', pack_unit: 'bịch', pack_size: 1000, tare_weight: 0 }
const base = { ingredientsList: [coffee], openingInputs: {}, openingStock: { cà_phê: 100 }, warehouseStocks: { cà_phê: 5000 }, effectiveWarehouseStocks: { cà_phê: 5000 }, restockInputs: {}, skipped: {} }

describe('buildDepletedList', () => {
    it('Lý thuyết = Đầu kỳ + Nhập thêm − Sử dụng ≤ 0 → hết, lấy 1 bịch', () => {
        const out = buildDepletedList({ ...base, restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 1100 } })
        expect(out).toHaveLength(1)
        expect(out[0]).toMatchObject({ kind: 'depleted', needPacks: 1, fillQty: 1000, have: 0, haveLabel: 'Tồn quầy lý thuyết' })
    })
    it('còn hàng ở quầy (Lý thuyết > 0) → không báo', () => {
        expect(buildDepletedList({ ...base, restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 1099 } })).toEqual([])
    })
    it('Lý thuyết âm nhưng đã đếm Cuối kỳ > 0 → tin số đếm, không báo hết', () => {
        const args = { ...base, restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 1200 } }
        expect(buildDepletedList({ ...args, inventoryInputs: { cà_phê: '30' } })).toEqual([])
        expect(buildDepletedList({ ...args, inventoryInputs: { cà_phê: '0' } })).toHaveLength(1)
    })
    it('Lý thuyết âm → hiện đúng số âm, không ép về 0', () => {
        const out = buildDepletedList({ ...base, restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 1106 } })
        expect(out[0].have).toBe(-6)
    })
    it('chưa bán gì (used = 0) → không báo dù đầu kỳ = 0', () => {
        expect(buildDepletedList({ ...base, openingStock: {}, usedMap: {} })).toEqual([])
    })
    it('đã bỏ qua → không báo', () => {
        expect(buildDepletedList({ ...base, skipped: { cà_phê: true }, usedMap: { cà_phê: 500 } })).toEqual([])
    })
    it('kẹp lượng lấy theo kho dự trữ còn lại (trừ phần đã nhập thêm)', () => {
        const out = buildDepletedList({ ...base, effectiveWarehouseStocks: { cà_phê: 1300 }, restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 1200 } })
        expect(out[0].fillQty).toBe(300)
        const empty = buildDepletedList({ ...base, effectiveWarehouseStocks: { cà_phê: 1000 }, restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 1200 } })
        expect(empty[0].fillQty).toBe(0)
    })
    it('NVL không có quy cách bịch → 25% lượng đã dùng, tối thiểu 1', () => {
        const straw = { ingredient: 'ống_hút', unit: 'cái', tare_weight: 0 }
        const out = buildDepletedList({ ...base, ingredientsList: [straw], openingStock: { ống_hút: 0 }, effectiveWarehouseStocks: {}, usedMap: { ống_hút: 40 } })
        expect(out[0]).toMatchObject({ needPacks: 0, need: 10, fillQty: 10 })
    })
})

describe('tồn quầy ít nhất (min_counter_stock)', () => {
    const withMin = (min, extra = {}) => ({ ...base, ingredientsList: [{ ...coffee, min_counter_stock: min, ...extra }] })

    it('Soạn hôm nay: dự báo thấp vẫn lấy đủ lên sàn quầy, kèm lý do', () => {
        const out = buildPrepTodayList({ ...withMin(800), openingStock: { cà_phê: 100 }, usedMap: {}, lastWeekUsedMap: { cà_phê: 50 } })
        expect(out[0]).toMatchObject({ need: 700, needPacks: 1, reason: 'Tồn quầy ít nhất: 800 g' })
    })
    it('Soạn hôm nay: dự báo đã vượt sàn → không có lý do', () => {
        const out = buildPrepTodayList({ ...withMin(200), openingStock: { cà_phê: 100 }, usedMap: {}, lastWeekUsedMap: { cà_phê: 500 } })
        expect(out[0].need).toBe(400)
        expect(out[0].reason).toBeUndefined()
    })
    it('Soạn hôm nay: mang hành trình trong ca (lấy thêm, số đếm cuối ca trừ bì); have/need vẫn theo đầu ca', () => {
        const args = { ...base, ingredientsList: [{ ...coffee, tare_weight: 20 }], openingStock: { cà_phê: 120 }, usedMap: {}, lastWeekUsedMap: { cà_phê: 500 } }
        const before = buildPrepTodayList(args)[0]
        expect(before.restock).toBeUndefined()
        expect(before.counted).toBeUndefined()
        const after = buildPrepTodayList({ ...args, restockInputs: { cà_phê: '300' }, inventoryInputs: { cà_phê: '70' } })[0]
        expect(after).toMatchObject({ have: before.have, need: before.need, restock: 300, counted: 50 })
    })
    it('Hết giữa ca: còn hàng nhưng dưới sàn quầy → báo "sắp hết"', () => {
        const out = buildDepletedList({ ...withMin(300), restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 900 } })
        expect(out[0]).toMatchObject({ kind: 'depleted', low: true, have: 200, needPacks: 1, fillQty: 1000 })
    })
    it('Hết giữa ca: bằng đúng sàn thì chưa báo; không đặt sàn thì chỉ báo khi ≤ 0', () => {
        expect(buildDepletedList({ ...withMin(300), restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 800 } })).toEqual([])
        expect(buildDepletedList({ ...withMin(0), restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 900 } })).toEqual([])
    })
    it('Hết giữa ca: 1 bịch chưa lên sàn → lấy đủ số bịch để lên sàn', () => {
        const out = buildDepletedList({ ...withMin(2500), openingStock: { cà_phê: 0 }, restockInputs: { cà_phê: '1000' }, usedMap: { cà_phê: 900 } })
        expect(out[0]).toMatchObject({ needPacks: 3, need: 3000 }) // thiếu 2400 → 3 bịch
    })
})

describe('mergePrepItems / isPrepDone', () => {
    const prep = buildPrepTodayList({ ...base, openingStock: { cà_phê: 0 }, usedMap: {}, lastWeekUsedMap: { cà_phê: 500 } })

    it('món soạn sáng nay đã tick → xong', () => {
        expect(prep).toHaveLength(1)
        expect(isPrepDone(prep[0], { cà_phê: '1000' }, {})).toBe(true)
        expect(isPrepDone(prep[0], {}, {})).toBe(false)
    })
    it('đã tick sáng nay nhưng hết giữa ca → quay lại danh sách, chưa xong', () => {
        const restockInputs = { cà_phê: '1000' }
        const depleted = buildDepletedList({ ...base, openingStock: { cà_phê: 0 }, restockInputs, usedMap: { cà_phê: 1000 } })
        const items = mergePrepItems(prep, depleted, restockInputs)
        expect(items).toHaveLength(1)
        expect(items[0].kind).toBe('depleted')
        expect(isPrepDone(items[0], restockInputs, {})).toBe(false)
    })
    it('bỏ qua luôn tính xong, kể cả món đang hết', () => {
        expect(isPrepDone({ ingredient: 'cà_phê', kind: 'depleted' }, {}, { cà_phê: true })).toBe(true)
    })
})

describe('buildTodayBoughtMap', () => {
    const exp = (metadata, extra = {}) => ({ is_refill: true, metadata: { ingredient: 'cà_phê', ...metadata }, ...extra })
    it('cộng các phiếu mua; bỏ phiếu hủy, phiếu hiệu chỉnh tồn (sửa tay) và chi phí không phải nhập kho', () => {
        const out = buildTodayBoughtMap([
            exp({ qty: 1000 }), exp({ qty: 500 }),
            exp({ qty: 700, cancelled: true }),
            exp({ qty: 1, adjustment: true }),
            { is_refill: false, metadata: { ingredient: 'cà_phê', qty: 9 } },
        ])
        expect(out).toEqual({ cà_phê: 1500 })
    })
})

describe('pack2 (quy cách cấp 2) đi theo item', () => {
    it('item mang pack2 khi NVL có cấp 2; needPacks vẫn tính theo cấp 1', () => {
        const milk = { ingredient: 'sữa', unit: 'ml', pack_unit: 'hộp', pack_size: 1000, pack2_unit: 'thùng', pack2_size: 12, tare_weight: 0 }
        const out = buildDepletedList({ ...base, ingredientsList: [milk], openingStock: { sữa: 0 }, effectiveWarehouseStocks: { sữa: 50000 }, usedMap: { sữa: 500 } })
        expect(out[0]).toMatchObject({ needPacks: 1, packUnit: 'hộp', pack2: { size: 12, unit: 'thùng' } })
    })
})

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
