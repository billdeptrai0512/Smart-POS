import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ClipboardList, ChevronDown, ChevronUp } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAddressStats } from '../../contexts/AddressStatsContext'
import { useGroupPrep } from '../../hooks/useGroupPrep'
import { fetchTodayExpenses } from '../../services/expenseService'
import { buildTodayBoughtMap } from '../../utils/prepToday'
import type { UsageMap } from '../../utils/inventory'
import { readJSON, writeJSON } from '../../utils/storage'
import { fetchRestockSkips, setRestockSkip } from '../../services/restockSkipService'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet from '../common/NoticeSheet'
import { HubBuyBody, buildHubBuyItems, type Prep } from '../IngredientManagementPage/HubBuyNotice'
import type { Address } from '../../types/domain'

// "Việc cần làm" của quản lý trên /addresses: tồn kho cần bổ sung của từng kho. Tồn kho nặng (~5 request × kho) nên tính NỀN:
// sau khi stats tải xong (khỏi tranh băng thông), mỗi lần chạy tối đa STOCK_CONCURRENCY kho; kết quả
// lưu localStorage → lần vào sau có số cũ ngay, rồi cập nhật ngầm. Mở sheet chỉ đọc số đã có.
const STOCK_CONCURRENCY = 3
const STOCK_CACHE_KEY = 'notice_restock_stats_v3'
const SKIP_KEY = 'notice_restock_skipped' // { date, byUnit: { [unitKey]: { [ingredient]: true } } } — "bỏ qua" chỉ có hiệu lực trong ngày
const todayKey = () => new Date().toLocaleDateString('en-CA')
type Skips = Record<string, Record<string, boolean>>
// need = nguyên liệu còn phải mua (không tính đã mua đủ / bỏ qua); total = tất cả dòng của kho (đứng yên suốt ngày) → tiến độ (total − need)/total.
type StockStat = { need: number; total: number }
// Số liệu tải xong của 1 kho: plan + đã mua hôm nay (+ hàm tươi lại phần đã mua sau khi Nhập kho).
type Loaded = { prep: Prep; bought: UsageMap; refreshBought: () => unknown }
export default function AddressNotice() {
    const { addresses, warehouseGroups } = useAddress()
    const { cupsMap, revenueMap, statsLoading } = useAddressStats()
    const [open, setOpen] = useState(false)
    const [stats, setStats] = useState<Record<string, StockStat>>(() => readJSON(STOCK_CACHE_KEY, {}))
    const [skips, setSkips] = useState<Skips>(() => {
        const saved = readJSON<{ date?: string; byUnit?: Skips }>(SKIP_KEY, {})
        return saved.date === todayKey() ? saved.byUnit ?? {} : {}
    })
    const [loaded, setLoaded] = useState<Record<string, Loaded>>({}) // số liệu chi tiết từng kho — dòng mở rộng đọc lại, khỏi tải lần 2
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set()) // dòng kho đang mở rộng
    // Chỉ xét chi nhánh đang hoạt động (có bán hôm nay) — chi nhánh ngưng không đáng báo hết hạn / tồn kho, lại đỡ tốn request.
    // Ngày mới chưa ly nào được bán (stats đã tải nhưng toàn 0) thì không chi nhánh nào "có bán" → danh sách trống 0/0 đúng lúc
    // cần bổ sung tồn kho nhất; lúc đó xét tất cả địa chỉ, sang khi có đơn đầu tiên mới lọc theo doanh số.
    const active = useMemo(() => {
        const sold = addresses.filter(a => (cupsMap[a.id] || 0) > 0 || (revenueMap[a.id] || 0) > 0)
        return sold.length === 0 && Object.keys(cupsMap).length > 0 ? addresses : sold
    }, [addresses, cupsMap, revenueMap])

    // Đơn vị kho: nhóm có kho tổng gộp 1 dòng (vào kho tổng), địa chỉ lẻ / nhóm chưa đặt kho tổng mỗi cái 1 dòng.
    const units = useMemo(() => {
        const out: { key: string; name: string; target: Address; members: Address[]; hub: boolean }[] = []
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
    useEffect(() => {
        if (targetIds.length) fetchRestockSkips(targetIds).then(server => { if (server) saveSkips(() => server) })
    }, [targetIds])

    function saveSkips(update: (sk: Skips) => Skips) {
        setSkips(sk => {
            const next = update(sk)
            writeJSON(SKIP_KEY, { date: todayKey(), byUnit: next })
            return next
        })
    }

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

    // Kho còn dòng (kể cả đã mua đủ hết) giữ trong danh sách cả ngày; chưa tính xong thì hiện "Đang tính…".
    const stockRows = units
        .filter(u => !stats[u.key] || stats[u.key].total > 0)
        .sort((x, y) => (stats[y.key]?.need ?? 0) - (stats[x.key]?.need ?? 0))
    const total = stockRows.filter(u => stats[u.key]).length
    const doneCount = stockRows.filter(u => stats[u.key]?.need === 0).length

    return (
        <>
            <NoticeBar icon={<ClipboardList size={15} className="text-primary shrink-0" />} label="Việc cần làm" count={total - doneCount} onClick={() => setOpen(true)} />
            {open && (
                <NoticeSheet icon={<span className="shrink-0 text-[16px] font-black text-primary tabular-nums">{doneCount}/{total}</span>} title="Việc cần làm" count="" onClose={() => setOpen(false)}>
                    {stockRows.length > 0 && (
                        <div className="pt-3">
                            {stockRows.map(u => {
                                const st = stats[u.key]
                                const data = loaded[u.key]
                                const isOpen = expanded.has(u.key) && !!data
                                return (
                                    <div key={u.key}>
                                        <Row
                                            name={u.name}
                                            note={st ? `${st.total - st.need}/${st.total} nguyên liệu cần bổ sung${data ? '' : ' · đang cập nhật…'}` : 'Đang tính…'}
                                            tone={!st ? undefined : st.need === 0 ? 'text-success' : st.need < st.total ? 'text-warning' : 'text-danger'}
                                            chevron={isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                            onClick={data ? () => setExpanded(e => { const n = new Set(e); if (!n.delete(u.key)) n.add(u.key); return n }) : undefined}
                                        />
                                        {isOpen && <HubBuyBody addressId={u.target.id} prep={data.prep} bought={data.bought} minAsFloor={!u.hub} skipped={skips[u.target.id]} onSkip={ing => toggleSkip(u.target.id, ing)} onAfterRestock={data.refreshBought} />}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </NoticeSheet>
            )}
            {/* Bộ tải nền: mount dần, mỗi lần tối đa STOCK_CONCURRENCY kho đang chạy */}
            {!statsLoading && units.slice(0, STOCK_CONCURRENCY + Object.keys(loaded).length).map(u => <StockLoader key={u.key} unit={u} skipped={skips[u.target.id]} onResult={onStock} />)}
        </>
    )
}

// tone: màu dòng phụ theo tiến độ — đỏ chưa làm gì, cam đang làm dở, xanh xong hết.
function Row({ name, note, tone = 'text-text-secondary', chevron, onClick }: { name: string; note: string; tone?: string; chevron: ReactNode; onClick?: () => void }) {
    return (
        <button type="button" onClick={onClick} className="w-full flex items-center gap-3 py-3 border-b border-border/30 last:border-0 text-left">
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="truncate text-[14px] font-black text-text">{name}</span>
                <span className={`text-[13px] font-bold ${tone}`}>{note}</span>
            </span>
            <span className="text-text-dim shrink-0">{chevron}</span>
        </button>
    )
}

// Không vẽ gì — chỉ tải số liệu 1 kho (hook theo cụm địa chỉ) + phần đã mua hôm nay của kho đích, rồi báo tiến độ lên cha.
function StockLoader({ unit, skipped, onResult }: { unit: { key: string; members: Address[]; target: Address; hub: boolean }; skipped?: Record<string, boolean>; onResult: (key: string, stat: StockStat | null, data: Loaded) => void }) {
    const members = useMemo(() => unit.members.map(a => ({ id: a.id, name: a.name })), [unit.members])
    const prep = useGroupPrep(members, !unit.hub) // địa chỉ lẻ: min là sàn kho (như Lưu trữ); kho tổng nhóm: cộng chồng
    const { plan, error } = prep
    const [bought, setBought] = useState<UsageMap>()
    // Nhập kho ghi chi phí vào địa chỉ đích (kho tổng / địa chỉ lẻ) → đọc "đã mua hôm nay" ở đúng địa chỉ đó.
    const refreshBought = useCallback(
        () => fetchTodayExpenses(unit.target.id).then(e => setBought(buildTodayBoughtMap(e))).catch(err => console.error('fetchTodayExpenses', err)),
        [unit.target.id])
    useEffect(() => { refreshBought() }, [refreshBought])
    useEffect(() => {
        if (plan && bought) {
            const items = buildHubBuyItems(prep, bought, !unit.hub)
            onResult(unit.key, { total: items.length, need: items.filter(it => !it.done && !skipped?.[it.ingredient]).length }, { prep, bought, refreshBought })
        } else if (error) onResult(unit.key, null, { prep, bought: bought ?? {}, refreshBought })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plan, error, bought, skipped])
    return null
}
