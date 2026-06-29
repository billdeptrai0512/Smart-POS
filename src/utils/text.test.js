import { describe, it, expect } from 'vitest'
import { capitalizeWords } from './text'

describe('capitalizeWords', () => {
    it('uppercases first letter of each word', () => {
        expect(capitalizeWords('nguyễn văn b')).toBe('Nguyễn Văn B')
    })
    it('handles Vietnamese đ and leading space', () => {
        expect(capitalizeWords(' đào thị')).toBe(' Đào Thị')
    })
    it('preserves length (case-only)', () => {
        const s = 'trà sữa trân châu'
        expect(capitalizeWords(s).length).toBe(s.length)
    })
})
