// Báo cáo — buildCashPayload: payload "Lưu thực thu" chỉ mang ô đã sửa.
// Nguồn: src/services/reportService.ts
//
// Ca chính: hai máy cùng kết ca, A đếm két (Tiền mặt), B đối chiếu bank (Chuyển khoản).
// Trước đây UPDATE luôn gửi cả 2 cột lấy từ state local nên người bấm Lưu sau đè số của
// người trước bằng bản cũ của mình — mất tiền thật, không phải chỉ lệch hiển thị.

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/lib/supabaseClient', () => ({ supabase: null }))
vi.mock('../../src/services/localRepository', () => ({ isGuest: () => true }))
vi.mock('../../src/services/cache', () => ({
    reportCache: new Map(), historicalCache: new Map(), invalidateReportCache: vi.fn(),
}))

const { buildCashPayload } = await import('../../src/services/reportService')

const inputs = (cash, transfer) => ({ actual_cash: cash, actual_transfer: transfer })

describe('buildCashPayload', () => {
    it('sửa mỗi Tiền mặt → payload KHÔNG mang Chuyển khoản', () => {
        const p = buildCashPayload({ actual_cash: 0, actual_transfer: 500_000 }, inputs(300_000, 500_000), true)

        expect(p.actual_cash).toBe(300_000)
        expect('actual_transfer' in p).toBe(false)
    })

    // Ca chính. Trước khi sửa, một trong hai số này mất.
    it('hai máy sửa hai ô khác nhau → không ô nào đè ô nào', () => {
        const daLuu = { actual_cash: 0, actual_transfer: 0, cash_closed_at: '2026-08-13T10:00:00Z' }
        // Máy A đếm két: state của A vẫn thấy Chuyển khoản = 0 (chưa nhận event của B).
        const mayA = buildCashPayload(daLuu, inputs(300_000, 0), true)
        // Máy B đối chiếu bank: state của B vẫn thấy Tiền mặt = 0.
        const mayB = buildCashPayload(daLuu, inputs(0, 500_000), true)

        expect(mayA).toEqual({ actual_cash: 300_000, cash_closed_at: daLuu.cash_closed_at })
        expect(mayB).toEqual({ actual_transfer: 500_000, cash_closed_at: daLuu.cash_closed_at })
        // Ghi lần lượt lên cùng một row → cả hai số cùng sống.
        expect({ ...daLuu, ...mayA, ...mayB }).toMatchObject({ actual_cash: 300_000, actual_transfer: 500_000 })
    })

    it('không ô nào đổi → null (không gửi request nào)', () => {
        expect(buildCashPayload({ actual_cash: 300_000, actual_transfer: 500_000 }, inputs(300_000, 500_000), true)).toBeNull()
    })

    it('null và 0 là một — phiếu chưa từng nhập tiền không tự thành "đã sửa"', () => {
        expect(buildCashPayload({ actual_cash: null, actual_transfer: null }, inputs(0, 0), true)).toBeNull()
    })

    it('chưa có phiếu (INSERT) → gửi ĐỦ cột, kể cả ô bằng 0', () => {
        const p = buildCashPayload(null, inputs(300_000, 0), false)

        // Thiếu inventory_report/note thì row mới hụt cột NOT NULL.
        expect(p).toMatchObject({ actual_cash: 300_000, actual_transfer: 0, inventory_report: [], note: '' })
        expect(p.cash_closed_at).toBeTruthy()
    })

    it('lần lưu thứ hai KHÔNG dời mốc chốt ca', () => {
        const moc = '2026-08-13T10:00:00Z'
        const p = buildCashPayload({ actual_cash: 300_000, cash_closed_at: moc }, inputs(310_000, 0), true)

        // Dời mốc ⇒ các khoản chi giữa 2 lần lưu bị đổi phân loại trước/sau chốt.
        expect(p.cash_closed_at).toBe(moc)
    })
})
