import { describe, it, expect } from 'vitest'
import { orderStep, STEPS } from '../../src/components/common/onboarding/steps'
import { DEFAULT_ONBOARDING_STATE } from '../../src/utils/onboardingStorage'

const firstUndone = (items: { label: string; done: boolean }[]) => items.find(i => !i.done)?.label

describe('guide nhắc nút bấm khi đã đủ việc', () => {
    it('Tạo đơn: đủ món → nhắc bấm Tạo đơn, chưa đủ → vẫn tên món', () => {
        const op = DEFAULT_ONBOARDING_STATE.orderProgress
        expect(firstUndone(orderStep.items({ orderProgress: op }))).toBe('Khách gọi 1 cà phê sữa')
        expect(firstUndone(orderStep.items({ orderProgress: { ...op, ready: true } }))).toMatch(/Tạo đơn/)
        // đơn 2 đủ 2 món → dòng matcha đổi nhãn, không phải dòng đã tick
        expect(firstUndone(orderStep.items({ orderProgress: { ...op, sent: 1, picked: 2, ready: true } }))).toMatch(/Tạo đơn/)
    })

    it('Tồn kho: Sử dụng → Lý thuyết → Cuối kỳ → Lưu', () => {
        const ctx = { ...DEFAULT_ONBOARDING_STATE, recipeRows: [] }
        const inv = STEPS[2]
        const inventory = (patch: Partial<typeof ctx.inventoryProgress>) => inv.items({ ...ctx, inventoryProgress: { ...ctx.inventoryProgress, ...patch } })
        expect(firstUndone(inventory({}))).toMatch(/chi tiết/)
        expect(firstUndone(inventory({ usedOpened: true }))).toMatch(/công thức/)
        expect(firstUndone(inventory({ usedOpened: true, theory: 951 }))).toMatch(/951g/)
        expect(firstUndone(inventory({ usedOpened: true, theoryOpened: true }))).toMatch(/cuối kỳ/)
        // nhập luôn mà bỏ qua 2 ô đầu thì không kẹt
        expect(inventory({ coffee: true }).every(i => i.done)).toBe(true)
        expect(firstUndone(inv.items({ ...ctx, inventoryProgress: { ...ctx.inventoryProgress, usedOpened: true, theoryOpened: true, typed: true } }))).toMatch(/Lưu/)
    })
})
