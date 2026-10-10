import { useState, useMemo, useEffect, useCallback } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import { useGroupPrep } from '../hooks/useGroupPrep'
import { useProducts } from '../contexts/ProductContext'
import { useHistory } from '../contexts/HistoryContext'
import { fetchWarehouseTransfer, saveWarehouseTransfer } from '../services/warehouseTransferService'
import { processIngredientRestock } from '../services/orderService'
import { fetchCashClosedToday } from '../services/reportService'
import { poolOf } from '../utils/prepToday'
import { draftFromItems, draftToItems, draftTotals, fmtQty, shortNames, toQty } from '../utils/warehouseTransfer'
import { useConfirm } from '../contexts/ConfirmContext'
import { ingredientLabel, lookupByLabel } from '../utils/ingredients'
import { addDaysVN, dateFullVN, dateStringVN } from '../utils/dateVN'
import { pack2Of, r1 } from '../utils/inventory'
import Toast from '../components/POSPage/Toast'
import Dropdown from '../components/common/Dropdown'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import RestockModal from '../components/IngredientManagementPage/RestockModal'

const AUTOSAVE_MS = 800

// Trang "Chia hàng" cho chủ/quản lý của nhóm kho chung: một màn, mỗi nguyên liệu một thẻ — kho còn bao nhiêu, mỗi chi nhánh
// nhận bao nhiêu (quản lý TOÀN QUYỀN, tự gõ), máy cộng và báo đỏ nếu chia vượt kho. Tự lưu. Bấm "Xong" thì chốt và đổi sang
// danh sách đi phát theo từng chi nhánh (chữ lớn, sao chép gửi Zalo được). Chốt chưa trừ kho — kho chỉ trừ khi chi nhánh ghi
// "Nhập thêm" lúc chốt ca; giao/nhận làm ở bước sau.
export default function GroupPrepPage() {
    const { isGuest, isManager, isAdmin } = useAuth()
    const { selectedAddress, siblingsByAddress, addresses, fetchError, warehouseRole } = useAddress()
    const siblings = selectedAddress ? siblingsByAddress[selectedAddress.id] : null
    // Tải thẳng URL: địa chỉ chọn đọc từ cache nhưng danh sách `addresses`/nhóm (nguồn của siblings, kho tổng) về sau — chờ, đừng đá đi vội.
    if ((addresses.length === 0 && !fetchError) || warehouseRole === 'pending') return null
    // Chia hàng là việc của KHO TỔNG (hoặc nhóm chưa đặt kho tổng); chi nhánh thường chỉ nhận hàng.
    const canDistribute = warehouseRole === 'hub' || warehouseRole === 'nohub'
    if (isGuest || !(isManager || isAdmin) || !siblings?.length || !canDistribute) return <Navigate to="/inventory/stocking" replace />
    return <Page selectedAddress={selectedAddress} siblings={siblings} />
}

function Page({ selectedAddress, siblings }) {
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
        () => [selectedAddress, ...siblings].map(a => ({ id: a.id, name: a.name })),
        [selectedAddress, siblings])
    const { plan, pool, branches, error, reload } = useGroupPrep(addresses)
    const labels = useMemo(() => shortNames(addresses.map(a => a.name)), [addresses])

    // Phiếu đã lưu: null = đang tải. loadError = không đọc được (vd. chưa chạy migration) → vẫn nhập được nhưng chưa lưu được.
    const [draft, setDraft] = useState(null)
    const [status, setStatus] = useState('draft')
    const [loadError, setLoadError] = useState(null)
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [failed, setFailed] = useState(false)
    const [added, setAdded] = useState([]) // nguyên liệu quản lý thêm tay (kho đang 0 / chưa có số) — chỉ để hiện thẻ
    useEffect(() => {
        let alive = true
        fetchWarehouseTransfer(groupId, forDate)
            .then(t => { if (alive) { setDraft(draftFromItems(t?.items)); setStatus(t?.status || 'draft') } })
            .catch(err => { console.error('fetchWarehouseTransfer', err); if (alive) { setDraft({}); setLoadError(err) } })
        return () => { alive = false }
    }, [groupId, forDate])

    // Chia vượt kho → nhập kho ngay tại đây (mua hàng ghi vào địa chỉ đang chọn = kho tổng), cùng form Nhập kho như trang chi tiết NVL.
    const [restock, setRestock] = useState(null) // { ingredient, qty }
    const [cashClosedToday, setCashClosedToday] = useState(false)
    useEffect(() => {
        if (!restock) return
        let alive = true
        fetchCashClosedToday(selectedAddress.id).then(v => { if (alive) setCashClosedToday(!!v) })
        return () => { alive = false }
    }, [restock, selectedAddress.id])

    const locked = status === 'issued'
    const unitOf = useMemo(() => {
        const m = {}
        for (const b of branches || []) for (const i of b.ingredientsList) m[i.ingredient] ??= i.unit
        return m
    }, [branches])

    const update = useCallback((fn) => { setDraft(fn); setDirty(true); setFailed(false) }, [])
    const setQty = (addrId, ing, v) => update(d => ({ ...d, [addrId]: { ...d[addrId], [ing]: v } }))
    // Điền theo dự báo bán hàng — chỉ ô đang trống; chi nhánh mới chưa có đơn thì plan rỗng và nút này không hiện.
    const fillSuggestion = () => update(d => {
        const next = { ...d }
        for (const r of plan) for (const b of r.branches) {
            const cur = next[b.id] = { ...d[b.id] }
            if (b.qty > 0 && !(toQty(cur[r.ingredient]) > 0)) cur[r.ingredient] = String(b.qty)
        }
        return next
    })

    async function save(nextStatus) {
        setSaving(true)
        try {
            await saveWarehouseTransfer(groupId, forDate, draftToItems(draft, unitOf), nextStatus)
            setStatus(nextStatus)
            setDirty(false)
            setFailed(false)
            if (nextStatus === 'issued') showToast('Đã chốt danh sách đi phát', 'success')
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
    // Thẻ nguyên liệu: kho còn > 0, hoặc đã có số, hoặc quản lý vừa thêm. Kho hết thì ẩn cho đỡ rối.
    const cards = useMemo(() => {
        if (!branches) return []
        return Object.keys(unitOf)
            .filter(k => poolOf(k, pool) > 0 || totals[k] > 0 || added.includes(k))
            .sort((a, b) => ingredientLabel(a).localeCompare(ingredientLabel(b), 'vi'))
            .map(k => ({ ingredient: k, unit: unitOf[k], pool: poolOf(k, pool), total: totals[k] || 0 }))
    }, [branches, unitOf, pool, totals, added])
    const moreOptions = useMemo(
        () => Object.keys(unitOf).filter(k => !cards.some(c => c.ingredient === k)).sort((a, b) => ingredientLabel(a).localeCompare(ingredientLabel(b), 'vi')),
        [unitOf, cards])
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

    const sheet = useMemo(() => addresses.map((a, i) => ({
        id: a.id, label: labels[i],
        items: draftToItems(draft, unitOf).filter(it => it.address_id === a.id),
    })), [addresses, labels, draft, unitOf])
    function copyText() {
        const text = [`CHIA HÀNG NGÀY ${dateFullVN(tomorrow)}`, ...sheet.filter(b => b.items.length).flatMap(b =>
            ['', b.label, ...b.items.map(it => `- ${ingredientLabel(it.ingredient)}: ${fmtQty(it.qty, it.unit)}`)])].join('\n')
        navigator.clipboard.writeText(text).then(() => showToast('Đã sao chép — dán vào Zalo', 'success'), err => showError(err, 'Sao chép'))
    }

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
                    {error && (
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
                            {sheet.map(b => (
                                <div key={b.id} className="bg-surface border border-border/60 rounded-[16px] p-4 shadow-sm">
                                    <h3 className="font-black text-[18px] text-text">{b.label}</h3>
                                    {b.items.length === 0
                                        ? <p className="text-[14px] text-text-dim mt-1">Không có gì</p>
                                        : b.items.map(it => (
                                            <div key={it.ingredient} className="flex items-baseline gap-2 mt-1.5">
                                                <span className="flex-1 min-w-0 text-[16px] text-text">{ingredientLabel(it.ingredient)}</span>
                                                <span className="shrink-0 text-[18px] font-black tabular-nums text-text">{fmtQty(it.qty, it.unit)}</span>
                                            </div>
                                        ))}
                                </div>
                            ))}
                            <button type="button" onClick={copyText} className="w-full py-3 rounded-[14px] bg-primary text-bg text-[15px] font-black">Sao chép để gửi Zalo</button>
                        </>
                    )}

                    {ready && !locked && (
                        <>
                            <p className="text-text-secondary text-[14px] leading-relaxed">
                                Gõ số lượng mỗi chi nhánh được nhận. Máy tự cộng và báo đỏ nếu chia nhiều hơn số còn trong kho.
                            </p>
                            {plan?.length > 0 && (
                                <button type="button" onClick={fillSuggestion} className="text-[13px] font-bold text-primary">Điền sẵn theo dự báo bán hàng</button>
                            )}
                            {cards.length === 0 && <p className="text-text-secondary text-[14px] text-center py-6">Kho tổng chưa có nguyên liệu. Bấm “Thêm nguyên liệu khác” bên dưới.</p>}
                            {cards.map(c => {
                                const over = r1(c.total - c.pool)
                                return (
                                    <div key={c.ingredient} className="bg-surface border border-border/60 rounded-[16px] p-4 shadow-sm">
                                        <div className="flex items-baseline gap-2">
                                            <span className="flex-1 min-w-0 truncate text-[17px] font-black text-text">{ingredientLabel(c.ingredient)}</span>
                                            <span className="shrink-0 text-[14px] text-text-secondary">Kho còn <b className="tabular-nums text-text">{fmtQty(c.pool, c.unit)}</b></span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3">
                                            {addresses.map((a, i) => (
                                                <label key={a.id} className="flex flex-col gap-1 min-w-0">
                                                    <span className="truncate text-[13px] text-text-secondary">{labels[i]}</span>
                                                    <span className="flex items-center gap-1.5">
                                                        <input
                                                            type="text" inputMode="decimal" placeholder="0" value={draft[a.id]?.[c.ingredient] ?? ''}
                                                            onChange={e => setQty(a.id, c.ingredient, e.target.value)}
                                                            className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[10px] px-3 py-2 text-[16px] font-bold text-right tabular-nums text-text focus:outline-none focus:border-primary/50"
                                                        />
                                                        <span className="text-[13px] text-text-secondary">{c.unit}</span>
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                        <div className="mt-3 flex items-center gap-3">
                                            <p className={`flex-1 text-[14px] font-bold ${over > 0 ? 'text-danger' : 'text-success'}`}>
                                                {over > 0
                                                    ? `Chia nhiều hơn kho ${fmtQty(over, c.unit)}`
                                                    : `Đã chia ${fmtQty(c.total, c.unit)} · còn lại ${fmtQty(r1(c.pool - c.total), c.unit)}`}
                                            </p>
                                            {over > 0 && (
                                                <button type="button" onClick={() => setRestock({ ingredient: c.ingredient, qty: over })} className="shrink-0 px-3 py-1.5 rounded-[10px] bg-primary text-bg text-[13px] font-black">Nhập kho</button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                            {moreOptions.length > 0 && (
                                <Dropdown
                                    value="" align="left" triggerClassName="text-[14px] py-2 text-primary"
                                    triggerLabel="+ Thêm nguyên liệu khác"
                                    items={moreOptions.map(k => ({ value: k, label: ingredientLabel(k) }))}
                                    onChange={k => setAdded(a => [...a, k])}
                                />
                            )}
                        </>
                    )}
                </div>
            </main>

            {restock && (() => {
                const cfg = branches?.[0]?.ingredientsList.find(i => i.ingredient === restock.ingredient) // branches[0] = địa chỉ đang chọn
                return (
                    <RestockModal
                        ingredient={restock.ingredient}
                        unit={unitOf[restock.ingredient] || 'đv'}
                        packSize={cfg?.pack_size}
                        packUnit={cfg?.pack_unit}
                        pack2={pack2Of(cfg)}
                        initialQty={restock.qty}
                        cashClosedToday={cashClosedToday}
                        onClose={() => setRestock(null)}
                        onConfirm={async ({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }) => {
                            const wh = lookupByLabel(ing, pool, null)
                            const result = await processIngredientRestock(selectedAddress.id, ing, qty, profile?.name, {
                                subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
                                ...(wh != null ? { beforeStock: wh } : {}),
                            })
                            // Kho đổi → tươi lại số kho nhóm, giá vốn (context sản phẩm) và chi phí hôm nay.
                            await Promise.all([reload(), refreshProducts?.(), refreshTodayExpenses?.()])
                            return result
                        }}
                    />
                )
            })()}

            {ready && !locked && (
                <footer className="shrink-0 border-t border-border/60 bg-surface px-4 py-3">
                    <div className="max-w-xl mx-auto flex items-center gap-3">
                        <span className={`flex-1 text-[13px] ${failed ? 'text-danger font-bold' : 'text-text-secondary'}`}>
                            {failed ? 'Chưa lưu được' : saving || dirty ? 'Đang lưu…' : 'Đã tự lưu'}
                        </span>
                        <button type="button" onClick={finish} disabled={saving} className="px-5 py-2.5 rounded-[12px] bg-primary text-bg text-[15px] font-black disabled:opacity-40">Xong, gửi đi phát</button>
                    </div>
                </footer>
            )}
        </div>
    )
}
