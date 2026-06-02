import { describe, it, expect } from 'vitest'
import { splitExpenses, aggregateOrderStats, computeCashFlowTotals } from './reportStats'

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

describe('computeCashFlowTotals (phân loại theo chốt ca tiền)', () => {
    const CLOSE = '2026-06-02T15:00:00+07:00'
    const before = '2026-06-02T10:00:00+07:00'
    const after = '2026-06-02T18:00:00+07:00'

    it('chưa chốt (null): NVL + chi trong ca tiền mặt đều cộng vào Thực thu, không trừ Thực nhận', () => {
        // User case: tiền mặt 850, CK 237, tiền nhà 50 (ops), matcha 185 (NVL cash)
        const r = computeCashFlowTotals({
            liveCash: 850000, liveTransfer: 237000,
            payments: [{ amount: 185000, payment_method: 'cash', paid_at: before }],
            shiftExpenses: [{ amount: 50000, created_at: before }],
            cashClosedAt: null,
        })
        expect(r.inShiftCashOut).toBe(235000)
        expect(r.postCloseCashOut).toBe(0)
        expect(r.actualTotal).toBe(1322000)   // 850 + 237 + 235
        expect(r.takeHomeCash).toBe(850000)   // không trừ lặp
        expect(r.takeHome).toBe(1087000)      // 850 + 237
    })

    it('đã chốt, mua SAU chốt: không cộng Thực thu, trừ Thực nhận', () => {
        const r = computeCashFlowTotals({
            liveCash: 850000, liveTransfer: 237000,
            payments: [{ amount: 185000, payment_method: 'cash', paid_at: after }],
            shiftExpenses: [{ amount: 50000, created_at: before }],
            cashClosedAt: CLOSE,
        })
        expect(r.inShiftCashOut).toBe(50000)      // chỉ tiền nhà trước chốt
        expect(r.postCloseCashOut).toBe(185000)   // matcha sau chốt
        expect(r.actualTotal).toBe(1137000)       // 850 + 237 + 50
        expect(r.takeHomeCash).toBe(665000)       // 850 − 185
        expect(r.takeHome).toBe(902000)
    })

    it('đã chốt, mua TRƯỚC chốt: cộng Thực thu, không trừ Thực nhận', () => {
        const r = computeCashFlowTotals({
            liveCash: 850000, liveTransfer: 237000,
            payments: [{ amount: 185000, payment_method: 'cash', paid_at: before }],
            shiftExpenses: [],
            cashClosedAt: CLOSE,
        })
        expect(r.inShiftCashOut).toBe(185000)
        expect(r.postCloseCashOut).toBe(0)
        expect(r.actualTotal).toBe(1272000)   // 850 + 237 + 185
        expect(r.takeHomeCash).toBe(850000)
    })

    it('CK trả NCC: luôn trừ Thực nhận CK, không cộng Thực thu (bất kể phase)', () => {
        const r = computeCashFlowTotals({
            liveCash: 850000, liveTransfer: 237000,
            payments: [{ amount: 100000, payment_method: 'transfer', paid_at: before }],
            shiftExpenses: [],
            cashClosedAt: null,
        })
        expect(r.transferRefill).toBe(100000)
        expect(r.inShiftCashOut).toBe(0)
        expect(r.actualTotal).toBe(1087000)        // không cộng CK refill
        expect(r.takeHomeTransfer).toBe(137000)    // 237 − 100
        expect(r.takeHome).toBe(987000)            // 850 + 137
    })

    it('bỏ qua payment adjustment', () => {
        const r = computeCashFlowTotals({
            liveCash: 100000, liveTransfer: 0,
            payments: [{ amount: 999, payment_method: 'cash', paid_at: before, invoice_metadata: { adjustment: true } }],
            shiftExpenses: [],
            cashClosedAt: null,
        })
        expect(r.inShiftCashOut).toBe(0)
        expect(r.actualTotal).toBe(100000)
    })

    it('input rỗng', () => {
        const r = computeCashFlowTotals({ liveCash: 0, liveTransfer: 0 })
        expect(r).toMatchObject({ actualTotal: 0, takeHomeCash: 0, takeHomeTransfer: 0, takeHome: 0 })
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
