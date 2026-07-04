// Text — capitalizeWords (tự viết hoa chữ đầu).
// Nguồn: src/utils/text.js

import { describe, it, expect } from 'vitest'
import { capitalizeWords } from '../../src/utils/text'

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
