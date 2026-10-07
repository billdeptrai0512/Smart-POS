import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./reportService', () => ({ fetchOrdersSince: vi.fn() }))
vi.mock('./dailyUsageService', () => ({ fetchStoredUsage: vi.fn(), saveUsageDays: vi.fn() }))
import { fetchOrdersSince } from './reportService'
import { fetchStoredUsage, saveUsageDays } from './dailyUsageService'
import { withCounterEstimate } from './counterEstimate'
import { dateStringVN, addDaysVN } from '../utils/dateVN'

const daysAgo = (n) => dateStringVN(addDaysVN(new Date(), -n))
const at = (n, hour = 12) => `${daysAgo(n)}T${String(hour).padStart(2, '0')}:00:00+07:00`
const row = (over) => ({ ingredient: 'ca_phe', counter_stock: 1000, warehouse_stock: 500, current_stock: 1500, restock_since_count: 0, counter_counted_on: daysAgo(3), ...over })
const order = (n, qty) => ({ created_at: at(n), order_items: [{ product_id: 'p1', quantity: qty, extra_ids: [] }] })
const calc = { recipes: [{ product_id: 'p1', ingredient: 'ca_phe', amount: 10, address_id: 'addr' }], extraIngredients: {}, canPersist: true }

beforeEach(() => {
    fetchOrdersSince.mockReset()
    fetchStoredUsage.mockReset().mockResolvedValue({})
    saveUsageDays.mockReset()
})

describe('withCounterEstimate', () => {
    it('nối tiêu hao các ngày SAU ngày đếm (không gồm chính ngày đếm) + nhập thêm; tổng = kho + quầy ước tính', async () => {
        // đếm cách đây 3 ngày: hôm đếm bán 99 ly (đã nằm trong số đếm), 2 ngày sau bán 20 + 30 ly = 500g
        fetchOrdersSince.mockResolvedValue([order(3, 99), order(2, 20), order(0, 30)])
        const [r] = await withCounterEstimate([row({ restock_since_count: 200 })], 'addr', calc)
        expect(r).toMatchObject({ counter_stock: 700, current_stock: 1200, counter_estimated: true })
        expect(fetchOrdersSince).toHaveBeenCalledWith('addr', daysAgo(2), daysAgo(0))   // cửa sổ: từ ngày SAU ngày đếm tới trước hôm nay (hôm nay tải riêng)
    })

    it('ngày đã lưu thì dùng luôn; chỉ tải đơn và chỉ GHI các ngày còn thiếu; hôm nay tính trực tiếp, không ghi', async () => {
        fetchStoredUsage.mockResolvedValue({ [daysAgo(2)]: { ca_phe: 200 } })   // đóng băng, khác với đơn hiện có
        fetchOrdersSince.mockResolvedValue([order(2, 99), order(1, 10), order(0, 30)])
        const [r] = await withCounterEstimate([row()], 'addr', calc)
        expect(r.counter_stock).toBe(400)   // 1000 − (200 đã lưu + 100 ngày thiếu + 300 hôm nay)
        expect(fetchOrdersSince).toHaveBeenCalledWith('addr', daysAgo(1), daysAgo(0))
        expect(fetchOrdersSince).toHaveBeenCalledWith('addr', daysAgo(0))   // hôm nay: một lần, không lặp trong cửa sổ ngày thiếu
        expect(saveUsageDays).toHaveBeenCalledWith('addr', { [daysAgo(1)]: { ca_phe: 100 } })
    })

    it('mọi ngày đã lưu → chỉ tải đơn hôm nay, không ghi gì', async () => {
        fetchStoredUsage.mockResolvedValue({ [daysAgo(2)]: { ca_phe: 200 }, [daysAgo(1)]: {} })
        fetchOrdersSince.mockResolvedValue([order(0, 30)])
        const [r] = await withCounterEstimate([row()], 'addr', calc)
        expect(r.counter_stock).toBe(500)
        expect(fetchOrdersSince).toHaveBeenCalledTimes(1)
        expect(fetchOrdersSince).toHaveBeenCalledWith('addr', daysAgo(0))
        expect(saveUsageDays).not.toHaveBeenCalled()
    })

    it('không ghi khi context chưa tải xong / công thức rỗng / không phải của địa chỉ này — vẫn ước tính để hiển thị', async () => {
        fetchOrdersSince.mockResolvedValue([order(1, 10)])
        const run = (c) => withCounterEstimate([row()], 'addr', c)
        expect((await run({ ...calc, canPersist: false }))[0].counter_estimated).toBe(true)
        await run({ ...calc, recipes: [] })
        await run({ ...calc, recipes: [{ ...calc.recipes[0], address_id: 'khac' }] })
        expect(saveUsageDays).not.toHaveBeenCalled()
    })

    it('đã đếm hôm nay / không có ngày đếm → giữ nguyên, KHÔNG gọi mạng', async () => {
        const rows = [row({ counter_counted_on: daysAgo(0) }), row({ ingredient: 'nap', counter_counted_on: null })]
        expect(await withCounterEstimate(rows, 'addr', calc)).toEqual(rows)
        expect(fetchOrdersSince).not.toHaveBeenCalled()
        expect(fetchStoredUsage).not.toHaveBeenCalled()
    })

    it('đếm quá 60 ngày trước → giữ số thô, không kéo hàng nghìn đơn', async () => {
        const rows = [row({ counter_counted_on: daysAgo(90) })]
        expect(await withCounterEstimate(rows, 'addr', calc)).toEqual(rows)
        expect(fetchOrdersSince).not.toHaveBeenCalled()
    })

    it('tồn không âm; lỗi tải đơn → trả số thô thay vì làm hỏng trang', async () => {
        fetchOrdersSince.mockImplementation(async (_addr, from) => (from === daysAgo(0) ? [] : [order(1, 500)]))
        const [r] = await withCounterEstimate([row()], 'addr', calc)
        expect(r.counter_stock).toBe(0)
        saveUsageDays.mockClear()
        fetchOrdersSince.mockReset().mockRejectedValue(new Error('network'))
        const rows = [row()]
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(await withCounterEstimate(rows, 'addr', calc)).toEqual(rows)
        expect(saveUsageDays).not.toHaveBeenCalled()
        spy.mockRestore()
    })

    it('quầy + nhập thêm = 0 thì không kéo cửa sổ đơn (ước tính chắc chắn 0)', async () => {
        const rows = [row({ counter_stock: 0, counter_counted_on: daysAgo(31) })]
        expect(await withCounterEstimate(rows, 'addr', calc)).toEqual(rows)
        expect(fetchOrdersSince).not.toHaveBeenCalled()
        // NVL khác đếm gần hơn vẫn ước tính bình thường, cửa sổ chỉ theo NVL còn tồn
        fetchOrdersSince.mockResolvedValue([order(1, 10)])
        const out = await withCounterEstimate([rows[0], row({ ingredient: 'sua', counter_stock: 300, counter_counted_on: daysAgo(2) })], 'addr', calc)
        expect(fetchOrdersSince).toHaveBeenCalledWith('addr', daysAgo(1), daysAgo(0))
        expect(out[0].counter_estimated).toBeUndefined()
    })

    it('Mẫu mặc định (không addressId) → không ước tính', async () => {
        const rows = [row()]
        expect(await withCounterEstimate(rows, null, calc)).toEqual(rows)
    })
})
