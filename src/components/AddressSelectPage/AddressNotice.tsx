import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ClipboardList, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useRestockOverview, type Loaded, type StockStat, type StockUnit } from '../../hooks/useRestockOverview'
import { useGroupPrep } from '../../hooks/useGroupPrep'
import { fetchTodayExpenses } from '../../services/expenseService'
import { buildTodayBoughtMap } from '../../utils/prepToday'
import type { UsageMap } from '../../utils/inventory'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet from '../common/NoticeSheet'
import { HubBuyBody } from '../IngredientManagementPage/HubBuyNotice'
import { DebtList, ingredientDetailPath, useDebtPay, useIngredientDebts } from '../IngredientManagementPage/DebtSection'
import { buildHubBuyItems } from '../../utils/hubBuy'
import type { Address, Row } from '../../types/domain'

// "Việc cần làm" của quản lý trên /addresses: tồn kho cần bổ sung của từng kho. Tồn kho nặng (~5 request × kho) nên tính NỀN:
// sau khi stats tải xong (khỏi tranh băng thông), mỗi lần chạy tối đa STOCK_CONCURRENCY kho; kết quả
// lưu localStorage → lần vào sau có số cũ ngay, rồi cập nhật ngầm. Mở sheet chỉ đọc số đã có.
// Dữ liệu (danh sách kho, tiến độ, bỏ qua, thứ tự) nằm ở useRestockOverview; file này lo giao diện + điều hướng.
const STOCK_CONCURRENCY = 3

// onClose: chế độ "chỉ sheet" (chuông trên thanh POS) — không vẽ dải, mở sẵn, đóng thì báo cha unmount (bộ tải nền chỉ chạy khi sheet đang mở).
export default function AddressNotice({ onClose }: { onClose?: () => void } = {}) {
    const { setSelectedAddress } = useAddress()
    const navigate = useNavigate()
    // Bấm tên nguyên liệu → sang trang chi tiết (trang này unmount); nút Back của trang đó về /addresses?reopen=<kho> → mở lại sheet + dòng kho đó.
    const { search } = useLocation()
    const [reopenKey] = useState(() => new URLSearchParams(search).get('reopen'))
    const focusRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [scrollTo, setScrollTo] = useState<string | null>(null)
    const [open, setOpen] = useState(reopenKey !== null || !!onClose)
    const [expanded, setExpanded] = useState<string | null>(reopenKey) // kho đang mở rộng — accordion: mở kho này thì kho kia tự đóng
    // Công nợ: form trả nợ là bottom-sheet nên vẽ ngoài sheet này (ẩn sheet khi đang trả); trả xong → các dòng địa chỉ tải lại công nợ.
    const [debtVer, setDebtVer] = useState(0)
    const { pay, setPay, node: payNode } = useDebtPay(() => setDebtVer(v => v + 1))
    const { statsLoading, stats, skips, loaded, stockRows, total, doneCount, loadOrder, toggleSkip, onStock } = useRestockOverview(reopenKey, open)

    // Chọn địa chỉ đích của kho rồi vào thẳng trang chi tiết nguyên liệu; Back về /addresses.
    function openIngredient(unitKey: string, target: Address, ingredient: string, tab?: 'history', sinceISO?: string) {
        setSelectedAddress(target)
        setOpen(false)
        onClose?.() // chuông nằm ở layout, không unmount khi đổi trang → tự đóng sheet kẻo che trang chi tiết
        // URL luôn mang scope (?scope=month, hoặc khoảng ngày của công nợ): không thì useDateScope tự ghi (replace) và làm rơi location.state → mất backTo.
        navigate(ingredientDetailPath(ingredient, tab, sinceISO), { state: onClose ? undefined : { backTo: `/addresses?reopen=${unitKey}` } }) // chuông: Back về trang trước, không phải /addresses
    }

    const reopenReady = !!(reopenKey && loaded[reopenKey])
    useEffect(() => { if (reopenReady) focusRef.current?.scrollIntoView({ block: 'start' }) }, [reopenReady])
    // Mở dòng → cuộn dòng đó lên đầu sheet, khỏi phải kéo xuống tới phần nguyên liệu. Chạy trong effect (sau khi phần mở rộng
    // đã vẽ) vì cuộn sớm hơn bị chặn ở mức cuộn tối đa lúc đó.
    useEffect(() => {
        if (scrollTo) scrollRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, [scrollTo])

    return (
        <>
            {!onClose && <NoticeBar icon={<ClipboardList size={15} className="text-primary shrink-0" />} label="Việc cần làm" count={total - doneCount} onClick={() => setOpen(true)} />}
            {open && !pay && (
                <NoticeSheet icon={<span className="shrink-0 text-[16px] font-black text-primary tabular-nums">{doneCount}/{total}</span>} title="Việc cần làm" count="" onClose={() => { setOpen(false); onClose?.() }}>
                    {stockRows.length > 0 && (
                        <div className="pt-3">
                            {stockRows.map(u => {
                                const st = stats[u.key]
                                const data = loaded[u.key]
                                const isOpen = expanded === u.key && !!data
                                return (
                                    <div key={u.key} ref={u.key === scrollTo ? scrollRef : u.key === reopenKey ? focusRef : undefined} className="border-b border-border/30 last:border-0">
                                        <Row
                                            name={u.name}
                                            note={noteOf(st, !!data)}
                                            tone={!st ? (data ? 'text-danger' : undefined) : st.need === 0 ? 'text-success' : st.need < st.total ? 'text-warning' : 'text-danger'}
                                            expanded={isOpen}
                                            busy={!data}
                                            onClick={data ? () => {
                                                setExpanded(isOpen ? null : u.key)
                                                setScrollTo(isOpen ? null : u.key)
                                            } : undefined}
                                        />
                                        {/* Thụt vào + vạch dọc cam: danh sách món thuộc về kho ngay phía trên, không lẫn với dòng kho kế tiếp. */}
                                        {isOpen && (
                                            <div className="ml-1.5 mb-2 pl-3.5 border-l-2 border-primary/50">
                                                <AddressDebts key={debtVer} addressId={u.target.id} onPay={invoice => setPay({ addressId: u.target.id, invoice })} onOpenIngredient={(ing, tab, since) => openIngredient(u.key, u.target, ing, tab, since)} />
                                                <HubBuyBody addressId={u.target.id} prep={data.prep} bought={data.bought} minAsFloor={!u.hub} skipped={skips[u.target.id]} onSkip={ing => toggleSkip(u.target.id, ing)} onOpenIngredient={ing => openIngredient(u.key, u.target, ing)} onAfterRestock={data.refreshBought} />
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </NoticeSheet>
            )}
            {payNode}
            {/* Bộ tải nền: mount dần, mỗi lần tối đa STOCK_CONCURRENCY kho đang chạy */}
            {!statsLoading && loadOrder.slice(0, STOCK_CONCURRENCY + Object.keys(loaded).length).map(u => <StockLoader key={u.key} unit={u} skipped={skips[u.target.id]} onResult={onStock} />)}
        </>
    )
}

// Công nợ của địa chỉ đích, ngay trên danh sách "Cần mua" của dòng mở rộng (cùng danh sách + form trả nợ với sheet Bổ sung tồn kho).
function AddressDebts({ addressId, onPay, onOpenIngredient }: { addressId: string; onPay: (invoice: Row) => void; onOpenIngredient: (ingredient: string, tab: 'history', sinceISO: string) => void }) {
    const { debts } = useIngredientDebts(addressId) // key đổi sau mỗi lần trả nợ → mount lại: hiện bản cũ rồi tải số mới
    if (debts.length === 0) return null
    return (
        <div className="pt-1 pb-2">
            <p className="pb-1 text-[11px] font-black uppercase tracking-wide text-warning">Công nợ</p>
            <DebtList debts={debts} onPay={onPay} onOpenIngredient={onOpenIngredient} />
            <p className="pt-3 text-[11px] font-black uppercase tracking-wide text-text-secondary">Cần mua</p>
        </div>
    )
}

// Dòng phụ nói số CÒN PHẢI LÀM (không phải số đã xong) để "0/14" không bị đọc thành "0 nguyên liệu cần bổ sung".
function noteOf(st: StockStat | undefined, hasData: boolean) {
    if (!st) return hasData ? 'Không tải được · bấm để thử lại' : 'Đang tính…' // có data mà không có stat = StockLoader báo lỗi
    const sync = hasData ? '' : ' · đang cập nhật…'
    return st.need === 0 ? `Đã đủ ${st.total} nguyên liệu${sync}` : `Còn ${st.need}/${st.total} nguyên liệu cần bổ sung${sync}`
}

// tone: màu dòng phụ theo tiến độ — đỏ chưa làm gì, cam đang làm dở, xanh xong hết.
// busy: chưa có số liệu chi tiết → chưa bấm mở được: hiện vòng xoay thay mũi tên, tắt nút.
function Row({ name, note, tone = 'text-text-secondary', expanded, busy, onClick }: { name: string; note: string; tone?: string; expanded: boolean; busy: boolean; onClick?: () => void }) {
    const chevron: ReactNode = busy ? <Loader2 size={16} className="animate-spin" /> : expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />
    return (
        <button type="button" onClick={onClick} disabled={busy} aria-expanded={busy ? undefined : expanded} className="w-full flex items-center gap-3 py-3 text-left disabled:cursor-default">
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="truncate text-[14px] font-black text-text">{name}</span>
                <span className={`text-[13px] font-bold ${tone}`}>{note}</span>
            </span>
            <span className="text-text-dim shrink-0">{chevron}</span>
        </button>
    )
}

// Không vẽ gì — chỉ tải số liệu 1 kho (hook theo cụm địa chỉ) + phần đã mua hôm nay của kho đích, rồi báo tiến độ lên cha.
function StockLoader({ unit, skipped, onResult }: { unit: StockUnit; skipped?: Record<string, boolean>; onResult: (key: string, stat: StockStat | null, data: Loaded) => void }) {
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
