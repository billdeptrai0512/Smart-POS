// POS — logic thuần của giỏ hàng / đơn lạc quan (tách từ POSContext).
// Nguồn: src/services/cartOps.ts
// Mục đích: POSContext chạm tiền thật nhưng không render được trong test (không có DOM), nên mọi
// phép tính nằm ở đây và bị ghim bằng test — sửa POSContext không được làm lệch số.

import { describe, it, expect } from 'vitest'
import {
    isNetworkError, cartTotal, cartOrderCount, cartDiscountTotal, newCartLine, patchLine, removeLatestOfProduct,
    toggleExtraOnLast, toggleToppingOnLast, setStickyExtraOnLast, buildLastOrderFromDB, buildLastOrderFromCart,
    mergeFetchedOrders, computeSubmitTotals, submitLines, appendRoundToTables, buildOptimisticRound,
    buildOptimisticOrder, cartItemsFromRound, seedRoundDiscounts,
} from '../../src/services/cartOps'

const line = (over = {}) => ({
    cartItemId: 'c1', productId: 'p1', name: 'Cà phê', basePrice: 10000, quantity: 1, extras: [], toppings: [], ...over,
})
const ice = { id: 'e-ice', name: 'Ít đá', price: 0, is_sticky: true }
const shot = { id: 'e-shot', name: 'Thêm shot', price: 5000 }
const pearl = { id: 't-pearl', name: 'Trân châu', price: 3000 }

describe('isNetworkError', () => {
    it('mất mạng (offline) luôn là lỗi mạng', () => {
        expect(isNetworkError({ message: 'bất kỳ' }, false)).toBe(true)
    })
    it('online: chỉ nhận message kiểu fetch/network', () => {
        expect(isNetworkError({ message: 'Failed to fetch' }, true)).toBe(true)
        expect(isNetworkError({ message: 'NetworkError when attempting' }, true)).toBe(true)
        expect(isNetworkError({ message: 'duplicate key' }, true)).toBe(false)
        expect(isNetworkError(null, true)).toBe(false)
    })
})

describe('tổng giỏ', () => {
    it('cartTotal = (giá gốc + extras + topping) × số lượng, cộng các dòng', () => {
        const cart = [line({ quantity: 2, extras: [shot], toppings: [pearl] }), line({ cartItemId: 'c2', basePrice: 20000 })]
        expect(cartTotal(cart)).toBe((10000 + 5000 + 3000) * 2 + 20000)
    })
    it('giỏ rỗng = 0', () => {
        expect(cartTotal([])).toBe(0)
        expect(cartOrderCount([])).toBe(0)
    })
    it('cartOrderCount cộng quantity', () => {
        expect(cartOrderCount([line({ quantity: 2 }), line({ cartItemId: 'c2', quantity: 3 })])).toBe(5)
    })
    it('cartDiscountTotal cộng giảm giá riêng từng dòng (% làm tròn, đ kẹp theo tiền hàng)', () => {
        const cart = [
            line({ basePrice: 15000, discount: { type: 'percent', value: 10 } }),               // 1.500
            line({ cartItemId: 'c2', basePrice: 4000, discount: { type: 'amount', value: 9999 } }), // kẹp 4.000
            line({ cartItemId: 'c3' }),                                                          // không giảm
        ]
        expect(cartDiscountTotal(cart)).toBe(1500 + 4000)
    })
})

describe('thêm / bớt / sửa dòng', () => {
    it('newCartLine: chỉ gắn extra dính đang bật, quantity 1, topping rỗng', () => {
        const other = { id: 'e-sugar', name: 'Ít đường', price: 0, is_sticky: true }
        const l = newCartLine({ id: 'p1', name: 'Cà phê', price: 10000 }, [ice, other, shot], ['e-ice'], undefined, 'new-id')
        expect(l).toEqual({ cartItemId: 'new-id', productId: 'p1', name: 'Cà phê', basePrice: 10000, quantity: 1, extras: [ice], toppings: [] })
    })
    it('newCartLine: dùng giá chương trình giảm giá đang hiệu lực', () => {
        const program = { enabled: true, start_date: null, end_date: null, days_of_week: [], type: 'amount', value: 2000 }
        const l = newCartLine({ id: 'p1', name: 'Cà phê', price: 10000 }, [], [], [program], 'x')
        expect(l.basePrice).toBe(8000)
    })
    it('patchLine chỉ sửa đúng dòng', () => {
        const cart = [line(), line({ cartItemId: 'c2' })]
        const next = patchLine(cart, 'c2', { note: 'ít ngọt' })
        expect(next[0]).toBe(cart[0])
        expect(next[1].note).toBe('ít ngọt')
    })
    it('removeLatestOfProduct: bớt dòng MỚI NHẤT của chính món đó, không phải dòng cuối giỏ', () => {
        const cart = [
            line({ cartItemId: 'a1', productId: 'A' }),
            line({ cartItemId: 'a2', productId: 'A' }),
            line({ cartItemId: 'b1', productId: 'B' }),
        ]
        expect(removeLatestOfProduct(cart, 'A').map(i => i.cartItemId)).toEqual(['a1', 'b1'])
    })
    it('removeLatestOfProduct: món không có trong giỏ → trả lại đúng mảng cũ', () => {
        const cart = [line()]
        expect(removeLatestOfProduct(cart, 'zzz')).toBe(cart)
    })
})

describe('bật/tắt extra, topping trên dòng cuối', () => {
    it('toggleExtraOnLast bật rồi tắt, chỉ đụng dòng cuối', () => {
        const cart = [line(), line({ cartItemId: 'c2' })]
        const on = toggleExtraOnLast(cart, shot)
        expect(on[0]).toBe(cart[0])
        expect(on[1].extras).toEqual([shot])
        expect(toggleExtraOnLast(on, shot)[1].extras).toEqual([])
    })
    it('giỏ rỗng → trả lại đúng mảng cũ (caller không cần setState)', () => {
        const empty = []
        expect(toggleExtraOnLast(empty, shot)).toBe(empty)
        expect(toggleToppingOnLast(empty, pearl)).toBe(empty)
        expect(setStickyExtraOnLast(empty, ice, true)).toBe(empty)
    })
    it('toggleToppingOnLast bật/tắt topping', () => {
        const on = toggleToppingOnLast([line()], pearl)
        expect(on[0].toppings).toEqual([pearl])
        expect(toggleToppingOnLast(on, pearl)[0].toppings).toEqual([])
    })
    it('setStickyExtraOnLast: bật không thêm trùng, tắt thì gỡ', () => {
        const once = setStickyExtraOnLast([line()], ice, true)
        expect(once[0].extras).toEqual([ice])
        expect(setStickyExtraOnLast(once, ice, true)[0].extras).toEqual([ice])
        expect(setStickyExtraOnLast(once, ice, false)[0].extras).toEqual([])
    })
})

describe('nhật ký (buildLastOrder*)', () => {
    it('FromCart: gộp dòng trùng nhãn, "N tên (extras)"', () => {
        const cart = [line({ extras: [shot] }), line({ cartItemId: 'c2', extras: [shot] }), line({ cartItemId: 'c3', name: 'Trà' })]
        const o = buildLastOrderFromCart(cart, 45000, 'oid', '2026-01-01T00:00:00.000Z')
        expect(o).toEqual({ id: 'oid', total: 45000, createdAt: '2026-01-01T00:00:00.000Z', items: ['2 Cà phê (Thêm shot)', 'Trà'] })
    })
    it('FromDB: đọc options "a, b" và tên món từ order_items', () => {
        const o = buildLastOrderFromDB({
            id: 'o1', total: 30000, created_at: '2026-01-01T00:00:00.000Z',
            order_items: [
                { quantity: 2, options: 'Ít đá, Thêm shot', products: { name: 'Cà phê' } },
                { quantity: 1, options: null, products: null },
            ],
        })
        expect(o).toEqual({ id: 'o1', total: 30000, createdAt: '2026-01-01T00:00:00.000Z', items: ['2 Cà phê (Ít đá, Thêm shot)', '?'] })
    })
    it('FromDB: "Tiền mặt"/"MoMo" là cách trả tiền chứ không phải tuỳ chọn → bỏ khỏi nhãn', () => {
        const o = buildLastOrderFromDB({ id: 'o', total: 1, created_at: 'x', order_items: [{ quantity: 1, options: 'Tiền mặt', products: { name: 'Trà' } }] })
        expect(o.items).toEqual(['Trà'])
    })
})

describe('mergeFetchedOrders', () => {
    it('giữ hàng lạc quan chưa có trong kết quả fetch, bỏ hàng đã được xác nhận', () => {
        const prev = [{ id: 'a', _optimistic: true }, { id: 'b', _optimistic: true }, { id: 'old' }]
        const fetched = [{ id: 'b' }, { id: 'c' }]
        expect(mergeFetchedOrders(prev, fetched)).toEqual([{ id: 'a', _optimistic: true }, { id: 'b' }, { id: 'c' }])
    })
})

describe('computeSubmitTotals', () => {
    const products = [
        { id: 'p1', price: 10000 },
        { id: 'p2', price: 20000, count_as_cup: false },
    ]
    const cost = (item) => (item.productId === 'p1' ? 3000 : 5000)

    it('tổng, giá vốn, số ly (món count_as_cup=false không tính ly)', () => {
        const items = [line({ quantity: 2 }), line({ cartItemId: 'c2', productId: 'p2', basePrice: 20000 })]
        const t = computeSubmitTotals(items, 0, products, cost)
        expect(t.itemTotal).toBe(40000)
        expect(t.netTotal).toBe(40000)
        expect(t.cartCost).toBe(3000 * 2 + 5000)
        expect(t.costPerItem).toEqual({ c1: 3000, c2: 5000 })
        expect(t.countableQty).toBe(2)
        expect(t.programDiscount).toBe(0)
    })
    it('chiết khấu làm tròn và kẹp theo tiền hàng', () => {
        const items = [line({ basePrice: 10000 })]
        expect(computeSubmitTotals(items, 1234.6, products, cost).discountApplied).toBe(1235)
        const over = computeSubmitTotals(items, 99999, products, cost)
        expect(over.discountApplied).toBe(10000)
        expect(over.netTotal).toBe(0)
        expect(computeSubmitTotals(items, NaN, products, cost).discountApplied).toBe(0)
    })
    it('giảm theo chương trình = (giá gốc − basePrice) × qty, KHÔNG nằm trong discountApplied/netTotal', () => {
        const items = [line({ basePrice: 8000, quantity: 3 })] // products.price = 10000 → giảm 2000/ly
        const t = computeSubmitTotals(items, 0, products, cost)
        expect(t.programDiscount).toBe(6000)
        expect(t.discountApplied).toBe(0)
        expect(t.netTotal).toBe(24000)
        expect(t.lineDiscount(items[0])).toBe(6000)
    })
    it('lineDiscount = giảm tay của dòng + phần chương trình', () => {
        const items = [line({ basePrice: 8000, quantity: 1, discount: { type: 'percent', value: 50 } })]
        const t = computeSubmitTotals(items, 0, products, cost)
        expect(t.lineDiscount(items[0])).toBe(4000 + 2000)
    })
    it('món không còn trong menu: không có phần chương trình, vẫn tính ly', () => {
        const t = computeSubmitTotals([line({ productId: 'gone', basePrice: 7000 })], 0, products, () => 0)
        expect(t.programDiscount).toBe(0)
        expect(t.countableQty).toBe(1)
    })
})

describe('đợt lạc quan của bàn', () => {
    const items = [line({ quantity: 2, extras: [shot], note: 'nóng' })]
    const totals = computeSubmitTotals(items, 1000, [{ id: 'p1', price: 10000 }], () => 3000)
    const lines = submitLines(items)

    it('submitLines kèm extras + ghi chú', () => {
        expect(lines.map(l => [l.name, l.qty])).toEqual([['Cà phê (Thêm shot) — nóng', 2]])
    })

    it('buildOptimisticRound mang tổng thực thu, giảm giá và id (null khi offline)', () => {
        const r = buildOptimisticRound(items, totals, 'oid', 't0', lines)
        expect(r).toMatchObject({ id: 'oid', total: 29000, discountAmount: 1000, servedAt: null, createdAt: 't0' })
        expect(r.items).toEqual([{ productId: 'p1', qty: 2, discountAmount: 0, extraIds: ['e-shot'], toppingIds: [], note: 'nóng' }])
        expect(buildOptimisticRound(items, totals, null, 't0', lines).id).toBeNull()
    })

    it('appendRoundToTables: bàn mới được tạo, tổng = netTotal', () => {
        const round = buildOptimisticRound(items, totals, 'oid', 't0', lines)
        const next = appendRoundToTables([], 'Bàn 1', round, 't0')
        expect(next).toEqual([{ name: 'Bàn 1', total: 29000, rounds: [round], openedAt: 't0', lines }])
    })

    it('appendRoundToTables: bàn đã mở thì cộng dồn tổng, thêm đợt, gộp dòng cùng nhãn', () => {
        const round = buildOptimisticRound(items, totals, 'o2', 't1', lines)
        const existing = { name: 'Bàn 1', total: 10000, rounds: [{ id: 'o1' }], openedAt: 't0', lines: submitLines([line({ extras: [shot], note: 'nóng' })]) }
        const next = appendRoundToTables([existing, { name: 'Bàn 2', total: 5, rounds: [], openedAt: 't', lines: [] }], 'Bàn 1', round, 't1')
        expect(next).toHaveLength(2)
        expect(next[0].total).toBe(39000)
        expect(next[0].rounds.map(r => r.id)).toEqual(['o1', 'o2'])
        expect(next[0].openedAt).toBe('t0')
        expect(next[0].lines.map(l => l.qty)).toEqual([3])
        expect(next[1].name).toBe('Bàn 2')
    })

    it('đơn mang đi (name null) vào bucket name=null', () => {
        const round = buildOptimisticRound(items, totals, 'o', 't', lines)
        const withTakeaway = appendRoundToTables([{ name: null, total: 1000, rounds: [], openedAt: 't0', lines: [] }], null, round, 't')
        expect(withTakeaway).toHaveLength(1)
        expect(withTakeaway[0].total).toBe(30000)
    })
})

describe('buildOptimisticOrder (hàng /history lạc quan)', () => {
    it('đúng shape fetchTodayOrders + cờ _optimistic', () => {
        const items = [line({ quantity: 2, extras: [shot], toppings: [pearl], note: 'x' })]
        const totals = computeSubmitTotals(items, 0, [{ id: 'p1', price: 10000 }], () => 2500.4)
        const o = buildOptimisticOrder(items, totals, { orderId: 'oid', createdAt: 't', staffName: null, tableName: '' })
        expect(o).toMatchObject({
            _optimistic: true, id: 'oid', total: 36000, discount_amount: 0, total_cost: 5001, created_at: 't',
            staff_name: null, table_name: null, deleted_at: null, payment_method: null,
        })
        expect(o.order_items).toEqual([{
            id: 'c1', quantity: 2, options: 'Thêm shot, Trân châu', product_id: 'p1', unit_cost: 2500,
            extra_ids: ['e-shot'], topping_ids: ['t-pearl'], discount_amount: 0, note: 'x', products: { name: 'Cà phê' },
        }])
    })
})

describe('sửa đợt: cartItemsFromRound', () => {
    const products = [{ id: 'p1', name: 'Cà phê', price: 10000 }]
    const round = { orderNo: 7, items: [{ productId: 'p1', qty: 2, extraIds: ['e-shot'], toppingIds: ['t-pearl'], note: 'n' }] }

    it('dựng lại dòng với extras/topping theo id và đánh dấu edit.orderNo', () => {
        const r = cartItemsFromRound(round, products, { p1: [shot, ice] }, { p1: [pearl] }, {}, () => 'nid')
        expect(r).toEqual({
            ok: true, programDeltas: [0],
            items: [{ cartItemId: 'nid', productId: 'p1', name: 'Cà phê', basePrice: 10000, quantity: 2, extras: [shot], toppings: [pearl], note: 'n', edit: { orderNo: 7 } }],
        })
    })
    it('món đã xoá khỏi menu → ok:false (caller dừng TRƯỚC khi xoá đợt cũ)', () => {
        expect(cartItemsFromRound(round, [], {}, {}, {})).toEqual({ ok: false })
    })
    it('đợt chưa có số đơn → orderNo null', () => {
        const r = cartItemsFromRound({ items: round.items }, products, {}, {}, {})
        expect(r.items[0].edit).toEqual({ orderNo: null })
    })
    it('giá chương trình: basePrice là giá đã giảm, programDeltas ghi phần chênh × qty', () => {
        const program = { enabled: true, start_date: null, end_date: null, days_of_week: [], type: 'amount', value: 1000 }
        const r = cartItemsFromRound(round, products, {}, {}, { p1: [program] })
        expect(r.items[0].basePrice).toBe(9000)
        expect(r.programDeltas).toEqual([2000])
    })
})

describe('sửa đợt: seedRoundDiscounts', () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => line({ cartItemId: 'c' + i, basePrice: 10000 }))

    it('giảm riêng từng dòng → gán đúng dòng, tròn % thì lưu %', () => {
        const items = mk(2)
        seedRoundDiscounts(items, { items: [{ discountAmount: 0 }, { discountAmount: 2500 }] }, [0, 0])
        expect(items[0].discount).toBeUndefined()
        expect(items[1].discount).toEqual({ type: 'percent', value: 25 })
    })
    it('số lẻ không tròn % → giữ "đ"', () => {
        const items = mk(1)
        seedRoundDiscounts(items, { items: [{ discountAmount: 1234 }] }, [0])
        expect(items[0].discount).toEqual({ type: 'amount', value: 1234 })
    })
    it('trừ phần chương trình ra, chỉ còn phần bấm tay (không giảm hai lần)', () => {
        const items = mk(1)
        seedRoundDiscounts(items, { items: [{ discountAmount: 3000 }] }, [3000])
        expect(items[0].discount).toBeUndefined()
        const items2 = mk(1)
        seedRoundDiscounts(items2, { items: [{ discountAmount: 3000 }] }, [2000])
        expect(items2[0].discount).toEqual({ type: 'percent', value: 10 })
    })
    it('đợt CŨ (không có giảm theo dòng) → dồn cả cục vào dòng cuối', () => {
        const items = mk(2)
        seedRoundDiscounts(items, { items: [{}, {}], total: 15000, discountAmount: 5000 }, [0, 0])
        expect(items[0].discount).toBeUndefined()
        expect(items[1].discount).toEqual({ type: 'percent', value: 25 })
    })
    it('không giảm gì → không đụng', () => {
        const items = mk(1)
        seedRoundDiscounts(items, { items: [{}], total: 10000, discountAmount: 0 }, [0])
        expect(items[0].discount).toBeUndefined()
    })
})
