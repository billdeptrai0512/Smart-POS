import { useEffect, useMemo, useState } from 'react'
import { useAddress } from '../contexts/AddressContext'
import { useAddressStats } from '../contexts/AddressStatsContext'
import { fetchRestockSkips, setRestockSkip } from '../services/restockSkipService'
import { readJSON, writeJSON } from '../utils/storage'
import type { UsageMap } from '../utils/inventory'
import type { Prep } from '../components/IngredientManagementPage/HubBuyNotice'
import type { Address } from '../types/domain'

const STOCK_CACHE_KEY = 'notice_restock_stats_v3'
const SKIP_KEY = 'notice_restock_skipped' // { date, byUnit: { [unitKey]: { [ingredient]: true } } } — "bỏ qua" chỉ có hiệu lực trong ngày
const todayKey = () => new Date().toLocaleDateString('en-CA')

export type Skips = Record<string, Record<string, boolean>>
// need = nguyên liệu còn phải mua (không tính đã mua đủ / bỏ qua); total = tất cả dòng của kho (đứng yên suốt ngày).
export type StockStat = { need: number; total: number }
// Số liệu tải xong của 1 kho: plan + đã mua hôm nay (+ hàm tươi lại phần đã mua sau khi Nhập kho).
export type Loaded = { prep: Prep; bought: UsageMap; refreshBought: () => unknown }
export type StockUnit = { key: string; name: string; target: Address; members: Address[]; hub: boolean }

// Dữ liệu của "Việc cần làm" trên /addresses: danh sách kho, tiến độ từng kho (cache localStorage → có số cũ ngay),
// "bỏ qua" đồng bộ server, thứ tự dòng. Việc tải số liệu từng kho do StockLoader (cần hook theo cụm địa chỉ) báo về qua onStock.
export function useRestockOverview(reopenKey: string | null, sheetOpen: boolean) {
    const { addresses, warehouseGroups } = useAddress()
    const { cupsMap, revenueMap, statsLoading } = useAddressStats()
    const [stats, setStats] = useState<Record<string, StockStat>>(() => readJSON(STOCK_CACHE_KEY, {}))
    const [skips, setSkips] = useState<Skips>(() => {
        const saved = readJSON<{ date?: string; byUnit?: Skips }>(SKIP_KEY, {})
        return saved.date === todayKey() ? saved.byUnit ?? {} : {}
    })
    const [loaded, setLoaded] = useState<Record<string, Loaded>>({}) // số liệu chi tiết từng kho — dòng mở rộng đọc lại, khỏi tải lần 2

    // Chỉ xét chi nhánh đang hoạt động (có bán hôm nay) — chi nhánh ngưng không đáng báo hết hạn / tồn kho, lại đỡ tốn request.
    // Ngày mới chưa ly nào được bán (stats đã tải nhưng toàn 0) thì không chi nhánh nào "có bán" → danh sách trống 0/0 đúng lúc
    // cần bổ sung tồn kho nhất; lúc đó xét tất cả địa chỉ, sang khi có đơn đầu tiên mới lọc theo doanh số.
    const active = useMemo(() => {
        const sold = addresses.filter(a => (cupsMap[a.id] || 0) > 0 || (revenueMap[a.id] || 0) > 0)
        return sold.length === 0 && Object.keys(cupsMap).length > 0 ? addresses : sold
    }, [addresses, cupsMap, revenueMap])

    // Đơn vị kho: nhóm có kho tổng gộp 1 dòng (vào kho tổng), địa chỉ lẻ / nhóm chưa đặt kho tổng mỗi cái 1 dòng.
    const units = useMemo(() => {
        const out: StockUnit[] = []
        const grouped = new Set<string>()
        for (const g of warehouseGroups) {
            const hub = addresses.find(a => a.id === g.hub_address_id && a.warehouse_group_id === g.id)
            if (!hub) continue
            const members = active.filter(a => a.warehouse_group_id === g.id)
            addresses.forEach(a => { if (a.warehouse_group_id === g.id) grouped.add(a.id) })
            if (members.length) out.push({ key: g.id, name: g.name, target: hub, members, hub: true })
        }
        for (const a of active) if (!grouped.has(a.id)) out.push({ key: a.id, name: a.name, target: a, members: [a], hub: false })
        return out
    }, [addresses, active, warehouseGroups])

    // "Bỏ qua" lưu trên server (mọi thiết bị cùng thấy); localStorage chỉ để có số ngay lúc mở trang. Khoá = id địa chỉ đích của kho.
    const targetIds = useMemo(() => units.map(u => u.target.id), [units])
    function saveSkips(update: (sk: Skips) => Skips) {
        setSkips(sk => {
            const next = update(sk)
            writeJSON(SKIP_KEY, { date: todayKey(), byUnit: next })
            return next
        })
    }
    useEffect(() => {
        if (targetIds.length) fetchRestockSkips(targetIds).then(server => { if (server) saveSkips(() => server) })
    }, [targetIds])

    function toggleSkip(targetId: string, ingredient: string) {
        const skipped = !skips[targetId]?.[ingredient]
        saveSkips(sk => ({ ...sk, [targetId]: { ...sk[targetId], [ingredient]: skipped } }))
        // Ghi server lỗi (mất mạng / chưa migrate) thì máy này vẫn giữ trạng thái bỏ qua, chỉ không đồng bộ sang máy khác.
        setRestockSkip(targetId, ingredient, skipped).catch(err => console.error('setRestockSkip', err))
    }

    function onStock(key: string, stat: StockStat | null, data: Loaded) {
        setLoaded(l => ({ ...l, [key]: data }))
        if (!stat) return
        setStats(st => {
            const next = { ...st, [key]: stat }
            writeJSON(STOCK_CACHE_KEY, next)
            return next
        })
    }

    // Thứ tự dòng: kho nhiều việc nhất lên đầu, nhưng mỗi kho chỉ được xếp 1 lần trong mỗi lần mở sheet — số về dần
    // không làm dòng nhảy chỗ dưới ngón tay. Kho chưa có số ("Đang tính…") nằm cuối, có số thì vào chỗ của nó.
    const [rank, setRank] = useState<Record<string, number>>({})
    // Kho còn dòng (kể cả đã mua đủ hết) giữ trong danh sách cả ngày; chưa tính xong thì hiện "Đang tính…".
    const stockRows = units.filter(u => !stats[u.key] || stats[u.key].total > 0)
    const unranked = sheetOpen ? stockRows.filter(u => stats[u.key] && rank[u.key] === undefined) : []
    if (!sheetOpen && Object.keys(rank).length) setRank({})
    else if (unranked.length) setRank({ ...rank, ...Object.fromEntries(unranked.map(u => [u.key, stats[u.key].need])) })
    const rankOf = (u: StockUnit) => rank[u.key] ?? (sheetOpen ? -1 : stats[u.key]?.need ?? -1)
    stockRows.sort((x, y) => rankOf(y) - rankOf(x))

    const total = stockRows.filter(u => stats[u.key]).length
    const doneCount = stockRows.filter(u => stats[u.key]?.need === 0).length
    // Về từ trang chi tiết: kho vừa bấm tải trước (khỏi chờ các kho khác) rồi cuộn tới dòng của nó.
    const loadOrder = [...units].sort((a, b) => Number(b.key === reopenKey) - Number(a.key === reopenKey))

    return { statsLoading, stats, skips, loaded, stockRows, total, doneCount, loadOrder, toggleSkip, onStock }
}
