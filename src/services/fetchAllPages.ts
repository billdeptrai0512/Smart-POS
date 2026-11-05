import type { Row } from '../types/domain'

// PostgREST cắt cứng 1000 dòng/request → quét theo trang. build phải có order ổn định (created_at + id).
// Trang đầu đi một mình (phần lớn khoảng ngày chỉ cần 1 trang); từ trang 2 bắn WAVE trang song song mỗi đợt
// thay vì tuần tự — tháng ~4 trang giảm từ 4 lượt chờ còn 2. Trang thừa (rỗng) rẻ; ghép lại đúng thứ tự trang.
const PAGE = 1000
const WAVE = 3
export async function fetchAllPages(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
    const page = async (n: number) => {
        const { data, error } = await build(n * PAGE, n * PAGE + PAGE - 1)
        if (error) throw error
        return data || []
    }
    const out: Row[] = await page(0)
    if (out.length < PAGE) return out
    for (let n = 1; ; n += WAVE) {
        const pages = await Promise.all(Array.from({ length: WAVE }, (_, i) => page(n + i)))
        for (const p of pages) out.push(...p)
        if (pages[WAVE - 1].length < PAGE) return out
    }
}
