import { describe, it, expect } from 'vitest'
import { splitExpenses, aggregateOrderStats, computeCashFlowTotals, dedupeShiftClosingsByDay } from './reportStats'

describe('splitExpenses (thực chi model)', () => {
    it('sums non-refill expenses into dailyExpense', () => {
        const expenses = [
            { amount: 100 },
            { amount: 200 },
        ]
        const { dailyExpense, refillNvl, refillFreeForm } = splitExpenses(expenses)
        expect(dailyExpense).toBe(300)
        expect(refillNvl).toBe(0)
        expect(refillFreeForm).toBe(0)
    })

    it('puts NVL refill (is_refill, no free_form) into refillNvl', () => {
        const expenses = [
            { amount: 5000, is_refill: true, metadata: { ingredient: 'coffee_g', qty: 100 } },
        ]
        const { refillNvl, dailyExpense } = splitExpenses(expenses)
        expect(refillNvl).toBe(5000)
        expect(dailyExpense).toBe(0)
    })

    it('puts free-form refill (sau ca) into refillFreeForm', () => {
        const expenses = [
            { amount: 75, is_refill: true, metadata: { free_form: true } },
        ]
        const { refillFreeForm, refillNvl } = splitExpenses(expenses)
        expect(refillFreeForm).toBe(75)
        expect(refillNvl).toBe(0)
    })

    it('counts legacy is_fixed=true as operational (thực chi: cash already paid)', () => {
        const expenses = [
            { amount: 100, is_fixed: true },
            { amount: 200, is_fixed: false },
        ]
        const { dailyExpense } = splitExpenses(expenses)
        expect(dailyExpense).toBe(300)
    })

    it('skips adjustment rows (bookkeeping only)', () => {
        const expenses = [
            { amount: 0, is_refill: true, metadata: { adjustment: true, ingredient: 'coffee_g', qty: 5 } },
            { amount: 50 },
        ]
        const { dailyExpense, refillNvl } = splitExpenses(expenses)
        expect(dailyExpense).toBe(50)
        expect(refillNvl).toBe(0)
    })

    it('refillTotal = refillNvl + refillFreeForm', () => {
        const expenses = [
            { amount: 1000, is_refill: true, metadata: { ingredient: 'sugar' } },
            { amount: 50, is_refill: true, metadata: { free_form: true } },
        ]
        const { refillTotal } = splitExpenses(expenses)
        expect(refillTotal).toBe(1050)
    })

    it('handles empty / null input', () => {
        expect(splitExpenses([])).toEqual({
            dailyExpense: 0, refillNvl: 0, refillFreeForm: 0, refillTotal: 0,
        })
        expect(splitExpenses(null)).toEqual({
            dailyExpense: 0, refillNvl: 0, refillFreeForm: 0, refillTotal: 0,
        })
    })
})

describe('computeCashFlowTotals (cờ cash_phase trên từng phiếu)', () => {
    const inShift = (amount, method = 'cash') => ({ amount, payment_method: method, invoice_metadata: { cash_phase: 'in_shift' } })
    const postClose = (amount, method = 'cash') => ({ amount, payment_method: method, invoice_metadata: { cash_phase: 'post_close' } })
    const legacy = (amount, method = 'cash') => ({ amount, payment_method: method }) // phiếu cũ, không cờ

    it("NVL cờ 'in_shift' + chi trong ca: cộng Thực thu, không trừ Thực nhận", () => {
        // tiền mặt 850, CK 237, tiền nhà 50 (ops), matcha 185 (NVL in_shift)
        const r = computeCashFlowTotals({
            liveCash: 850000, liveTransfer: 237000,
            payments: [inShift(185000)],
            shiftExpenses: [{ amount: 50000 }],
        })
        expect(r.inShiftCashOut).toBe(235000)
        expect(r.postCloseCashOut).toBe(0)
        expect(r.actualTotal).toBe(1322000)   // 850 + 237 + 235
        expect(r.takeHomeCash).toBe(850000)
        expect(r.takeHome).toBe(1087000)
    })

    it("NVL cờ 'post_close': không cộng Thực thu, trừ Thực nhận", () => {
        const r = computeCashFlowTotals({
            liveCash: 850000, liveTransfer: 237000,
            payments: [postClose(185000)],
            shiftExpenses: [{ amount: 50000 }],
        })
        expect(r.inShiftCashOut).toBe(50000)      // chỉ tiền nhà (ops)
        expect(r.postCloseCashOut).toBe(185000)
        expect(r.actualTotal).toBe(1137000)       // 850 + 237 + 50
        expect(r.takeHomeCash).toBe(665000)       // 850 − 185
        expect(r.takeHome).toBe(902000)
    })

    it('phiếu cũ KHÔNG cờ → mặc định sau chốt (giữ nguyên số lịch sử)', () => {
        const r = computeCashFlowTotals({
            liveCash: 850000, liveTransfer: 237000,
            payments: [legacy(185000)],
            shiftExpenses: [],
        })
        expect(r.inShiftRefillCash).toBe(0)
        expect(r.postCloseCashOut).toBe(185000)
        expect(r.actualTotal).toBe(1087000)   // 850 + 237 (không cộng NVL cũ)
        expect(r.takeHomeCash).toBe(665000)   // 850 − 185 (như cũ)
    })

    it('chi phí "Sau chốt ca" (free_form, không payment): trừ Thực nhận, không cộng Thực thu', () => {
        // Đồ cúng 85k sau chốt — bug cũ: bị bỏ sót khỏi Thực nhận.
        const r = computeCashFlowTotals({
            liveCash: 13057000, liveTransfer: 3670000,
            payments: [postClose(7476000)],
            shiftExpenses: [],
            afterShiftExpenses: [{ amount: 85000, payment_method: 'cash', is_refill: true, metadata: { free_form: true } }],
        })
        expect(r.postCloseCashOut).toBe(7561000)      // 7.476 + 85
        expect(r.takeHomeCash).toBe(5496000)          // 13.057 − 7.561
        expect(r.actualTotal).toBe(16727000)          // 13.057 + 3.670 (free_form KHÔNG cộng Thực thu)
    })

    it('CK trả NCC: luôn trừ Thực nhận CK, không cộng Thực thu (kể cả cờ in_shift)', () => {
        const r = computeCashFlowTotals({
            liveCash: 850000, liveTransfer: 237000,
            payments: [inShift(100000, 'transfer')],
            shiftExpenses: [],
        })
        expect(r.transferRefill).toBe(100000)
        expect(r.inShiftCashOut).toBe(0)
        expect(r.actualTotal).toBe(1087000)
        expect(r.takeHomeTransfer).toBe(137000)    // 237 − 100
        expect(r.takeHome).toBe(987000)
    })

    it('cờ cash_phase trên TỪNG payment ưu tiên hơn cờ của hoá đơn gốc', () => {
        // Hoá đơn nhập 'in_shift', nhưng lần trả nợ này chọn "Sau chốt ca" → trừ Thực nhận.
        const paidPostClose = { amount: 200000, payment_method: 'cash', cash_phase: 'post_close', invoice_metadata: { cash_phase: 'in_shift' } }
        // Ngược lại: hoá đơn 'post_close', trả nợ "Trong ca" → cộng Thực thu.
        const paidInShift = { amount: 100000, payment_method: 'cash', cash_phase: 'in_shift', invoice_metadata: { cash_phase: 'post_close' } }
        const r = computeCashFlowTotals({
            liveCash: 500000, liveTransfer: 0,
            payments: [paidPostClose, paidInShift],
            shiftExpenses: [],
        })
        expect(r.inShiftRefillCash).toBe(100000)
        expect(r.postCloseCashOut).toBe(200000)
        expect(r.actualTotal).toBe(600000)         // 500 + 100 in-shift
        expect(r.takeHomeCash).toBe(300000)        // 500 − 200 post-close
    })

    it('bỏ qua payment adjustment', () => {
        const r = computeCashFlowTotals({
            liveCash: 100000, liveTransfer: 0,
            payments: [{ amount: 999, payment_method: 'cash', invoice_metadata: { adjustment: true, cash_phase: 'in_shift' } }],
            shiftExpenses: [],
        })
        expect(r.inShiftCashOut).toBe(0)
        expect(r.actualTotal).toBe(100000)
    })

    it('input rỗng', () => {
        const r = computeCashFlowTotals({ liveCash: 0, liveTransfer: 0 })
        expect(r).toMatchObject({ actualTotal: 0, takeHomeCash: 0, takeHomeTransfer: 0, takeHome: 0 })
    })

    it('allows negative takeHome values when postCloseCashOut/transferRefill exceeds live cash/transfer', () => {
        const r = computeCashFlowTotals({
            liveCash: 10000, liveTransfer: 20000,
            payments: [postClose(50000), inShift(60000, 'transfer')],
            shiftExpenses: [],
        })
        expect(r.takeHomeCash).toBe(-40000)
        expect(r.takeHomeTransfer).toBe(-40000)
        expect(r.takeHome).toBe(-80000)
    })
})

describe('aggregateOrderStats discount', () => {
    const base = {
        productMap: new Map(),
        extraPriceMap: {},
        extraNameMap: {},
        recipes: [],
        extraIngredients: [],
        ingredientCosts: {},
    }

    it('sums discount_amount into totalDiscount; totalRevenue stays net', () => {
        const orders = [
            { total: 12000, discount_amount: 4000, order_items: [] },
            { total: 16000, discount_amount: 0, order_items: [] },
        ]
        const { totalRevenue, totalDiscount } = aggregateOrderStats({ orders, ...base })
        expect(totalRevenue).toBe(28000) // net (already-discounted) totals
        expect(totalDiscount).toBe(4000)
    })

    it('reads the offline-shaped discountAmount field too', () => {
        const orders = [{ total: 9000, discountAmount: 1000, cart: [] }]
        const { totalDiscount } = aggregateOrderStats({ orders, ...base })
        expect(totalDiscount).toBe(1000)
    })

    it('skips deleted orders', () => {
        const orders = [
            { total: 12000, discount_amount: 4000, deleted_at: '2026-05-31T00:00:00Z', order_items: [] },
            { total: 16000, discount_amount: 2000, order_items: [] },
        ]
        const { totalRevenue, totalDiscount } = aggregateOrderStats({ orders, ...base })
        expect(totalRevenue).toBe(16000)
        expect(totalDiscount).toBe(2000)
    })
})

describe('dedupeShiftClosingsByDay (1 phiếu mới nhất/ngày VN)', () => {
    it('giữ phiếu mới nhất khi 1 ngày có nhiều phiếu (case 2026-04-18 thật, 4 phiếu)', () => {
        // closed_at theo UTC; tất cả rơi vào cùng ngày VN 2026-04-18.
        const closings = [
            { id: 'a', closed_at: '2026-04-18T10:08:33Z', actual_cash: 750000, actual_transfer: 333000 },
            { id: 'b', closed_at: '2026-04-18T10:08:20Z', actual_cash: 0, actual_transfer: 200000 },
            { id: 'c', closed_at: '2026-04-18T10:08:02Z', actual_cash: 600000, actual_transfer: 100000 },
            { id: 'd', closed_at: '2026-04-18T02:11:42Z', actual_cash: 133000, actual_transfer: 45000 },
        ]
        const out = dedupeShiftClosingsByDay(closings)
        expect(out).toHaveLength(1)
        expect(out[0].id).toBe('a') // max closed_at
        const cash = out.reduce((s, c) => s + c.actual_cash, 0)
        expect(cash).toBe(750000) // không còn cộng dồn 4 phiếu (1.483.000)
    })

    it('giữ nguyên khi mỗi ngày chỉ 1 phiếu, sắp theo closed_at DESC', () => {
        const closings = [
            { id: 'x', closed_at: '2026-06-10T03:00:00Z', actual_cash: 100 },
            { id: 'y', closed_at: '2026-06-11T03:00:00Z', actual_cash: 200 },
        ]
        const out = dedupeShiftClosingsByDay(closings)
        expect(out.map(c => c.id)).toEqual(['y', 'x'])
    })

    it('an toàn với mảng rỗng / null', () => {
        expect(dedupeShiftClosingsByDay([])).toEqual([])
        expect(dedupeShiftClosingsByDay(null)).toEqual([])
    })

    it('dùng created_at khi thiếu closed_at', () => {
        const closings = [
            { id: 'p', created_at: '2026-05-01T04:00:00Z', actual_cash: 10 },
            { id: 'q', created_at: '2026-05-01T05:00:00Z', actual_cash: 20 },
        ]
        const out = dedupeShiftClosingsByDay(closings)
        expect(out).toHaveLength(1)
        expect(out[0].id).toBe('q')
    })
})
