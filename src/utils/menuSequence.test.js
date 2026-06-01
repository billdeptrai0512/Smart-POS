import { describe, it, expect, vi } from 'vitest'
import {
    MENU_SEQUENCE, MENU_BOUNDARY_ROUTE,
    menuStep, menuNext, menuPrev, goToMenuStep,
} from './menuSequence'

describe('MENU_SEQUENCE shape', () => {
    it('is the 6-stop dashboard line in order', () => {
        expect(MENU_SEQUENCE.map(s => s.key)).toEqual([
            'orders', 'expense', 'report', 'recipes', 'main', 'packaging',
        ])
    })
})

describe('menuStep (bounded line, not a loop)', () => {
    it('steps forward through adjacent stops', () => {
        expect(menuStep('orders', +1).key).toBe('expense')
        expect(menuStep('expense', +1).key).toBe('report')
        expect(menuStep('report', +1).key).toBe('recipes')
        expect(menuStep('main', +1).key).toBe('packaging')
    })
    it('steps backward through adjacent stops', () => {
        expect(menuStep('packaging', -1).key).toBe('main')
        expect(menuStep('report', -1).key).toBe('expense')
    })
    it('returns null past the last stop (goNext from Bao bì)', () => {
        expect(menuStep('packaging', +1)).toBeNull()
    })
    it('returns null before the first stop (goBack from Thu nhập)', () => {
        expect(menuStep('orders', -1)).toBeNull()
    })
    it('falls back to the first stop for an unknown key', () => {
        expect(menuStep('nope', +1).key).toBe('orders')
        expect(menuStep(undefined, -1).key).toBe('orders')
    })
    it('menuNext / menuPrev are thin wrappers', () => {
        expect(menuNext('orders').key).toBe('expense')
        expect(menuPrev('expense').key).toBe('orders')
    })
})

describe('goToMenuStep', () => {
    const makeCtx = (over = {}) => ({
        navigate: vi.fn(),
        backTo: '/pos',
        setActiveTab: vi.fn(),
        setViewMode: vi.fn(),
        goReport: vi.fn(),
        ...over,
    })

    it('exits to /pos stepping off the start (orders ‹ back)', () => {
        const ctx = makeCtx()
        goToMenuStep('orders', -1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith(MENU_BOUNDARY_ROUTE)
    })

    it('exits to /pos stepping off the end (packaging › fwd)', () => {
        const ctx = makeCtx()
        goToMenuStep('packaging', +1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith(MENU_BOUNDARY_ROUTE)
    })

    it('same-route tab flip (orders→expense) sets activeTab, no navigation', () => {
        const ctx = makeCtx()
        goToMenuStep('orders', +1, ctx)
        expect(ctx.setActiveTab).toHaveBeenCalledWith('expense')
        expect(ctx.navigate).not.toHaveBeenCalled()
    })

    it('same-route view flip (packaging→main) sets viewMode, no navigation', () => {
        const ctx = makeCtx()
        goToMenuStep('packaging', -1, ctx)
        expect(ctx.setViewMode).toHaveBeenCalledWith('main')
        expect(ctx.navigate).not.toHaveBeenCalled()
    })

    it('cross-route to /daily-report prefers goReport when provided', () => {
        const ctx = makeCtx()
        goToMenuStep('expense', +1, ctx) // → report
        expect(ctx.goReport).toHaveBeenCalledTimes(1)
        expect(ctx.navigate).not.toHaveBeenCalled()
    })

    it('cross-route to /daily-report falls back to navigate + scopeState when no goReport', () => {
        const ctx = makeCtx({ goReport: undefined, scopeState: { scope: 'week', offset: -1 } })
        goToMenuStep('expense', +1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/daily-report', {
            state: { from: '/pos', scope: 'week', offset: -1 },
        })
    })

    it('report → recipes navigates with from state', () => {
        const ctx = makeCtx()
        goToMenuStep('report', +1, ctx)
        expect(ctx.navigate).toHaveBeenCalledWith('/recipes', { state: { from: '/pos' } })
    })

    it('recipes → ingredients carries viewMode', () => {
        const ctx = makeCtx()
        goToMenuStep('recipes', +1, ctx) // → main
        expect(ctx.navigate).toHaveBeenCalledWith('/ingredients', {
            state: { from: '/pos', viewMode: 'main' },
        })
    })

    it('report ‹ back to /history carries scopeState (the desync-fix path)', () => {
        const ctx = makeCtx({ scopeState: { scope: 'custom', customRange: { startISO: '2026-05-10', endISO: '2026-05-14' } } })
        goToMenuStep('report', -1, ctx) // → expense (/history)
        expect(ctx.navigate).toHaveBeenCalledWith('/history', {
            state: { from: '/pos', tab: 'expense', scope: 'custom', customRange: { startISO: '2026-05-10', endISO: '2026-05-14' } },
        })
    })
})
