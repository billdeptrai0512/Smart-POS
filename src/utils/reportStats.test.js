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
