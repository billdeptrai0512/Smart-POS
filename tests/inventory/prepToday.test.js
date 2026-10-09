// Chuẩn bị hôm nay — danh sách soạn sáng nay + món HẾT ở quầy giữa ca (Lý thuyết ≤ 0).
// Nguồn: src/utils/prepToday.js

import { describe, it, expect } from 'vitest'
import { buildPrepTodayList, buildDepletedList, mergePrepItems, isPrepDone, buildWarehousePrepList, buildTodayBoughtMap } from '../../src/utils/prepToday'

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

describe('buildWarehousePrepList — món đã mua đủ giữ lại làm dòng xong', () => {
    // quầy đã đếm 300, mai 2500 → rút 2200 = mức cần có ở kho. Kho 1000 + mua 2000 = 3000 → hết thiếu.
    const args = { ...base, ingredientsList: [coffee], inventoryInputs: { cà_phê: '300' }, usedMap: {}, nextDowUsedMap: { cà_phê: 2500 } }
    it('mua đủ → vẫn còn trong danh sách với done: true và lượng đã mua', () => {
        const out = buildWarehousePrepList({ ...args, effectiveWarehouseStocks: { cà_phê: 3000 }, todayBoughtMap: { cà_phê: 2000 } })
        expect(out).toHaveLength(1)
        expect(out[0]).toMatchObject({ ingredient: 'cà_phê', done: true, boughtToday: 2000, packSize: 1000, warehouse: 3000, have: 300, minStock: 0 })
    })
    it('mua thiếu → vẫn là món chờ (không done), kèm lượng đã mua', () => {
        const out = buildWarehousePrepList({ ...args, effectiveWarehouseStocks: { cà_phê: 2000 }, todayBoughtMap: { cà_phê: 1000 } })
        expect(out[0].done).toBeUndefined()
        expect(out[0]).toMatchObject({ need: 200, boughtToday: 1000 })
    })
    it('nhập kho tình cờ cho món vốn không thiếu → không vào danh sách', () => {
        // kho 5000 đã đủ kể cả khi chưa mua 1000 (5000 − 1000 = 4000 ≥ 2200)
        expect(buildWarehousePrepList({ ...args, effectiveWarehouseStocks: { cà_phê: 5000 }, todayBoughtMap: { cà_phê: 1000 } })).toEqual([])
    })
})

describe('buildWarehousePrepList (Bổ sung tồn kho — cho mai)', () => {
    const args = { ingredientsList: [{ ...coffee, min_stock: 0 }], effectiveWarehouseStocks: { cà_phê: 2000 }, restockInputs: {}, inventoryInputs: {}, openingInputs: {}, openingStock: {}, usedMap: {}, nextDowUsedMap: {}, todayBoughtMap: {} }

    it('tổng tồn = (kho − nhập thêm) + quầy đã đếm; thiếu so với dự báo mai → mua theo bịch', () => {
        const out = buildWarehousePrepList({ ...args, restockInputs: { cà_phê: '500' }, inventoryInputs: { cà_phê: '300' }, nextDowUsedMap: { cà_phê: 2500 } })
        // tổng = 2000 − 500 + 300 = 1800; cần 2500 − 1800 = 700 → 1 bịch
        expect(out).toHaveLength(1)
        expect(out[0]).toMatchObject({ need: 700, needPacks: 1, warehouse: 1500, have: 300 })
    })
    it('chưa đếm Cuối kỳ → ước theo Lý thuyết (Đầu kỳ + Nhập thêm − Sử dụng)', () => {
        const out = buildWarehousePrepList({ ...args, openingStock: { cà_phê: 400 }, usedMap: { cà_phê: 100 }, nextDowUsedMap: { cà_phê: 5000 } })
        expect(out[0]).toMatchObject({ have: 300, need: 2700 }) // tổng 2000 + 300
    })
    it('đủ hàng cho mai (hoặc ≥ min_stock) → không vào danh sách', () => {
        expect(buildWarehousePrepList({ ...args, nextDowUsedMap: { cà_phê: 1500 } })).toEqual([])
    })
    it('min_stock là sàn của KHO: kho thấp hơn ngưỡng → mua phần thiếu, kèm minStock', () => {
        const out = buildWarehousePrepList({ ...args, ingredientsList: [{ ...coffee, min_stock: 3000 }] })
        expect(out[0]).toMatchObject({ need: 1000, minStock: 3000 })
    })
    it('min_stock là sàn của kho, KHÔNG cộng chồng lên phần rút mai: mua theo mức lớn hơn', () => {
        // kho 1000, quầy 300, mai cần 1500 → rút 1200 > sàn 1000 → cần kho 1200 → mua 200 (không phải 1200)
        const rut = buildWarehousePrepList({ ...args, effectiveWarehouseStocks: { cà_phê: 1000 }, ingredientsList: [{ ...coffee, min_stock: 1000 }], inventoryInputs: { cà_phê: '300' }, nextDowUsedMap: { cà_phê: 1500 } })
        expect(rut[0]).toMatchObject({ need: 200, warehouse: 1000, have: 300, minStock: 1000 })
        // kho 500, quầy 300, mai cần 400 → rút 100 < sàn 1000 → sàn thắng → cần kho 1000 → mua 500
        const san = buildWarehousePrepList({ ...args, effectiveWarehouseStocks: { cà_phê: 500 }, ingredientsList: [{ ...coffee, min_stock: 1000 }], inventoryInputs: { cà_phê: '300' }, nextDowUsedMap: { cà_phê: 400 } })
        expect(san[0]).toMatchObject({ need: 500, minStock: 1000 })
    })
    it('kho cạn, sàn thấp hơn phần rút mai → mua đúng phần rút, vẫn mang minStock để card hiển thị', () => {
        const out = buildWarehousePrepList({ ...args, effectiveWarehouseStocks: { cà_phê: 0 }, ingredientsList: [{ ...coffee, min_stock: 100 }], inventoryInputs: { cà_phê: '300' }, nextDowUsedMap: { cà_phê: 1000 } })
        expect(out[0]).toMatchObject({ need: 700, minStock: 100 }) // rút 700 > sàn 100
    })
    it('item mang forecast = max(dùng hôm nay, cùng thứ tuần trước) để card giải thích số mua', () => {
        const out = buildWarehousePrepList({ ...args, usedMap: { cà_phê: 300 }, nextDowUsedMap: { cà_phê: 2500 } })
        expect(out[0].forecast).toBe(2500)
    })
    it('min_counter_stock nâng mức rút mai khi dự báo thấp', () => {
        // quầy 100, sàn quầy 800 → rút 700; kho 500 → thiếu 200
        const out = buildWarehousePrepList({ ...args, effectiveWarehouseStocks: { cà_phê: 500 }, ingredientsList: [{ ...coffee, min_counter_stock: 800 }], inventoryInputs: { cà_phê: '100' } })
        expect(out[0].need).toBe(200)
    })
    it('kho đủ rút mai và đủ sàn → không vào danh sách', () => {
        expect(buildWarehousePrepList({ ...args, ingredientsList: [{ ...coffee, min_stock: 1500 }], nextDowUsedMap: { cà_phê: 400 } })).toEqual([])
    })
})

describe('pack2 (quy cách cấp 2) đi theo item', () => {
    it('item mang pack2 khi NVL có cấp 2; needPacks vẫn tính theo cấp 1', () => {
        const milk = { ingredient: 'sữa', unit: 'ml', pack_unit: 'hộp', pack_size: 1000, pack2_unit: 'thùng', pack2_size: 12, tare_weight: 0 }
        const out = buildDepletedList({ ...base, ingredientsList: [milk], openingStock: { sữa: 0 }, warehouseStocks: { sữa: 50000 }, effectiveWarehouseStocks: { sữa: 50000 }, usedMap: { sữa: 500 } })
        expect(out[0]).toMatchObject({ needPacks: 1, packUnit: 'hộp', pack2: { size: 12, unit: 'thùng' } })
    })
})
