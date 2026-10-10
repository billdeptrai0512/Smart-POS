import { describe, it, expect } from 'vitest'
import { billFooter, priceLineFor } from './billLines'

describe('billFooter', () => {
    it('giảm theo dòng: TIỀN HÀNG = tổng cột TT, không trừ lại lần 2', () => {
        // 2 trà sữa 35k -25% + 1 bạc xỉu 22k đồng giá 10k
        const lines = [{ discountAmount: 17500 }, { discountAmount: 12000 }]
        expect(billFooter(lines, 92000, 29500)).toMatchObject({ goods: 62500, orderDiscount: 0 })
    })
    it('đơn cũ giảm cả đơn: vẫn in GIẢM GIÁ, % chỉ khi chính xác', () => {
        const lines = [{ discountAmount: 0 }]
        expect(billFooter(lines, 100000, 10000)).toEqual({ goods: 100000, orderDiscount: 10000, discountLabel: 'GIẢM GIÁ (10%)' })
        expect(billFooter(lines, 120000, 5000).discountLabel).toBe('GIẢM GIÁ')
    })
})

describe('priceLineFor', () => {
    it('topping (toàn cục) cộng giá + in như tùy chọn riêng', () => {
        const products = [{ id: 'p', name: 'Trà sữa', price: 30000 }]
        const productExtras = { p: [{ id: 'e', name: 'Ít đá', price: 0 }] }
        const toppings = [{ id: 't', name: 'Trân châu', price: 5000 }]
        const line = priceLineFor({ productId: 'p', extraIds: ['e'], toppingIds: ['t'] }, products, productExtras, toppings)
        expect(line.unitPrice).toBe(35000)
        expect(line.extras.map(e => e.name)).toEqual(['Ít đá', 'Trân châu'])
    })
})
