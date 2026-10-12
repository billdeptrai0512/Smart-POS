import { useState, useMemo, useEffect, useCallback } from 'react'
import { Check } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import { useGroupPrep } from '../hooks/useGroupPrep'
import { useProducts } from '../contexts/ProductContext'
import { useHistory } from '../contexts/HistoryContext'
import { fetchWarehouseTransfer, saveWarehouseTransfer, setWarehouseTransferPacked } from '../services/warehouseTransferService'
import { processIngredientRestock } from '../services/orderService'
import { useCashClosedToday } from '../hooks/useCashClosedToday'
import { poolOf } from '../utils/prepToday'
import { draftFromItems, draftToItems, draftTotals, fmtQty, isTrivialQty, shortNames, toQty, type Draft } from '../utils/warehouseTransfer'
import { useConfirm } from '../contexts/ConfirmContext'
import { byIngredientLabel, ingredientLabel, lookupByLabel } from '../utils/ingredients'
import { copyText } from '../utils/clipboard'
import { addDaysVN, dateFullVN, dateStringVN } from '../utils/dateVN'
import { pack2Of, r1 } from '../utils/inventory'
import Toast from '../components/POSPage/Toast'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import type { Address, SelectedAddress } from '../types/domain'
import RestockModal from '../components/IngredientManagementPage/RestockModal'
import GroupBranchCard from '../components/IngredientManagementPage/GroupBranchCard'

const AUTOSAVE_MS = 800

// Trang "Chia hàng" cho chủ/quản lý của nhóm kho chung: một màn, mỗi nguyên liệu một thẻ — kho còn bao nhiêu, mỗi chi nhánh
// nhận bao nhiêu (quản lý TOÀN QUYỀN, tự gõ), máy cộng và báo đỏ nếu chia vượt kho. Tự lưu. Bấm "Xong" thì chốt và đổi sang
// danh sách đi phát theo từng chi nhánh (chữ lớn, sao chép gửi Zalo được). Chốt chưa trừ kho — kho chỉ trừ khi chi nhánh ghi
// "Nhập thêm" lúc chốt ca; giao/nhận làm ở bước sau.
export default function GroupPrepPage() {
    const { isGuest, isManager, isAdmin } = useAuth()
    const { selectedAddress, addressId, siblingsByAddress, addresses, fetchError, warehouseRole, canDistribute } = useAddress()
    const siblings = addressId ? siblingsByAddress[addressId] : null
    // Tải thẳng URL: địa chỉ chọn đọc từ cache nhưng danh sách `addresses`/nhóm (nguồn của siblings, kho tổng) về sau — chờ, đừng đá đi vội.
    if ((addresses.length === 0 && !fetchError) || warehouseRole === 'pending') return null
    // Chia hàng là việc của KHO TỔNG (hoặc nhóm chưa đặt kho tổng); chi nhánh thường chỉ nhận hàng.
    if (isGuest || !(isManager || isAdmin) || !siblings?.length || !canDistribute) return <Navigate to="/inventory/stocking" replace />
    return <Page selectedAddress={selectedAddress!} siblings={siblings} />
}

function Page({ selectedAddress, siblings }: { selectedAddress: SelectedAddress; siblings: Address[] }) {
    const navigate = useNavigate()
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()
    const { profile } = useAuth()
    const { refreshProducts } = useProducts()
    const { refreshTodayExpenses } = useHistory()
    const tomorrow = useMemo(() => addDaysVN(new Date(), 1), [])
    const forDate = dateStringVN(tomorrow)
    const groupId = selectedAddress.warehouse_group_id
    const addresses = useMemo(
        () => [selectedAddress, ...siblings].map(a => ({ id: a.id!, name: a.name })),
        [selectedAddress, siblings])
    const { plan, pool, branches, error, reload } = useGroupPrep(addresses)
    const labels = useMemo(() => shortNames(addresses.map(a => a.name)), [addresses])

    // Phiếu đã lưu: null = đang tải. loadError = không đọc được (vd. chưa chạy migration) → vẫn nhập được nhưng chưa lưu được.
    const [draft, setDraft] = useState<Draft | null>(null)
    const [status, setStatus] = useState<'draft' | 'issued'>('draft')
    const [loadError, setLoadError] = useState<Error | null>(null)
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [failed, setFailed] = useState(false)
    // Tick "đã soạn" của kho tổng (chỉ bằng chứng): { `${addressId}|${ingredient}`: packed_at }.
    const [packed, setPacked] = useState<Record<string, string | null>>({})
    const packedOf = (items?: { address_id: string; ingredient: string; packed_at?: string | null }[]) =>
        Object.fromEntries((items || []).filter(i => i.packed_at).map(i => [`${i.address_id}|${i.ingredient}`, i.packed_at!]))
    useEffect(() => {
        let alive = true
        fetchWarehouseTransfer(groupId, forDate)
            .then(t => { if (alive) { setDraft(draftFromItems(t?.items)); setStatus(t?.status || 'draft'); setPacked(packedOf(t?.items)); setFresh(!t) } })
            .catch(err => { console.error('fetchWarehouseTransfer', err); if (alive) { setDraft({}); setLoadError(err) } })
        return () => { alive = false }
    }, [groupId, forDate])
    async function togglePacked(addrId: string, ingredient: string, on: boolean) {
        const key = `${addrId}|${ingredient}`
        const set = (v: string | null) => setPacked(p => ({ ...p, [key]: v }))
        set(on ? new Date().toISOString() : null)
        try {
            set(await setWarehouseTransferPacked(groupId, forDate, addrId, ingredient, on))
        } catch (err) {
            set(on ? null : new Date().toISOString())
            showError(err, 'Lưu dấu đã soạn')
        }
    }

    // Chia vượt kho → nhập kho ngay tại đây (mua hàng ghi vào địa chỉ đang chọn = kho tổng), cùng form Nhập kho như trang chi tiết NVL.
    const [restock, setRestock] = useState<{ ingredient: string; qty: number } | null>(null)
    const cashClosedToday = useCashClosedToday(selectedAddress.id, !!restock)

    const locked = status === 'issued'
    const unitOf = useMemo(() => {
        const m: Record<string, string> = {}
        for (const b of branches || []) for (const i of b.ingredientsList) m[i.ingredient] ??= i.unit
        return m
    }, [branches])
    const unitKeys = useMemo(() => Object.keys(unitOf).sort(byIngredientLabel), [unitOf])

    const update = useCallback((fn: (d: Draft) => Draft) => { setDraft(d => fn(d ?? {})); setDirty(true); setFailed(false) }, [])
    const setQty = (addrId: string, ing: string, v: string) => update(d => ({ ...d, [addrId]: { ...d[addrId], [ing]: v } }))
    // Gợi ý theo dự báo bán hàng: { [addressId]: { [ingredient]: { qty, packs, packUnit } } }. Bỏ số quá nhỏ (vài g/ml) — nhiễu.
    // Chi nhánh chưa có đơn thì plan rỗng, không có gì gợi ý.
    const suggestOf = useMemo(() => {
        const m: Record<string, Record<string, { qty: number; packs: number; packUnit?: string | null; sampleDays?: number }>> = {}
        for (const r of plan ?? []) for (const b of r.branches) if (b.qty > 0 && !isTrivialQty(b.qty, r.unit)) (m[b.id] ||= {})[r.ingredient] = b
        return m
    }, [plan])
    // Điền các gợi ý vào ô đang trống.
    const suggest = (d: Draft) => {
        const next = { ...d }
        for (const [addrId, row] of Object.entries(suggestOf)) {
            const cur = next[addrId] = { ...d[addrId] }
            for (const [ing, s] of Object.entries(row)) if (!(toQty(cur[ing]) > 0)) cur[ing] = String(s.qty)
        }
        return next
    }
    // Mở trang lần đầu cho ngày này (chưa có phiếu lưu) → điền sẵn một lần khi dự báo về. Không đánh dấu "dirty": chỉ xem thì
    // chưa ghi gì; sửa ô nào hoặc bấm "Xong" mới lưu. Đã có phiếu lưu thì giữ nguyên số quản lý đã gõ (kể cả cố ý xoá ô).
    const [fresh, setFresh] = useState(false)
    useEffect(() => {
        if (!fresh || !plan) return
        setFresh(false)
        setDraft(d => suggest(d ?? {}))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fresh, plan])

    const items = useMemo(() => draftToItems(draft, unitOf), [draft, unitOf])
    async function save(nextStatus: 'draft' | 'issued') {
        setSaving(true)
        try {
            await saveWarehouseTransfer(groupId, forDate, items, nextStatus)
            setStatus(nextStatus)
            setDirty(false)
            setFailed(false)
            // Lưu phiếu bỏ tick của dòng đã đổi số — đọc lại cho khớp server.
            if (nextStatus === 'issued') {
                showToast('Đã chốt danh sách đi phát', 'success')
                fetchWarehouseTransfer(groupId, forDate).then(t => setPacked(packedOf(t?.items))).catch(() => {})
            }
        } catch (err) {
            setFailed(true)
            showError(err, 'Lưu phiếu chia hàng')
        } finally {
            setSaving(false)
        }
    }
    // Tự lưu sau khi ngừng gõ. Đang có lần lưu chạy (vd. vừa bấm "Xong") thì dừng — kẻo lần lưu nháp đến sau ghi đè trạng thái
    // đã chốt. Lưu hỏng thì chờ lần sửa kế (setFailed(false) khi sửa) — không thử lại vòng lặp.
    useEffect(() => {
        if (!dirty || locked || loadError || failed || saving) return
        const t = setTimeout(() => save('draft'), AUTOSAVE_MS)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft, dirty, locked, loadError, failed, saving])

    const totals = useMemo(() => draftTotals(draft), [draft])
    // Thẻ "Kho tổng": nguyên liệu kho còn > 0 hoặc đã có số chia. Kho hết mà chưa chia thì ẩn cho đỡ rối.
    const cards = useMemo(() => {
        if (!branches) return []
        return unitKeys
            .filter(k => poolOf(k, pool) > 0 || totals[k] > 0)
            .map(k => ({ ingredient: k, unit: unitOf[k], pool: poolOf(k, pool), total: totals[k] || 0 }))
    }, [branches, unitKeys, unitOf, pool, totals])
    // Danh sách "Cần mua": kho tổng phải giữ tồn tối thiểu (max min_stock của các chi nhánh) SAU khi chia hết số đã gõ —
    // cần mua = min_stock + Σ chia − kho còn (cùng công thức buildGroupPrepPlan, nhưng tính trên số quản lý thực gõ).
    const buyList = useMemo(() => {
        const minStock: Record<string, number> = {}
        for (const b of branches || []) for (const i of b.ingredientsList) minStock[i.ingredient] = Math.max(minStock[i.ingredient] || 0, r1(i.min_stock))
        return unitKeys
            .map(k => ({ ingredient: k, unit: unitOf[k], buy: Math.max(0, r1((minStock[k] || 0) + (totals[k] || 0) - poolOf(k, pool))) }))
            .filter(x => x.buy > 0)
    }, [branches, unitKeys, unitOf, pool, totals])
    // Dòng của từng chi nhánh = nguyên liệu có gợi ý + nguyên liệu đã có ô (đã gõ/đã lưu/vừa thêm; xoá trắng số vẫn giữ dòng).
    const allOptions = useMemo(
        () => unitKeys.map(k => ({ value: k, label: ingredientLabel(k) })),
        [unitKeys])
    const rowsOf = (addrId: string) => [...new Set([...Object.keys(suggestOf[addrId] || {}), ...Object.keys(draft?.[addrId] || {})])]
        .sort(byIngredientLabel)
        .map(k => ({ ingredient: k, unit: unitOf[k] ?? '', value: draft?.[addrId]?.[k] ?? '', left: r1(poolOf(k, pool) - (totals[k] || 0)), suggest: suggestOf[addrId]?.[k] }))
    const overCards = cards.filter(c => c.total > c.pool)
    const hasOver = overCards.length > 0
    // Chia vượt kho vẫn cho chốt (quản lý toàn quyền) nhưng hỏi lại 1 lần để khỏi bấm nhầm.
    async function finish() {
        if (hasOver && !await confirm({
            title: 'Có nguyên liệu chia nhiều hơn số còn trong kho',
            detail: overCards.map(c => `${ingredientLabel(c.ingredient)}: chia ${fmtQty(c.total, c.unit)}, kho còn ${fmtQty(c.pool, c.unit)}`).join('\n'),
            confirmLabel: 'Vẫn chốt', danger: true,
        })) return
        save('issued')
    }
    const ready = draft !== null && !!branches
    const restockCfg = restock ? branches?.[0]?.ingredientsList.find(i => i.ingredient === restock.ingredient) : undefined // branches[0] = địa chỉ đang chọn

    const sheet = useMemo(() => addresses.map((a, i) => ({
        id: a.id, label: labels[i],
        items: items.filter(it => it.address_id === a.id),
    })), [addresses, labels, items])
    // Mỗi chi nhánh thường có nhóm Zalo riêng → sao chép được từng chi nhánh, hoặc cả phiếu.
    const linesOf = (b: (typeof sheet)[number]) => [b.label, ...b.items.map(it => `- ${ingredientLabel(it.ingredient)}: ${fmtQty(it.qty, it.unit)}`)]
    const copy = async (lines: string[]) => {
        const ok = await copyText([`CHIA HÀNG NGÀY ${dateFullVN(tomorrow)}`, ...lines].join('\n'))
        showToast(ok ? 'Đã sao chép — dán vào Zalo' : 'Không sao chép được', ok ? 'success' : 'warning')
    }
    const copyAll = () => copy(sheet.filter(b => b.items.length).flatMap(b => ['', ...linesOf(b)]))

    return (
        <div className="flex flex-col h-full bg-bg">
            <Toast toast={toast} />
            <IngredientDetailHeader
                title="Chia hàng cho chi nhánh"
                subtitle={`Ngày ${dateFullVN(tomorrow)}`}
                onBack={() => navigate('/inventory/stocking')}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-24">
                <div className="max-w-xl mx-auto w-full space-y-3">
                    {!ready && !error && <p className="text-text-secondary text-[14px] text-center py-8">Đang tải…</p>}
                    {!!error && (
                        <div className="py-4 text-center flex flex-col items-center gap-2">
                            <span className="text-[14px] font-bold text-danger">Không tải được số liệu kho</span>
                            <button type="button" onClick={reload} className="text-[13px] font-bold text-primary">Thử lại</button>
                        </div>
                    )}
                    {loadError && (
                        <p className="text-warning text-[13px] font-bold py-2 px-3 bg-warning-soft rounded-[12px] border border-warning/20">
                            Chưa lưu được ({loadError.message}). Nếu chưa chạy migration 20261011_warehouse_transfers.sql thì chạy trước.
                        </p>
                    )}

                    {ready && locked && (
                        <>
                            <div className="rounded-[14px] border border-success/30 bg-success/10 p-3 flex items-center gap-3">
                                <span className="flex-1 text-[15px] font-black text-success">Đã chốt — đưa danh sách này cho người đi phát</span>
                                <button type="button" onClick={() => save('draft')} disabled={saving} className="shrink-0 text-[13px] font-bold text-primary disabled:opacity-50">Sửa lại</button>
                            </div>
                            {hasOver && <p className="text-danger text-[13px] font-bold">Lưu ý: có nguyên liệu chia nhiều hơn số còn trong kho.</p>}
                            {sheet.map(b => {
                                const done = b.items.filter(it => packed[`${b.id}|${it.ingredient}`]).length
                                const all = done === b.items.length
                                return (
                                <div key={b.id} className="bg-surface border border-border/60 rounded-[14px] p-3">
                                    <div className="flex items-center gap-2">
                                        <h3 className="flex-1 min-w-0 truncate text-[13px] font-bold text-text">{b.label}</h3>
                                        {b.items.length > 0 && (
                                            <>
                                                <button type="button" onClick={() => copy(linesOf(b))} className="shrink-0 text-[12px] font-semibold text-primary">Sao chép</button>
                                                <span className={`shrink-0 text-[12px] font-bold tabular-nums ${all ? 'text-success' : 'text-text-dim'}`}>{done}/{b.items.length}</span>
                                            </>
                                        )}
                                    </div>
                                    {b.items.length === 0
                                        ? <p className="text-[12px] text-text-dim mt-1">Không có gì</p>
                                        : b.items.map(it => {
                                            const on = !!packed[`${b.id}|${it.ingredient}`]
                                            return (
                                                <button key={it.ingredient} type="button" onClick={() => togglePacked(b.id, it.ingredient, !on)} className="w-full flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0 text-left">
                                                    <span className={`w-5 h-5 shrink-0 rounded-[6px] border flex items-center justify-center ${on ? 'bg-success border-success text-bg' : 'border-border'}`}>
                                                        {on && <Check size={13} strokeWidth={3} />}
                                                    </span>
                                                    <span className={`flex-1 min-w-0 truncate text-[13px] ${on ? 'text-text-dim' : 'text-text'}`}>{ingredientLabel(it.ingredient)}</span>
                                                    <span className={`shrink-0 text-[14px] font-bold tabular-nums ${on ? 'text-text-dim' : 'text-text'}`}>{fmtQty(it.qty, it.unit)}</span>
                                                </button>
                                            )
                                        })}
                                </div>
                                )
                            })}
                            <button type="button" onClick={copyAll} className="w-full py-3 rounded-[14px] bg-primary text-bg text-[15px] font-black">Sao chép để gửi Zalo</button>
                        </>
                    )}

                    {ready && !locked && (
                        <>
                            {buyList.length > 0 && (
                                <div className="bg-surface border border-warning/30 rounded-[14px] p-3">
                                    <h3 className="text-[13px] font-bold text-warning">Cần mua cho kho tổng</h3>
                                    {buyList.map(x => (
                                        <div key={x.ingredient} className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0">
                                            <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-text">{ingredientLabel(x.ingredient)}</span>
                                            <span className="text-[13px] font-semibold tabular-nums text-text">{fmtQty(x.buy, x.unit)}</span>
                                            <button type="button" onClick={() => setRestock({ ingredient: x.ingredient, qty: x.buy })} className="shrink-0 px-2 py-1 rounded-[8px] bg-primary text-bg text-[11px] font-black">Nhập kho</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {addresses.map((a, i) => (
                                <GroupBranchCard
                                    key={a.id} label={labels[i]} rows={rowsOf(a.id)}
                                    options={allOptions}
                                    onChange={(ing, v) => setQty(a.id, ing, v)}
                                    onAdd={ing => setQty(a.id, ing, '')}
                                />
                            ))}
                        </>
                    )}
                </div>
            </main>

            {restock && (
                <RestockModal
                    ingredient={restock.ingredient}
                    unit={unitOf[restock.ingredient] || 'đv'}
                    packSize={restockCfg?.pack_size}
                    packUnit={restockCfg?.pack_unit}
                    pack2={pack2Of(restockCfg)}
                    initialQty={restock.qty}
                    cashClosedToday={cashClosedToday}
                    onClose={() => setRestock(null)}
                    onConfirm={async ({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }) => {
                        const wh = lookupByLabel<number | null>(ing, pool, null)
                        const result = await processIngredientRestock(selectedAddress.id ?? null, ing, qty, profile?.name ?? null, {
                            subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
                            ...(wh != null ? { beforeStock: wh } : {}),
                        })
                        // Kho đổi → tươi lại số kho nhóm, giá vốn (context sản phẩm) và chi phí hôm nay.
                        await Promise.all([reload(), refreshProducts?.(), refreshTodayExpenses?.()])
                        return result
                    }}
                />
            )}

            {ready && !locked && (
                <footer className="shrink-0 border-t border-border/60 bg-surface px-4 py-3">
                    <div className="max-w-xl mx-auto flex items-center gap-3">
                        <span className="flex-1 min-w-0 text-[13px] text-text-secondary">
                            {new Set(items.map(it => it.address_id)).size}/{addresses.length} chi nhánh có hàng
                            {hasOver && <span className="text-danger font-bold"> · {overCards.length} vượt kho</span>}
                            {(failed || saving || dirty) && <span className={failed ? 'text-danger font-bold' : 'text-text-dim'}> · {failed ? 'chưa lưu được' : 'đang lưu…'}</span>}
                        </span>
                        <button type="button" onClick={finish} disabled={saving} className="px-5 py-2.5 rounded-[12px] bg-primary text-bg text-[15px] font-black disabled:opacity-40">Xong, gửi đi phát</button>
                    </div>
                </footer>
            )}
        </div>
    )
}
