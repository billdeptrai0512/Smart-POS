import type { Row } from '../types/domain'

// Thứ tự id mới khi dời 1 món xuống cuối danh mục categoryId ('' = cuối nhóm "chưa phân danh mục", ngay trước danh mục
// đầu tiên). null = danh mục không còn tồn tại.
export function idsWithProductIn(products: Row[], productId: string, categoryId: string): string[] | null {
    const base = products.filter(p => p.id !== productId)
    const at = categoryId ? base.findIndex(p => p.id === categoryId) : -1
    if (categoryId && at < 0) return null
    let end = at + 1
    while (end < base.length && !base[end].is_divider) end++
    const ids = base.map(p => p.id)
    ids.splice(end, 0, productId)
    return ids
}
