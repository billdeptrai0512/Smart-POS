import { describe, it, expect } from 'vitest'
import { computeExtrasAfterIdx } from './menuGridLayout'

const p = (id) => ({ id })
const div = (id) => ({ id, is_divider: true })

describe('computeExtrasAfterIdx', () => {
    it('không có active → -1', () => {
        expect(computeExtrasAfterIdx([p(1), p(2)], -1)).toBe(-1)
    })

    it('không divider: cột trái chèn sau hàng xóm phải, cột phải chèn sau chính nó', () => {
        const list = [p(1), p(2), p(3), p(4)]
        expect(computeExtrasAfterIdx(list, 0)).toBe(1) // trái → sau phải
        expect(computeExtrasAfterIdx(list, 1)).toBe(1) // phải → chính nó
        expect(computeExtrasAfterIdx(list, 3)).toBe(3)
    })

    it('card cuối lẻ hàng (cột trái, không có hàng xóm) → chính nó', () => {
        expect(computeExtrasAfterIdx([p(1), p(2), p(3)], 2)).toBe(2)
    })

    it('divider reset cột: card sau divider là cột trái dù idx lẻ', () => {
        // [Trà sữa][__] / [--- CÀ PHÊ ---] / [Đen][Sữa]
        const list = [p(1), div('d'), p(2), p(3)]
        expect(computeExtrasAfterIdx(list, 2)).toBe(3) // Đen (idx 2, cột trái) → sau Sữa
        expect(computeExtrasAfterIdx(list, 3)).toBe(3)
        // Trà sữa (idx 0, cột trái) nhưng kế tiếp là divider → chính nó
        expect(computeExtrasAfterIdx(list, 0)).toBe(0)
    })
})
