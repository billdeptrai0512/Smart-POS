// Chương trình giảm giá theo loại bàn (table_scope) — mirror điều kiện trong bulk_create_orders
// (supabase/migrations/20261026_discount_program_table_scope.sql). Nguồn: src/utils/discountPrograms.ts
import { describe, it, expect } from 'vitest'
import { resolveDiscountedPrice, type DiscountProgram, type TableScope } from '../../src/utils/discountPrograms'
import { repriceCart } from '../../src/services/cartOps'

const prog = (table_scope: TableScope): DiscountProgram =>
    ({ id: 'd1', name: 'Mang đi -20%', enabled: true, start_date: null, end_date: null, days_of_week: [], type: 'percent', value: 20, table_scope })

describe('table_scope', () => {
    it('takeaway chỉ giảm khi không có bàn', () => {
        expect(resolveDiscountedPrice(100, [prog('takeaway')], '')).toBe(80)
        expect(resolveDiscountedPrice(100, [prog('takeaway')], null)).toBe(80)
        expect(resolveDiscountedPrice(100, [prog('takeaway')], 'Bàn 1')).toBeNull()
    })
    it('dine_in chỉ giảm khi có bàn', () => {
        expect(resolveDiscountedPrice(100, [prog('dine_in')], 'Bàn 1')).toBe(80)
        expect(resolveDiscountedPrice(100, [prog('dine_in')], '')).toBeNull()
    })
    it('all và chương trình cũ (không có table_scope) luôn áp dụng; undefined = không lọc', () => {
        expect(resolveDiscountedPrice(100, [prog('all')], 'Bàn 1')).toBe(80)
        expect(resolveDiscountedPrice(100, [{ ...prog('all'), table_scope: undefined }], '')).toBe(80)
        expect(resolveDiscountedPrice(100, [prog('takeaway')])).toBe(80)
    })
    it('repriceCart tính lại khi đổi bàn, không đổi gì thì trả đúng mảng cũ', () => {
        const products = [{ id: 'p1', price: 100 }]
        const discounts = { p1: [prog('takeaway')] }
        const line = { cartItemId: 'c1', productId: 'p1', name: 'A', basePrice: 100, quantity: 1, extras: [], toppings: [] }
        const takeaway = repriceCart([line], products, discounts, '')
        expect(takeaway[0].basePrice).toBe(80)
        const dine = repriceCart(takeaway, products, discounts, 'Bàn 1')
        expect(dine[0].basePrice).toBe(100)
        expect(repriceCart(dine, products, discounts, 'Bàn 2')).toBe(dine)
    })
})
