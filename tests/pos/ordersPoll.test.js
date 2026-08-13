// POS — diffOrderHeads: so đơn đang giữ trong máy với danh sách đầu đơn vừa poll về.
// Nguồn: src/hooks/useOrdersPoll.js
//
// Đây là toàn bộ cơ chế đồng bộ giữa hai máy cùng địa chỉ (một máy ghi món, một máy mở
// Nhật ký) sau khi bỏ realtime. Sai ở đây là đơn của máy kia không bao giờ hiện, hoặc
// hiện hai lần, hoặc hiện với số tiền client tính chứ không phải số server chốt.

import { describe, it, expect } from 'vitest'
import { diffOrderHeads } from '../../src/hooks/useOrdersPoll'

const head = (over = {}) => ({ id: 'a', total: 30000, discount_amount: 0, deleted_at: null, served_at: null, table_closed_at: null, table_name: null, ...over })

const known = (...ids) => new Set(ids)

describe('diffOrderHeads', () => {
    it('đơn máy khác vừa tạo → newIds', () => {
        const { newIds, patched, moneyChanged } = diffOrderHeads([], [head({ id: 'moi' })], known())

        expect(newIds).toEqual(['moi'])
        expect(patched).toEqual([])
        expect(moneyChanged).toBe(true)
    })

    // /pos KHÔNG gọi handleLoadHistory nên localOrders rỗng suốt. Không có mốc thì nhịp đầu
    // đọc thành "cả ngày đều là đơn mới" → một URL id=in.(...) ôm mọi đơn: 200 đơn ~7.4KB,
    // gateway trả 414 và thẻ Nhật ký thôi đồng bộ từ đó.
    it('nhịp ĐẦU (chưa có mốc) chỉ dựng mốc, không tuyên bố đơn nào là mới', () => {
        const cadNgay = [head({ id: 'a' }), head({ id: 'b' }), head({ id: 'c' })]
        const { newIds, moneyChanged } = diffOrderHeads([], cadNgay, null)

        expect(newIds).toEqual([])
        expect(moneyChanged).toBe(false)
    })

    it('đơn đã nằm trong mốc thì không phải đơn mới', () => {
        const { newIds } = diffOrderHeads([], [head({ id: 'a' }), head({ id: 'b' })], known('a'))

        expect(newIds).toEqual(['b'])
    })

    it('không đổi gì → không kéo thêm query nào', () => {
        const { newIds, patched, moneyChanged } = diffOrderHeads([head()], [head()], known('a'))

        expect(newIds).toEqual([])
        expect(patched).toEqual([])
        expect(moneyChanged).toBe(false)
    })

    it('máy khác sửa chiết khấu đơn MANG ĐI → tiền đổi, lưới bàn thì không', () => {
        const local = [head({ total: 30000, discount_amount: 0 })]
        const { newIds, patched, moneyChanged, tableChanged } = diffOrderHeads(local, [head({ total: 25000, discount_amount: 5000 })])

        expect(newIds).toEqual([])
        expect(patched).toEqual([expect.objectContaining({ id: 'a', total: 25000 })])
        expect(moneyChanged).toBe(true)
        // Kéo fetchOpenTables (join order_items + products từng bàn) cho một đơn không có
        // bàn là trả giá cho không.
        expect(tableChanged).toBe(false)
    })

    it('xoá mềm một đợt của bàn đang mở → tổng bàn đổi theo', () => {
        const local = [head({ table_name: 'Bàn 3' })]
        const { moneyChanged, tableChanged } = diffOrderHeads(local, [head({ table_name: 'Bàn 3', deleted_at: '2026-08-13T10:05:00Z' })])

        expect(moneyChanged).toBe(true)
        expect(tableChanged).toBe(true)
    })

    it('đơn mới của máy khác: có bàn thì mới đụng lưới bàn', () => {
        const mangDi = diffOrderHeads([], [head({ id: 'x' })], known())
        const coBan = diffOrderHeads([], [head({ id: 'y', table_name: 'Bàn 1' })], known())

        expect(mangDi.tableChanged).toBe(false)
        expect(coBan.tableChanged).toBe(true)
    })

    it('máy khác xoá mềm → patched, dù mốc giờ xoá là gì', () => {
        const { patched, moneyChanged } = diffOrderHeads([head()], [head({ deleted_at: '2026-08-13T10:05:00Z' })])

        expect(patched).toHaveLength(1)
        expect(moneyChanged).toBe(true)
    })

    // Hai ca dưới là lý do served_at/table_closed_at phải nằm trong heads: realtime cũ gọi
    // refreshTables trên mọi UPDATE nên chúng tự đồng bộ, poll thì phải tự thấy.
    it('máy khác bấm Ra món → lưới bàn vẽ lại, KHÔNG phải chuyện tiền', () => {
        const { patched, moneyChanged, tableChanged } = diffOrderHeads([head()], [head({ served_at: '2026-08-13T10:02:00Z' })])

        expect(patched).toHaveLength(1)
        expect(tableChanged).toBe(true)
        // Lật một cờ boolean mà kéo tổng ngày + thẻ Nhật ký trên mọi máy là lãng phí.
        expect(moneyChanged).toBe(false)
    })

    it('máy khác tính tiền bàn → patched, để lưới bàn máy này bỏ bàn đã thu', () => {
        const { patched, moneyChanged, tableChanged } = diffOrderHeads([head()], [head({ table_closed_at: '2026-08-13T11:00:00Z' })])

        expect(patched).toHaveLength(1)
        expect(tableChanged).toBe(true)
        expect(moneyChanged).toBe(false)
    })

    it('hàng lạc quan thiếu hẳn cột cờ bàn → undefined vs null không phải là lệch', () => {
        // doSubmit dựng hàng lạc quan không có served_at/table_closed_at. Nếu coi là lệch
        // thì mỗi nhịp poll lại vá + refreshTables cho tới hết ca.
        const optimistic = [{ _optimistic: true, id: 'a', total: 30000, discount_amount: 0, created_at: '2026-08-13T10:00:00Z', deleted_at: null }]
        const { patched, moneyChanged } = diffOrderHeads(optimistic, [head()])

        expect(patched).toEqual([])
        expect(moneyChanged).toBe(false)
    })

    it('hàng lạc quan của chính máy này lệch giá server → patched để sửa lại', () => {
        // bulk_create_orders tính giá lại ở server; client đoán 30k, server chốt 28k.
        const optimistic = [{ _optimistic: true, ...head({ total: 30000 }) }]
        const { newIds, patched } = diffOrderHeads(optimistic, [head({ total: 28000 })])

        // KHÔNG phải đơn mới — cùng id nên không nhân đôi.
        expect(newIds).toEqual([])
        expect(patched).toEqual([expect.objectContaining({ total: 28000 })])
    })

    it('discount_amount null và 0 là một, đừng vá vòng vo mỗi nhịp poll', () => {
        const { patched } = diffOrderHeads([head({ discount_amount: null })], [head({ discount_amount: 0 })])

        expect(patched).toEqual([])
    })
})
