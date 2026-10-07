import { describe, it, expect } from 'vitest'
import { computeBalance, computeHaoHut, parseInventoryReport, rollIngredientDays, estimateCounterStocks } from './inventory'

describe('computeBalance / computeHaoHut', () => {
    it('hao hụt = Cuối kỳ − (Đầu kỳ + Nhập thêm − Sử dụng)', () => {
        const args = { inventoryValue: '8', restockValue: '5', openingValue: '10', used: 6.04 }
        expect(computeBalance(args)).toEqual({ openingNum: 10, usedNum: 6, lyThuyet: 9, haoHut: -1 })
        expect(computeHaoHut(args)).toBe(-1)
    })
    it('chưa nhập Cuối kỳ → null (không phải 0)', () => {
        expect(computeHaoHut({ inventoryValue: '', openingValue: '10', used: 1 })).toBeNull()
        expect(computeHaoHut({ openingValue: '10' })).toBeNull()
    })
    it('Đầu kỳ rỗng/thiếu rơi về openingFallback', () => {
        expect(computeBalance({ inventoryValue: '3', openingFallback: 4 }).lyThuyet).toBe(4)
        expect(computeBalance({ inventoryValue: '3', openingValue: '', openingFallback: 4 }).lyThuyet).toBe(0)
    })
})

describe('parseInventoryReport', () => {
    it('mảng, chuỗi JSON → mảng; hỏng/không phải mảng → null', () => {
        expect(parseInventoryReport([{ a: 1 }])).toEqual([{ a: 1 }])
        expect(parseInventoryReport('[{"a":1}]')).toEqual([{ a: 1 }])
        expect(parseInventoryReport('{oops')).toBeNull()
        expect(parseInventoryReport(null)).toBeNull()
        expect(parseInventoryReport({})).toBeNull()
    })
})

// Phiếu chốt ngày `day` (giờ VN) — closed_at 20:00 cùng ngày.
const closing = (day, report) => ({ closed_at: `${day}T20:00:00+07:00`, inventory_report: report })

describe('estimateCounterStocks — tồn quầy theo lý thuyết tới khi đếm lại', () => {
    const used = { '2026-10-02': { ca_phe: 200 }, '2026-10-03': { ca_phe: 300 }, '2026-10-04': { ca_phe: 100 } }

    it('đếm hôm 1, không phiếu hôm 2-3 → cuối ngày 3 = số đếm − tiêu hao hôm 2, 3', () => {
        const closings = [closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 1000 }])]
        expect(estimateCounterStocks({ shiftClosings: closings, dailyConsumption: used, throughDay: '2026-10-03' }))
            .toEqual({ ca_phe: 500 })
    })

    it('hôm qua có phiếu nhưng không đếm NVL này → vẫn nối lý thuyết (không rơi về 0)', () => {
        const closings = [
            closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 1000 }]),
            closing('2026-10-02', [{ ingredient: 'sua', remaining: 5 }]),
        ]
        expect(estimateCounterStocks({ shiftClosings: closings, dailyConsumption: used, throughDay: '2026-10-02' }).ca_phe).toBe(800)
    })

    it('Nhập thêm trong ngày không đếm cộng vào quầy', () => {
        const closings = [
            closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 1000 }]),
            closing('2026-10-02', [{ ingredient: 'ca_phe', restock: 500 }]),
        ]
        expect(estimateCounterStocks({ shiftClosings: closings, dailyConsumption: used, throughDay: '2026-10-02' }).ca_phe).toBe(1300)
    })

    it('đếm lại đặt lại mốc: số đếm thắng lý thuyết, ngày sau nối từ số đếm', () => {
        const closings = [
            closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 1000 }]),
            closing('2026-10-03', [{ ingredient: 'ca_phe', remaining: 420 }]),
        ]
        const r = (throughDay) => estimateCounterStocks({ shiftClosings: closings, dailyConsumption: used, throughDay }).ca_phe
        expect(r('2026-10-03')).toBe(420)
        expect(r('2026-10-04')).toBe(320)
    })

    it('Đầu kỳ đã lưu trong phiếu (đóng băng) thắng số nối; tồn không bao giờ âm', () => {
        const frozen = [closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 100 }]), closing('2026-10-02', [{ ingredient: 'ca_phe', opening: 900 }])]
        expect(estimateCounterStocks({ shiftClosings: frozen, dailyConsumption: used, throughDay: '2026-10-02' }).ca_phe).toBe(700)
        const lowStock = [closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 100 }])]
        expect(estimateCounterStocks({ shiftClosings: lowStock, dailyConsumption: used, throughDay: '2026-10-03' }).ca_phe).toBe(0)
    })

    it('Lý thuyết trong row giữ số âm (để tính hao hụt), end kẹp 0', () => {
        const closings = [closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 100 }])]
        const row = rollIngredientDays({ shiftClosings: closings, dailyConsumption: used, throughDay: '2026-10-03' })
            .find(r => r.dayStr === '2026-10-03')
        expect(row).toMatchObject({ opening: 0, used: 300, theoretical: -300, end: 0, remaining: null, closingIdx: -1 })
    })

    it('seed = tồn cuối ngày ngay trước phiếu đầu tiên; phiếu sau throughDay bị bỏ qua', () => {
        const closings = [
            closing('2026-10-02', [{ ingredient: 'sua', remaining: 3 }]),
            closing('2026-10-09', [{ ingredient: 'ca_phe', remaining: 1 }]),
        ]
        const res = estimateCounterStocks({ shiftClosings: closings, dailyConsumption: used, throughDay: '2026-10-03', seed: { ca_phe: 1000 } })
        expect(res).toEqual({ ca_phe: 500, sua: 3 })
    })

    it('không có phiếu nào → rỗng', () => {
        expect(estimateCounterStocks({ shiftClosings: [], dailyConsumption: used, throughDay: '2026-10-03' })).toEqual({})
    })
})

