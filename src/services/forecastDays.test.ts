import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
import { fetchForecastDays } from './reportService'

const items = [{ product_id: 'p1', quantity: 1, extra_ids: [] }]

describe('fetchForecastDays', () => {
    it('có đơn cùng thứ → dùng đúng các ngày đó, không đọc thêm', async () => {
        const fetchDay = vi.fn(async (_a: string | null, d: number) => (d === 13 ? items : []))
        const days = await fetchForecastDays('a', [6, 13, 20], [0, 1], fetchDay)
        expect(days).toHaveLength(3) // ngày trống vẫn giữ trong mẫu số — đó là tín hiệu thật
        expect(fetchDay).toHaveBeenCalledTimes(3)
    })

    it('chi nhánh mới (cùng thứ trống hết) → dự phòng: chỉ giữ ngày có đơn trong các ngày gần nhất, kể cả hôm nay nếu được truyền vào', async () => {
        const fetchDay = vi.fn(async (_a: string | null, d: number) => (d === 0 ? items : []))
        const days = await fetchForecastDays('a', [6, 13, 20], [0, 1, 2], fetchDay)
        expect(days).toHaveLength(1) // chỉ hôm nay có bán → không bị chia cho 3
        expect(fetchDay.mock.calls.map(c => c[1]).slice(3)).toEqual([0, 1, 2])
    })

    it('không có đơn nào cả → rỗng', async () => {
        expect(await fetchForecastDays('a', [6], [1], async () => [])).toEqual([])
    })
})
