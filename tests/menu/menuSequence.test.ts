// Menu — thứ tự MENU_SEQUENCE.
// Nguồn: src/utils/menuSequence.ts

import { describe, it, expect, vi } from 'vitest'
import {
    MENU_SEQUENCE, MENU_BOUNDARY_ROUTE,
    menuStep, goToMenuStep,
} from '../../src/utils/menuSequence'

describe('MENU_SEQUENCE shape', () => {
    it('is the 4-stop dashboard line in order (Nhật ký → Báo cáo → Tồn kho → Công thức)', () => {
        expect(MENU_SEQUENCE.map(s => s.key)).toEqual([
            'sales', 'report', 'main', 'recipes',
        ])
    })
})

describe('menuStep (bounded line, not a loop)', () => {
    it('steps forward through adjacent stops', () => {
        expect(menuStep('sales', +1).key).toBe('report')
        expect(menuStep('report', +1).key).toBe('main')
        expect(menuStep('main', +1).key).toBe('recipes')
    })
    it('steps backward through adjacent stops', () => {
        expect(menuStep('recipes', -1).key).toBe('main')
        expect(menuStep('main', -1).key).toBe('report')
        expect(menuStep('report', -1).key).toBe('sales')
    })
    it('returns null past the last stop (goNext from Công thức)', () => {
        expect(menuStep('recipes', +1)).toBeNull()
    })
    it('returns null before the first stop (goBack from Nhật ký)', () => {
        expect(menuStep('sales', -1)).toBeNull()
    })
    it('falls back to the first stop for an unknown key', () => {
        expect(menuStep('nope', +1).key).toBe('sales')
        expect(menuStep(undefined, -1).key).toBe('sales')
    })
    it('resolves sub-tab keys to their page stop', () => {
        expect(menuStep('expense', +1).key).toBe('report')
        expect(menuStep('expense', -1)).toBeNull()
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
        goToMenuStep('sales', -1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/address')
    })

    it('exits to /pos stepping off the end (recipes › fwd)', () => {
        const ctx = makeCtx({ backTo: '/address' })
        goToMenuStep('recipes', +1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith(MENU_BOUNDARY_ROUTE)
    })

    it('orders › goes to /report/cashflow carrying the date window', () => {
        const scopeState = { scope: 'week', offset: -1 }
        const ctx = makeCtx({ scopeState })
        goToMenuStep('sales', +1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/report/cashflow', {
            state: { from: '/pos', wizard: true, ...scopeState },
        })
    })

    it('report › goes to /inventory/management with from state', () => {
        const ctx = makeCtx()
        goToMenuStep('report', +1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/inventory/management', {
            state: { from: '/pos', wizard: true },
        })
    })

    it('back to /history/sales from report navigates with state', () => {
        const ctx = makeCtx({ wizard: true })
        goToMenuStep('report', -1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/history/sales', {
            state: { from: '/pos', wizard: true },
        })
    })
})
