// POS — fetchOrdersSync: hợp đồng watermark của vòng poll đồng bộ đơn.
// Nguồn: src/services/orderService.ts + supabase/migrations/20260813_orders_sync_marks.sql
//
// Cả cơ chế đứng trên một phân biệt duy nhất: heads === null ("không có gì đổi") KHÁC
// heads === [] ("hôm nay chưa có đơn nào"). Lẫn hai cái là xoá trắng danh sách đơn của
// máy đang bán — đúng loại bug đã từng làm mất lưới bàn giữa ca.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../../src/lib/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))
vi.mock('../../src/services/localRepository', () => ({
    isGuest: () => false,
    fetchLocalOrders: () => [],
}))
vi.mock('../../src/services/cache', () => ({
    reportCache: new Map(), historicalCache: new Map(), invalidateReportCache: vi.fn(),
}))

const { fetchOrdersSync } = await import('../../src/services/orderService')

const ADDR = '44732a57-70f7-4bbf-88bc-8f97edf00145'

beforeEach(() => rpc.mockReset())

describe('fetchOrdersSync', () => {
    it('mốc khớp → heads null, KHÔNG phải mảng rỗng', () => {
        rpc.mockResolvedValue({ data: { rev: 42 }, error: null })

        return fetchOrdersSync(ADDR, 42).then(r => {
            expect(r).toEqual({ rev: 42, heads: null })
        })
    })

    it('hôm nay chưa có đơn nào → heads là mảng rỗng, KHÔNG phải null', () => {
        rpc.mockResolvedValue({ data: { rev: 7, heads: [] }, error: null })

        return fetchOrdersSync(ADDR, 3).then(r => {
            expect(r.heads).toEqual([])
        })
    })

    it('mốc lệch → trả đầu đơn kèm mốc mới', () => {
        rpc.mockResolvedValue({ data: { rev: 8, heads: [{ id: 'a', total: 30000 }] }, error: null })

        return fetchOrdersSync(ADDR, 7).then(r => {
            expect(r.rev).toBe(8)
            expect(r.heads).toHaveLength(1)
        })
    })

    it('chưa có mốc (null) vẫn gửi lên, để RPC luôn trả đầu đơn', () => {
        rpc.mockResolvedValue({ data: { rev: 1, heads: [] }, error: null })

        return fetchOrdersSync(ADDR, null).then(() => {
            expect(rpc).toHaveBeenCalledWith('orders_sync', { p_address_id: ADDR, p_rev: null })
        })
    })

    it('lỗi mạng NÉM, không trả rỗng', async () => {
        rpc.mockResolvedValue({ data: null, error: { message: 'network' } })

        // Nuốt lỗi rồi trả { heads: [] } là báo cho vòng poll "quán không có đơn nào".
        await expect(fetchOrdersSync(ADDR, 5)).rejects.toMatchObject({ message: 'network' })
    })
})
