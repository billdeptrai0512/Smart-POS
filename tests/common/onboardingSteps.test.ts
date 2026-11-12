import { describe, it, expect } from 'vitest'
import { STEPS } from '../../src/components/common/onboarding/steps'
import { DEFAULT_ONBOARDING_STATE } from '../../src/utils/onboardingStorage'

const firstUndone = (items: { label: string; done: boolean }[]) => items.find(i => !i.done)?.label
const ctx = DEFAULT_ONBOARDING_STATE
const step = (title: string) => STEPS.find(s => s.title === title)!

describe('guide "một ngày của quán"', () => {
    it('thứ tự 6 bước đi theo mũi tên tiến: Chuẩn bị → Bán → Nhật ký → Kết ca → Kiểm kê → Bổ sung', () => {
        expect(STEPS.map(s => s.title)).toEqual(['Chuẩn bị', 'Bán hàng', 'Nhật ký', 'Kết ca', 'Kiểm kê', 'Bổ sung tồn kho'])
    })

    it('Chuẩn bị: lấy đủ hàng, hiện tiến độ x/y (dải tự sáng nên không cần dòng nhắc bấm)', () => {
        const prep = (p: Partial<typeof ctx.prepProgress>) => step('Chuẩn bị').items({ ...ctx, prepProgress: { ...ctx.prepProgress, ...p } })
        expect(firstUndone(prep({}))).toMatch(/Lấy hàng từ kho ra quầy/)
        expect(firstUndone(prep({ opened: true, taken: 3, total: 9 }))).toMatch(/\(3\/9\)/)
        expect(prep({ opened: true, taken: 9, total: 9, done: true }).every(i => i.done)).toBe(true)
    })

    it('Bán hàng: 1 dòng chào, gửi 1 đơn là xong', () => {
        const order = (p: Partial<typeof ctx.orderProgress>) => step('Bán hàng').items({ ...ctx, orderProgress: { ...ctx.orderProgress, ...p } })
        expect(firstUndone(order({}))).toMatch(/KOPHiN xin chào/)
        expect(order({ sent: 1 }).every(i => i.done)).toBe(true)
    })

    it('Nhật ký: chỉ còn bước sang báo cáo kết ca, không dải guide', () => {
        const journal = (viewedReport: boolean) => step('Nhật ký').items({ ...ctx, journalProgress: { viewedReport } })
        expect(firstUndone(journal(false))).toMatch(/báo cáo kết ca/)
        expect(journal(true).every(i => i.done)).toBe(true)
        expect(journal(false).every(i => i.hideBar)).toBe(true)
    })

    it('Kết ca: bấm ô Tiền mặt hoặc Chuyển khoản (số hiện khi bấm, không điền sẵn), không dải guide', () => {
        const cash = (p: Partial<typeof ctx.cashFlowProgress>) => step('Kết ca').items({ ...ctx, cashFlowProgress: { ...ctx.cashFlowProgress, ...p } })
        expect(firstUndone(cash({}))).toMatch(/Tiền mặt hoặc Chuyển khoản/)
        expect(cash({ cash: true, transfer: true }).every(i => i.done)).toBe(true)
        expect(cash({}).every(i => i.hideBar)).toBe(true)
    })

    it('Kiểm kê: chỉ còn nhập Cuối kỳ cà phê (Sử dụng/Lý thuyết đã hiện sẵn), không dải guide', () => {
        const inv = step('Kiểm kê')
        const inventory = (patch: Partial<typeof ctx.inventoryProgress>) => inv.items({ ...ctx, inventoryProgress: { ...ctx.inventoryProgress, ...patch } })
        expect(firstUndone(inventory({}))).toMatch(/Cuối kỳ cà phê/)
        expect(inventory({}).every(i => i.hideBar)).toBe(true)
        expect(inventory({ coffee: true }).every(i => i.done)).toBe(true)
    })
})
