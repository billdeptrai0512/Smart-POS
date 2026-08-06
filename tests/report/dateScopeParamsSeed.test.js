// Báo cáo — readParamsSeed: đọc lựa chọn ngày từ URL, chuẩn hoá custom-1-ngày về day scope.
// Nguồn: src/hooks/useDateScope.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readParamsSeed } from '../../src/hooks/useDateScope'

const seed = (qs) => readParamsSeed(new URLSearchParams(qs))

describe('readParamsSeed', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        // 10/08/2026 12:00 giờ VN — đủ xa mốc nửa đêm để không phụ thuộc tz máy chạy test.
        vi.setSystemTime(new Date('2026-08-10T05:00:00Z'))
    })
    afterEach(() => vi.useRealTimers())

    it('custom có start === end → day scope kèm offset, không phải custom', () => {
        // Đây là điểm chính: nếu trả về scope 'custom' thì isRangeScope nói "1 ngày"
        // còn `scope === 'day'` ở chỗ khác nói "không phải" → 2 câu trả lời lệch nhau.
        expect(seed('scope=custom&start=2026-08-07&end=2026-08-07')).toEqual({ scope: 'day', offset: -3 })
    })

    it('custom cùng ngày hôm nay → offset 0', () => {
        expect(seed('scope=custom&start=2026-08-10&end=2026-08-10')).toEqual({ scope: 'day', offset: 0 })
    })

    it('custom nhiều ngày → giữ nguyên custom', () => {
        expect(seed('scope=custom&start=2026-08-01&end=2026-08-07')).toEqual({
            scope: 'custom',
            customRange: { startISO: '2026-08-01', endISO: '2026-08-07' },
        })
    })

    it('scope thường đọc kèm offset', () => {
        expect(seed('scope=week&offset=-2')).toEqual({ scope: 'week', offset: -2 })
        expect(seed('scope=month')).toEqual({ scope: 'month', offset: 0 })
    })

    it('offset không phải số → 0 thay vì NaN', () => {
        expect(seed('scope=week&offset=abc')).toEqual({ scope: 'week', offset: 0 })
    })

    it('tham số rác → null để caller dùng mặc định', () => {
        expect(seed('')).toBeNull()
        expect(seed('scope=nonsense')).toBeNull()
        expect(seed('scope=custom&start=07-08-2026&end=2026-08-07')).toBeNull() // sai định dạng
        expect(seed('scope=custom&start=2026-08-09&end=2026-08-01')).toBeNull() // start > end
        expect(seed('scope=custom&start=2026-08-01')).toBeNull()                // thiếu end
    })
})
