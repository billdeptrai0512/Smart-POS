import { describe, it, expect } from 'vitest'
import { productionUsage, overlayProduction, productionAfterCount, type ProductionRow } from './production'
import { dateStringVN } from './dateVN'

const at = (iso: string, extra: Partial<ProductionRow> = {}): ProductionRow =>
    ({ created_at: iso, output_ingredient: 'tp', output_qty: 600, inputs: { a: 250, b: 100 }, ...extra })

describe('production usage', () => {
    it('raw +inputs, finished −output, cancelled ignored', () => {
        expect(productionUsage([at('2026-10-18T03:00:00Z'), at('2026-10-18T04:00:00Z', { cancelled_at: 'x' })])).toEqual({ a: 250, b: 100, tp: -600 })
    })
    it('overlay adds to the matching day only', () => {
        const day = dateStringVN(new Date('2026-10-18T03:00:00Z'))
        const out = overlayProduction({ [day]: { a: 10, tp: 100 }, '2000-01-01': { a: 1 } }, [at('2026-10-18T03:00:00Z'), at('2026-11-01T03:00:00Z')])
        expect(out[day]).toEqual({ a: 260, b: 100, tp: -500 })
        expect(out['2000-01-01']).toEqual({ a: 1 })
    })
    it('afterCount only counts batches at/after the count time on the counted day', () => {
        const day = dateStringVN(new Date('2026-10-18T03:00:00Z'))
        const rows = [{ ingredient: 'tp', counter_counted_on: day, counter_counted_at: '2026-10-18T03:30:00Z' }]
        expect(productionAfterCount(rows, [at('2026-10-18T03:00:00Z'), at('2026-10-18T04:00:00Z')])).toEqual({ tp: -600 })
    })
})
