// Chia danh sách món theo các dòng phân nhóm (is_divider) của menu. Nhóm đầu (name = null) là các món đứng trước dòng phân nhóm đầu tiên.
// keep: lọc món được giữ lại; nhóm rỗng bị bỏ.
export function groupByDivider<T extends { name: string; is_divider?: boolean | null }>(products: T[], keep: (p: T) => boolean = () => true) {
    const groups: { name: string | null; items: T[] }[] = [{ name: null, items: [] }]
    for (const p of products) {
        if (p.is_divider) groups.push({ name: p.name, items: [] })
        else if (keep(p)) groups[groups.length - 1].items.push(p)
    }
    return groups.filter(g => g.items.length > 0)
}
