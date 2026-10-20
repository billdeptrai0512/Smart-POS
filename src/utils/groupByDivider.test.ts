import { describe, it, expect } from 'vitest'
import { groupByDivider } from './groupByDivider'

const d = (name: string) => ({ name, is_divider: true })
const p = (name: string) => ({ name })

describe('groupByDivider', () => {
    it('chia theo divider, bỏ nhóm rỗng, nhóm đầu không tên', () => {
        const g = groupByDivider([p('a'), d('X'), p('b'), p('c'), d('Y'), d('Z'), p('e')])
        expect(g.map(x => [x.name, x.items.map(i => i.name)])).toEqual([[null, ['a']], ['X', ['b', 'c']], ['Z', ['e']]])
    })
    it('keep lọc món, nhóm hết món thì ẩn', () => {
        const g = groupByDivider([d('X'), p('b'), d('Y'), p('c')], i => i.name === 'c')
        expect(g.map(x => x.name)).toEqual(['Y'])
    })
})
