// Common — onTabReturn: chỉ chạy callback khi tab quay lại SAU KHI đi vắng đủ lâu.
// Nguồn: src/utils/tabVisibility.js
//
// Luật này là cái chặn vòng lặp fetch: visibilitychange bắn dồn dập (chuyển app, khoá
// màn hình) và các context nghe nó đều fetch → set state → fetch. Sai ở đây = 3 RPC
// lặp vài giây một lần trên mọi route (xem AddressStatsContext, OnboardingGuide).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { onTabReturn } from '../../src/utils/tabVisibility'

// document giả: giữ handler để test tự bắn event và tự đặt visibilityState.
let handlers
function fakeDocument() {
    handlers = new Set()
    globalThis.document = {
        visibilityState: 'visible',
        addEventListener: (type, fn) => { if (type === 'visibilitychange') handlers.add(fn) },
        removeEventListener: (type, fn) => { if (type === 'visibilitychange') handlers.delete(fn) },
    }
}
const fire = (state) => { globalThis.document.visibilityState = state; handlers.forEach(fn => fn()) }

describe('onTabReturn', () => {
    beforeEach(() => {
        fakeDocument()
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-08-13T08:00:00Z'))
    })

    it('chạy khi đi vắng quá ngưỡng', () => {
        const cb = vi.fn()
        onTabReturn(cb)
        fire('hidden')
        vi.advanceTimersByTime(31_000)
        fire('visible')
        expect(cb).toHaveBeenCalledTimes(1)
    })

    it('chuỗi hidden/visible chớp nhoáng không dồn thành nhiều lần chạy', () => {
        const cb = vi.fn()
        onTabReturn(cb)
        for (let i = 0; i < 10; i++) {
            fire('hidden')
            vi.advanceTimersByTime(2000)
            fire('visible')
            vi.advanceTimersByTime(2000)
        }
        expect(cb).not.toHaveBeenCalled()
    })

    it("nhiều event 'visible' liên tiếp (không có 'hidden' xen giữa) chỉ chạy 1 lần", () => {
        const cb = vi.fn()
        onTabReturn(cb)
        vi.advanceTimersByTime(60_000)
        fire('visible')
        fire('visible')
        fire('visible')
        expect(cb).toHaveBeenCalledTimes(1)
    })
})
