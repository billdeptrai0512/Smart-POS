import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAddress } from '../contexts/AddressContext'
import { useEntitlement } from '../hooks/useEntitlement'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { fetchRestockSummary, groupByIngredient, type RestockSummaryRow } from '../services/restockSummaryService'
import { formatVND } from '../utils'
import { packHint, pack2Of } from '../utils/inventory'
import { ingredientLabel, getIngredientUnit } from '../utils/ingredients'
import { dateStringVN } from '../utils/dateVN'
import { calcRangeWithLabel } from '../utils/rangeCalc'
import { useDateScope } from '../hooks/useDateScope'
import { DateRangePicker } from '../components/HistoryPage/HistoryHeader'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import Skeleton from '../components/common/Skeleton'
import type { Row, UUID } from '../types/domain'

const LABEL = 'text-[11px] font-black uppercase tracking-wide text-text-secondary'
const PILL = 'h-[22px] px-2 text-[11px] font-bold text-text-secondary/70 inline-flex items-center rounded-full bg-surface-light border border-border/60 leading-none whitespace-nowrap'

// Tổng hợp nhập kho của mọi nguyên liệu trong 1 khoảng ngày: đã nhập bao nhiêu, tốn bao nhiêu tiền, còn nợ,
// và (kho tổng chung) rút ra quầy từng địa chỉ bao nhiêu. Chạm 1 dòng → Nhật ký của nguyên liệu đó cùng khoảng ngày.
export default function InventorySummaryPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { addressId, selectedAddress, siblingsByAddress } = useAddress()
    const { ingredientUnits, ingredientConfigs, ingredientCosts } = useProducts()
    const { isManager, isAdmin } = useAuth()
    const canView = isManager || isAdmin
    // Báo cáo chi/nợ nhập kho → cùng gate gói với Báo cáo (xem DailyReportPage).
    const { hasAccess, loading: entitlementLoading, enabled: monetizationEnabled } = useEntitlement()
    const locked = monetizationEnabled && !entitlementLoading && !hasAccess

    // Kho tổng chung = 1 kho: gộp cả nhóm; tên địa chỉ để tách "rút ra quầy" theo chi nhánh.
    const siblings = addressId ? siblingsByAddress[addressId] : null
    const siblingKey = (siblings || []).map(a => a.id).join(',')
    const groupIds = useMemo(() => addressId ? [addressId, ...(siblingKey ? siblingKey.split(',') : [])] : [], [addressId, siblingKey])
    const nameById = useMemo(() => {
        const m: Record<string, string> = {}
        if (addressId && selectedAddress) m[addressId] = selectedAddress.name
        for (const a of siblings || []) m[a.id] = a.name
        return m
    }, [addressId, selectedAddress, siblings])

    const dateScope = useDateScope({ scope: 'month', offset: 0 })
    const { scope: dScope, offset: dOffset, customRange: dCustom } = dateScope
    const { fromDate, toDate, rangeLabel } = useMemo(() => {
        const { start, end, label } = calcRangeWithLabel(dScope, dOffset, dCustom)
        return { fromDate: start.toISOString(), toDate: end.toISOString(), rangeLabel: label }
    }, [dScope, dOffset, dCustom])

    const [rows, setRows] = useState<RestockSummaryRow[] | null>(null)
    const [failed, setFailed] = useState(false)
    useEffect(() => {
        if (!groupIds.length || locked) return
        let stale = false
        // eslint-disable-next-line react-hooks/set-state-in-effect -- xoá kết quả cũ khi đổi khoảng ngày/nhóm trước khi tải lại
        setRows(null); setFailed(false)
        fetchRestockSummary(groupIds, fromDate, toDate)
            .then(r => { if (!stale) setRows(r) })
            .catch(err => { console.error('fetchRestockSummary', err); if (!stale) setFailed(true) })
        return () => { stale = true }
    }, [groupIds, fromDate, toDate, locked])

    // Kho tổng chung: chọn 1 địa chỉ → chỉ số của địa chỉ đó (rút bao nhiêu, trị giá bao nhiêu) cho mọi nguyên liệu.
    const [filterAddr, setFilterAddr] = useState<UUID | null>(null)
    // value = trị giá rút ra quầy: không có tiền thật → lượng × giá vốn hiện tại (ước tính).
    const list = useMemo(() => groupByIngredient(rows || [], filterAddr).map(g => ({ ...g, value: g.withdrawnQty * (ingredientCosts[g.ingredient] || 0) })), [rows, filterAddr, ingredientCosts])
    const cfgByKey = useMemo(() => new Map((ingredientConfigs || []).map((c: Row) => [c.ingredient, c])), [ingredientConfigs])
    const totals = useMemo(() => list.reduce((t, r) => ({ spent: t.spent + r.spent, owing: t.owing + r.owing, withdrawn: t.withdrawn + r.value }), { spent: 0, owing: 0, withdrawn: 0 }), [list])

    const open = (key: string) => {
        const q = new URLSearchParams(location.search)
        q.set('tab', 'history')
        navigate(`/inventory/stocking/${key}?${q}`, { state: { ...location.state, backTo: location.pathname + location.search } })
    }

    if (locked) return <Navigate to="/subscription" replace state={{ preselectAddressId: addressId, from: '/inventory/stocking' }} />

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <IngredientDetailHeader
                title="Tổng hợp nhập kho"
                onBack={() => navigate('/inventory/stocking')}
                dateNav={
                    <DateRangePicker
                        scope={dScope}
                        rangeLabel={rangeLabel}
                        rangeStartISO={dateStringVN(new Date(fromDate))}
                        rangeEndISO={dateStringVN(new Date(toDate))}
                        dayInputValue={dateScope.dayInputValue}
                        customRange={dCustom}
                        todayISO={dateScope.todayISO}
                        canGoForwardDay={dateScope.canGoForwardDay}
                        canGoForward={dateScope.canGoForwardPeriod}
                        onPrevDay={dateScope.goPrevDay}
                        onNextDay={dateScope.goNextDay}
                        onOffsetPrev={dateScope.goOffsetPrev}
                        onOffsetNext={dateScope.goOffsetNext}
                        onRangeChange={dateScope.applyRange}
                        onShiftRange={dateScope.shiftRange}
                        canShiftRangeForward={dateScope.canShiftRangeForward}
                        onPresetSelect={dateScope.applyPreset}
                    />
                }
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-24 bg-bg flex flex-col gap-3">
                {!canView ? (
                    <p className="text-text-secondary text-[13px] text-center py-10">Chỉ quản lý mới xem được tổng hợp nhập kho.</p>
                ) : !groupIds.length ? (
                    <p className="text-text-secondary text-[13px] text-center py-10">Chọn một địa chỉ để xem tổng hợp nhập kho.</p>
                ) : failed ? (
                    <p className="text-danger text-[13px] text-center py-10">Không tải được dữ liệu. Thử lại sau.</p>
                ) : rows === null ? (
                    [0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[96px] rounded-[16px]" />)
                ) : (<>
                    {groupIds.length > 1 && (
                        <div className="flex flex-wrap gap-1.5 pt-3 border-t border-border/40">
                            {[{ id: null, name: 'Tất cả' }, ...groupIds.map(id => ({ id, name: nameById[id] || 'Địa chỉ' }))].map(c => (
                                <button
                                    key={c.id ?? 'all'}
                                    onClick={() => setFilterAddr(c.id)}
                                    className={`h-[30px] px-3 rounded-full border text-[12px] font-bold whitespace-nowrap transition-colors active:scale-95 ${filterAddr === c.id ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-surface-light border-border/60 text-text-secondary'}`}
                                >{c.name}</button>
                            ))}
                        </div>
                    )}
                    {list.length === 0 ? (
                        <p className="text-text-secondary text-[13px] text-center py-10 bg-surface-light rounded-[14px] border border-border/40">Chưa có nhập kho nào trong {rangeLabel}.</p>
                    ) : (<>
                    <div className="bg-surface rounded-[16px] border border-border/60 p-4">
                        <div className="grid grid-cols-[1fr_auto_1fr] gap-x-4">
                            <div className="flex flex-col items-start">
                                <span className={LABEL}>Tổng tiền</span>
                                <span className="text-[20px] font-black tabular-nums mt-1 text-text">{formatVND(totals.spent)}</span>
                            </div>
                            <div className="w-px bg-border/50" />
                            <div className="flex flex-col items-end">
                                <span className={`${LABEL} ${totals.owing > 0 ? 'text-warning' : ''}`}>Còn nợ</span>
                                <span className={`text-[20px] font-black tabular-nums mt-1 ${totals.owing > 0 ? 'text-warning' : 'text-text-dim'}`}>{formatVND(totals.owing)}</span>
                            </div>
                        </div>
                        {totals.withdrawn > 0 && (
                            <div className="flex items-baseline justify-between gap-3 mt-3 pt-3 border-t border-border/40">
                                <span className={LABEL}>Trị giá rút ra quầy (giá vốn)</span>
                                <span className="text-[15px] font-black tabular-nums text-text shrink-0">{formatVND(Math.round(totals.withdrawn))}</span>
                            </div>
                        )}
                    </div>

                    <span className={`${LABEL} px-1 mt-1`}>{list.length} nguyên liệu</span>
                                        {list.map(r => {
                        const cfg = cfgByKey.get(r.ingredient)
                        const unit = getIngredientUnit(r.ingredient, ingredientUnits[r.ingredient])
                        // Số chính = đơn vị nhỏ nhất (như Nhật ký / Thông tin); "= 20 bịch" chỉ là gợi ý nhỏ.
                        const fmt = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('vi-VN')} ${unit}`
                        const hint = (n: number) => packHint(n, cfg?.pack_size, cfg?.pack_unit, unit, pack2Of(cfg))
                        const withdrawnTotal = r.withdrawnQty
                        const perAddress = groupIds.length > 1 && !filterAddr ? groupIds.filter(id => r.withdrawn[id]) : []
                        return (
                            <button
                                key={r.ingredient}
                                onClick={() => open(r.ingredient)}
                                className="shrink-0 w-full text-left bg-surface border border-border/60 rounded-[16px] p-4 flex flex-col gap-3 active:scale-[0.99] hover:border-primary/40 transition-all"
                            >
                                <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-border/40">
                                    <span className="text-[15px] font-black text-text truncate">{ingredientLabel(r.ingredient)}</span>
                                </div>
                                <div className={`grid gap-3 divide-x divide-border/40 [&>div:not(:first-child)]:pl-3 ${r.owing > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
                                    <div className="flex flex-col"><span className={LABEL}>Đã nhập</span><span className={`text-[14px] font-bold tabular-nums mt-0.5 ${r.qty ? 'text-text' : 'text-text-dim'}`}>{r.qty ? fmt(r.qty) : '—'}</span>{hint(r.qty) && <span className="text-[11px] font-medium tabular-nums text-text-dim">{hint(r.qty)}</span>}{r.spent > 0 && <span className="text-[11px] font-medium tabular-nums text-text-dim">= {formatVND(r.spent)}</span>}</div>
                                    <div className="flex flex-col"><span className={LABEL}>Rút ra quầy</span><span className="text-[14px] font-bold tabular-nums text-text mt-0.5">{withdrawnTotal ? fmt(withdrawnTotal) : '—'}</span>{hint(withdrawnTotal) && <span className="text-[11px] font-medium tabular-nums text-text-dim">{hint(withdrawnTotal)}</span>}{r.value > 0 && <span className="text-[11px] font-medium tabular-nums text-text-dim">≈ {formatVND(Math.round(r.value))}</span>}</div>
                                    {r.owing > 0 && <div className="flex flex-col items-end"><span className={`${LABEL} text-warning`}>Còn nợ</span><span className="text-[14px] font-bold tabular-nums mt-0.5 text-warning">{formatVND(r.owing)}</span></div>}
                                </div>
                                {perAddress.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {perAddress.map(id => (
                                            <span key={id} className={PILL}>{nameById[id] || 'Địa chỉ'} · {fmt(r.withdrawn[id])}</span>
                                        ))}
                                    </div>
                                )}
                            </button>
                        )
                    })}
                    </>)}
                </>)}
            </main>
        </div>
    )
}
