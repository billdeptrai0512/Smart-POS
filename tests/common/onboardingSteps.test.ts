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

    it('Bán hàng: có món trong giỏ → nhắc bấm Tạo đơn; gửi 1 đơn là xong', () => {
        const order = (p: Partial<typeof ctx.orderProgress>) => step('Bán hàng').items({ ...ctx, orderProgress: { ...ctx.orderProgress, ...p } })
        expect(firstUndone(order({}))).toMatch(/Bán thử 1 đơn/)
        expect(firstUndone(order({ ready: true }))).toMatch(/Tạo đơn/)
        expect(order({ sent: 1 }).every(i => i.done)).toBe(true)
    })

    it('Kết ca: không hiện dải guide (số đã móm sẵn vào ô, ô tự sáng)', () => {
        expect(step('Kết ca').items(ctx).every(i => i.hideBar)).toBe(true)
    })

    it('Kiểm kê: Sử dụng → Lý thuyết → nhập, không dải guide', () => {
        const inv = step('Kiểm kê')
        const inventory = (patch: Partial<typeof ctx.inventoryProgress>) => inv.items({ ...ctx, inventoryProgress: { ...ctx.inventoryProgress, ...patch } })
        expect(firstUndone(inventory({}))).toMatch(/đã dùng/)
        expect(firstUndone(inventory({ usedOpened: true }))).toMatch(/Lý thuyết/)
        expect(firstUndone(inventory({ usedOpened: true, theoryOpened: true }))).toMatch(/Cuối kỳ/)
        expect(inventory({}).every(i => i.hideBar)).toBe(true)
        // nhập luôn mà bỏ qua 2 ô đầu thì không kẹt
        expect(inventory({ coffee: true }).every(i => i.done)).toBe(true)
    })
})
