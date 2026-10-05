// Menu — thứ tự MENU_SEQUENCE.
// Nguồn: src/utils/menuSequence.js

import { describe, it, expect, vi } from 'vitest'
import {
    MENU_SEQUENCE, MENU_BOUNDARY_ROUTE,
    menuStep, goToMenuStep,
} from '../../src/utils/menuSequence'

describe('MENU_SEQUENCE shape', () => {
    it('is the 3-stop dashboard line in order (Nhật ký → Báo cáo → Tồn kho)', () => {
        expect(MENU_SEQUENCE.map(s => s.key)).toEqual([
            'orders', 'report', 'main',
        ])
    })
})

describe('menuStep (bounded line, not a loop)', () => {
    it('steps forward through adjacent stops', () => {
        expect(menuStep('orders', +1).key).toBe('report')
        expect(menuStep('report', +1).key).toBe('main')
    })
    it('steps backward through adjacent stops', () => {
        expect(menuStep('main', -1).key).toBe('report')
        expect(menuStep('report', -1).key).toBe('orders')
    })
    it('returns null past the last stop (goNext from Tồn kho)', () => {
        expect(menuStep('main', +1)).toBeNull()
    })
    it('returns null before the first stop (goBack from Nhật ký)', () => {
        expect(menuStep('orders', -1)).toBeNull()
    })
    it('falls back to the first stop for an unknown key', () => {
        expect(menuStep('nope', +1).key).toBe('orders')
        expect(menuStep(undefined, -1).key).toBe('orders')
    })
    it('resolves sub-tab keys to their page stop', () => {
        expect(menuStep('expense', +1).key).toBe('report')
        expect(menuStep('expense', -1)).toBeNull()
        // Công thức là sub-tab của Tồn kho
        expect(menuStep('recipes', +1)).toBeNull()
        expect(menuStep('recipes', -1).key).toBe('report')
    })
})

describe('goToMenuStep', () => {
    const makeCtx = (over = {}) => ({
        navigate: vi.fn(),
        backTo: '/pos',
        setActiveTab: vi.fn(),
        ...over,
    })

    it('exits to backTo stepping off the start (orders ‹ back)', () => {
        const ctx = makeCtx({ backTo: '/address' })
        goToMenuStep('orders', -1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/address')
    })

    it('exits to /pos stepping off the end (main › fwd)', () => {
        const ctx = makeCtx({ backTo: '/address' })
        goToMenuStep('main', +1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith(MENU_BOUNDARY_ROUTE)
    })

    it('orders › goes to /daily-report carrying the date window', () => {
        const scopeState = { scope: 'week', offset: -1 }
        const ctx = makeCtx({ scopeState })
        goToMenuStep('orders', +1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/daily-report', {
            state: { from: '/pos', wizard: true, ...scopeState },
        })
    })

    it('report › goes to /ingredients with from state', () => {
        const ctx = makeCtx()
        goToMenuStep('report', +1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/ingredients', {
            state: { from: '/pos', wizard: true },
        })
    })

    it('cross-route back to /history from report navigates with state', () => {
        const ctx = makeCtx({ wizard: true })
        goToMenuStep('report', -1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/history', {
            state: { from: '/pos', tab: 'orders', wizard: true },
        })
    })
})
