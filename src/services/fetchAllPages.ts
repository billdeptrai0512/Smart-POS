import type { Row } from '../types/domain'

// PostgREST cắt cứng 1000 dòng/request → quét theo trang. build phải có order ổn định (created_at + id).
export async function fetchAllPages(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
    const PAGE = 1000
    const out: Row[] = []
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1)
        if (error) throw error
        out.push(...(data || []))
        if ((data?.length ?? 0) < PAGE) return out
    }
}
