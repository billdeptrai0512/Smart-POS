import { describe, it, expect, vi } from 'vitest'
import {
    MENU_SEQUENCE, MENU_BOUNDARY_ROUTE,
    menuStep, menuNext, menuPrev, goToMenuStep,
} from './menuSequence'

describe('MENU_SEQUENCE shape', () => {
    it('is the 2-stop dashboard line in order', () => {
        expect(MENU_SEQUENCE.map(s => s.key)).toEqual([
            'orders', 'recipes',
        ])
    })
})

describe('menuStep (bounded line, not a loop)', () => {
    it('steps forward through adjacent stops', () => {
        expect(menuStep('orders', +1).key).toBe('recipes')
    })
    it('steps backward through adjacent stops', () => {
        expect(menuStep('recipes', -1).key).toBe('orders')
    })
    it('returns null past the last stop (goNext from Nguyên liệu)', () => {
        expect(menuStep('recipes', +1)).toBeNull()
    })
    it('returns null before the first stop (goBack from Thu nhập)', () => {
        expect(menuStep('orders', -1)).toBeNull()
    })
    it('falls back to the first stop for an unknown key', () => {
        expect(menuStep('nope', +1).key).toBe('orders')
        expect(menuStep(undefined, -1).key).toBe('orders')
    })
    it('resolves legacy or non-wizard keys to their closest stops', () => {
        expect(menuStep('expense', +1).key).toBe('recipes')
        expect(menuStep('expense', -1)).toBeNull()
        expect(menuStep('report', +1).key).toBe('recipes')
        expect(menuStep('main', +1)).toBeNull()
        expect(menuStep('main', -1).key).toBe('orders')
        expect(menuStep('packaging', +1)).toBeNull()
        expect(menuStep('packaging', -1).key).toBe('orders')
    })
    it('menuNext / menuPrev are thin wrappers', () => {
        expect(menuNext('orders').key).toBe('recipes')
        expect(menuPrev('recipes').key).toBe('orders')
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

    it('cross-route to /recipes navigates with from state', () => {
        const ctx = makeCtx()
        goToMenuStep('orders', +1, ctx) // orders → recipes
        expect(ctx.navigate).toHaveBeenCalledWith('/recipes', {
            state: { from: '/pos', wizard: true },
        })
    })

    it('cross-route back to /history from main navigates with state', () => {
        const ctx = makeCtx({ wizard: true })
        goToMenuStep('main', -1, ctx) // main → orders
        expect(ctx.navigate).toHaveBeenCalledWith('/history', {
            state: { from: '/pos', tab: 'orders', wizard: true },
        })
    })
})
