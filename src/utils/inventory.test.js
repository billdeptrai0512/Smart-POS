import { describe, it, expect } from 'vitest'
import { dateStringVN } from './dateVN'
import { computeBalance, computeHaoHut, parseInventoryReport, rollIngredientDays, walkDailyIngredientDiff, openingSeed } from './inventory'

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

// ingredient → tồn cuối ngày throughDay (row cuối của mỗi NVL)
const estimateCounterStocks = (args) => Object.fromEntries(rollIngredientDays(args).map(r => [r.ingredient, r.end]))

describe('rollIngredientDays — tồn quầy theo lý thuyết tới khi đếm lại', () => {
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

// Bản walkDailyIngredientDiff TRƯỚC khi nối qua ngày không đếm — chép nguyên để chứng minh
// địa chỉ đếm hằng ngày ra đúng từng dòng như cũ (số này đổ vào P&L "Hao hụt / hủy").
function legacyWalk({ shiftClosings = [], dailyConsumption = {}, prevShiftClosings = [], openingOverrideMap = null }) {
    if (!shiftClosings.length) return []
    const sorted = [...shiftClosings].sort((a, b) => new Date(a.closed_at || a.created_at) - new Date(b.closed_at || b.created_at))
    let firstOpeningMap = openingOverrideMap
    if (!firstOpeningMap) {
        firstOpeningMap = {}
        for (const it of prevShiftClosings?.[0]?.inventory_report || []) firstOpeningMap[it.ingredient] = it.remaining ?? 0
    }
    const out = []
    sorted.forEach((c, idx) => {
        if (!c.inventory_report) return
        const dayStr = dateStringVN(new Date(c.closed_at || c.created_at))
        const used = dailyConsumption[dayStr] || {}
        for (const item of c.inventory_report) {
            if (item.remaining == null) continue
            let opening
            if (item.opening != null) opening = item.opening
            else if (idx === 0) opening = firstOpeningMap[item.ingredient] ?? 0
            else opening = (sorted[idx - 1]?.inventory_report || []).find(i => i.ingredient === item.ingredient)?.remaining ?? 0
            const usedNum = Math.round((used[item.ingredient] || 0) * 10) / 10
            const theoretical = Math.round((opening + (item.restock || 0) - usedNum) * 10) / 10
            out.push({ dayStr, ingredient: item.ingredient, diff: Math.round((item.remaining - theoretical) * 10) / 10, idx })
        }
    })
    return out
}

describe('walkDailyIngredientDiff — song song với bản cũ', () => {
    const consumption = {
        '2026-10-01': { ca_phe: 120.04, sua: 30 }, '2026-10-02': { ca_phe: 90, sua: 25.5 },
        '2026-10-03': { ca_phe: 0, sua: 40 }, '2026-10-04': { ca_phe: 75 },
    }
    const norm = (rows) => [...rows].sort((a, b) => a.dayStr.localeCompare(b.dayStr) || a.ingredient.localeCompare(b.ingredient))

    it('đếm đủ mọi NVL mọi ngày liên tiếp (kể cả opening đã lưu, restock) → trùng khít bản cũ', () => {
        const closings = [
            closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 800, restock: 100 }, { ingredient: 'sua', remaining: 50, opening: 90 }]),
            closing('2026-10-02', [{ ingredient: 'ca_phe', remaining: 700 }, { ingredient: 'sua', remaining: 20, restock: 10 }]),
            closing('2026-10-03', [{ ingredient: 'ca_phe', remaining: 700, opening: 700 }, { ingredient: 'sua', remaining: 0 }]),
            closing('2026-10-04', [{ ingredient: 'ca_phe', remaining: 600 }]),
        ]
        const prev = [closing('2026-09-30', [{ ingredient: 'ca_phe', remaining: 900 }])]
        for (const args of [
            { shiftClosings: closings, dailyConsumption: consumption, prevShiftClosings: prev },
            { shiftClosings: closings, dailyConsumption: consumption, openingOverrideMap: { ca_phe: 850, sua: 95 } },
            { shiftClosings: [...closings].reverse(), dailyConsumption: consumption },
        ]) {
            expect(norm(walkDailyIngredientDiff(args))).toEqual(norm(legacyWalk(args)))
        }
    })

    it('1 phiếu / không phiếu / phiếu thiếu inventory_report → như cũ', () => {
        const one = { shiftClosings: [closing('2026-10-02', [{ ingredient: 'ca_phe', remaining: 5 }])], dailyConsumption: consumption }
        expect(walkDailyIngredientDiff(one)).toEqual(legacyWalk(one))
        expect(walkDailyIngredientDiff({ shiftClosings: [], dailyConsumption: consumption })).toEqual([])
        const noReport = { shiftClosings: [{ closed_at: '2026-10-02T20:00:00+07:00', inventory_report: null }], dailyConsumption: consumption }
        expect(walkDailyIngredientDiff(noReport)).toEqual(legacyWalk(noReport))
    })

    it('KHÁC bản cũ có chủ đích: đếm lại sau nhiều ngày → hao hụt tính trên cả khoảng, không phải 0/số cũ', () => {
        // Đếm 1000 hôm 1; hôm 2-3 không phiếu (dùng 90 và 0); hôm 4 dùng 75, đếm 540.
        const closings = [
            closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 1000 }]),
            closing('2026-10-04', [{ ingredient: 'ca_phe', remaining: 540 }]),
        ]
        const diff = (fn) => fn({ shiftClosings: closings, dailyConsumption: consumption }).find(r => r.dayStr === '2026-10-04').diff
        expect(diff(walkDailyIngredientDiff)).toBe(-295)  // 540 − (1000 − 90 − 0 − 75)
        expect(diff(legacyWalk)).toBe(-385)               // 540 − (1000 − 75): tính cả 90 của hôm 2 thành hao hụt giả
    })

    it('hôm qua có phiếu nhưng không đếm NVL → bản mới không còn opening=0 (bản cũ bỏ sót hao hụt)', () => {
        const closings = [
            closing('2026-10-01', [{ ingredient: 'ca_phe', remaining: 1000 }]),
            closing('2026-10-02', [{ ingredient: 'sua', remaining: 5 }]),
            closing('2026-10-03', [{ ingredient: 'ca_phe', remaining: 700 }]),
        ]
        const d3 = (fn) => fn({ shiftClosings: closings, dailyConsumption: consumption }).find(r => r.dayStr === '2026-10-03' && r.ingredient === 'ca_phe').diff
        expect(d3(walkDailyIngredientDiff)).toBe(-210)   // 700 − (1000 − 90 − 0)
        expect(d3(legacyWalk)).toBe(700)                 // opening 0 − 0 → "Dư" 700, hao hụt mất
    })
})

describe('openingSeed', () => {
    const yesterday = closing('2026-10-06', [
        { ingredient: 'ca_phe', remaining: 5 },
        { ingredient: 'sua', remaining: null },
        { ingredient: 'nap', remaining: 0 },
    ])

    it('hôm qua đếm thì số đếm thắng (kể cả 0); không đếm thì ước tính; không có ước tính thì 0 như mặc định của walk', () => {
        expect(openingSeed(yesterday, { ca_phe: 999, sua: 77, nap: 40, moi: 3 }))
            .toEqual({ ca_phe: 5, sua: 77, nap: 0, moi: 3 })
        expect(openingSeed(yesterday)).toEqual({ ca_phe: 5, sua: 0, nap: 0 })
        expect(openingSeed(null, { sua: 7 })).toEqual({ sua: 7 })
    })

    it('đưa vào walk làm openingOverrideMap: hao hụt hôm nay tính trên Đầu kỳ ước tính chứ không phải 0', () => {
        const today = closing('2026-10-07', [{ ingredient: 'sua', remaining: 60 }])
        const run = (estimates) => walkDailyIngredientDiff({
            shiftClosings: [today], dailyConsumption: { '2026-10-07': { sua: 10 } }, openingOverrideMap: openingSeed(yesterday, estimates),
        })[0].diff
        expect(run({})).toBe(70)         // opening 0 − dùng 10 → lý thuyết −10, thực 60 → "Dư" 70, hao hụt thật bị che
        expect(run({ sua: 77 })).toBe(-7)   // opening 77 − dùng 10 = 67, thực 60 → hụt 7
    })
})
