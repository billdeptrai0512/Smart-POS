import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatVND, parseVNDInput } from '../../utils'
import { ingredientLabel, normalizeIngredientCategory, INGREDIENT_CATEGORIES } from '../../utils/ingredients'
import { isSameDayVN } from '../../utils/dateVN'
import { computeCashFlowTotals } from '../../utils/reportStats'
import { useProducts } from '../../contexts/ProductContext'

// Viết hoa chữ cái đầu ('đ' → 'Đ' được toUpperCase xử lý đúng cho tiếng Việt).
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
// "DD/MM" theo timestamp — dòng món trong panel Thực chi mở đầu bằng ngày.
const dayMonth = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    return isNaN(d) ? '' : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

export default function CashFlowCard({
    actualCash = 0,
    actualTransfer = 0,
    dailyExpense = 0,
    refillFreeForm = 0,
    expenses = [],
    payments = [],   // NEW: expense_payments của ngày này (cash-out thực, theo paid_at)
    expenseCategories = [],  // nhãn chi phí — nhóm section Vận hành theo tên nhãn
    onDailyExpenseClick,
    salesCard,
    // Inline-edit props (today scope on /daily-report). When `editable` is true the
    // Tiền mặt / Chuyển khoản rows become text inputs. The Lưu thực thu CTA itself
    // lives as a FAB on DailyReportPage so it shares position/style with Lưu báo cáo.
    editable = false,
    cashInput = '',
    transferInput = '',
    isSaving = false,
    onCashChange,
    onTransferChange,
}) {
    // Category (Nguyên liệu chính / Bao bì) của từng nguyên liệu — để phân loại
    // mục "Mua nguyên liệu / bao bì" bên dưới. Mặc định collapse từng nhóm.
    const { ingredientConfigs } = useProducts()
    const [expandedCats, setExpandedCats] = useState({})
    const toggleCat = (key) => setExpandedCats(prev => ({ ...prev, [key]: !prev[key] }))
    // When editing, totals/Thực nhận track the typed values so the user sees the impact
    // live before saving. Read-only mode falls back to the persisted (actualCash/Transfer) props.
    const liveCash = editable ? (parseVNDInput(cashInput) || 0) : actualCash
    const liveTransfer = editable ? (parseVNDInput(transferInput) || 0) : actualTransfer

    // Payments của ngày (đã filter theo paid_at bởi report RPC). Tách nhóm để HIỂN THỊ:
    //   nvlPayments      = đi chợ NVL (loại free_form)
    //   freeFormPayments = chi "sau chốt ca" free_form
    const nvlPayments = []
    const freeFormPayments = []
    for (const p of payments || []) {
        if (p.invoice_metadata?.adjustment) continue
        if (p.invoice_metadata?.free_form) freeFormPayments.push(p)
        else nvlPayments.push(p)
    }
    const refillNvlPaid = nvlPayments.reduce((s, p) => s + (p.amount || 0), 0)
    const refillFreeFormPaid = freeFormPayments.reduce((s, p) => s + (p.amount || 0), 0)

    // 2. Tổng chi phí — dùng số thực trả (paid_at-based), không tính nghĩa vụ chưa trả.
    const totalExpenses = (dailyExpense || 0) + (refillFreeForm || refillFreeFormPaid) + refillNvlPaid

    const shiftExpenses = (expenses || []).filter(e => !e.is_refill)
    const afterShiftOps = (expenses || []).filter(e => e.is_refill && e.metadata?.free_form)

    // 1. Thực thu / Thực nhận — phân loại tiền mặt theo cờ `cash_phase` lưu trên từng
    //    phiếu NVL (đặt lúc nhập kho): in_shift → cộng Thực thu (dựng lại doanh thu tiền
    //    mặt); sau chốt / phiếu cũ → trừ Thực nhận. Xem computeCashFlowTotals. CK luôn
    //    trừ Thực nhận, không cộng Thực thu.
    const {
        actualTotal, takeHomeCash, takeHomeTransfer, takeHome,
        inShiftRefillCash, inShiftOpsCash,
    } = computeCashFlowTotals({ liveCash, liveTransfer, payments, shiftExpenses, afterShiftExpenses: afterShiftOps })

    // Roll up NVL payments by ingredient/name, tách thành 2 nhóm:
    //   - todayPurchases: payment paid_at cùng ngày invoice (= đi chợ trả ngay/1 phần ngay)
    //   - debtRepayments: payment cho invoice tạo ngày khác (= trả nợ cũ)
    // Cần JOIN-supplied `invoice_metadata` để so sánh; nếu thiếu (orphan) thì coi như debt.
    // Map<expense_id, invoice.created_at> dựng từ expenses[] để bắt invoice cùng ngày của payments.
    const invoiceCreatedById = new Map(
        (expenses || []).filter(e => e.is_refill).map(e => [e.id, e.created_at])
    )
    // Bucket comparisons must use VN-tz dates — browser-local getFullYear/Month/Date
    // would flip the bucket near midnight UTC for any non-VN device.
    const groupByInvoice = (list) => {
        const byName = new Map()
        for (const p of list) {
            const ing = p.invoice_metadata?.ingredient
            const name = ing ? ingredientLabel(ing) : (p.invoice_name || 'Trả NCC')
            const invDate = invoiceCreatedById.get(p.expense_id)
            // Hiển thị ngày invoice cho debt repayments để user biết "trả nợ ngày nào".
            const display = (() => {
                if (!invDate) return name
                const d = new Date(invDate)
                return `${name} · ${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}`
            })()
            const prev = byName.get(display)
            if (prev) {
                prev.amount += p.amount || 0
                prev.count += 1
            } else {
                byName.set(display, { name: display, amount: p.amount || 0, count: 1, key: p.id })
            }
        }
        return [...byName.values()]
    }
    const purchaseToday = []
    const debtRepayments = []
    for (const p of nvlPayments) {
        const invCreated = invoiceCreatedById.get(p.expense_id)
        if (invCreated && isSameDayVN(invCreated, p.paid_at)) purchaseToday.push(p)
        else debtRepayments.push(p)
    }

    // Gộp đi chợ theo TÊN nguyên liệu, bỏ ngày (scope nhiều ngày tên lặp lại mỗi
    // ngày → 1 dòng/nguyên liệu ×số lần + tổng, sắp theo tổng giảm dần). Chi tiết
    // từng ngày xem ở Nhật ký của nguyên liệu đó.
    const groupByIngredient = (list) => {
        const byName = new Map()
        for (const p of list) {
            const ing = p.invoice_metadata?.ingredient
            const name = ing ? ingredientLabel(ing) : (p.invoice_name || 'Trả NCC')
            let g = byName.get(name)
            if (!g) { g = { name, key: p.id, amount: 0, count: 0 }; byName.set(name, g) }
            g.amount += p.amount || 0
            g.count += 1
        }
        return [...byName.values()].sort((a, b) => b.amount - a.amount)
    }
    // ── Section VẬN HÀNH — chi phí (trong ca + sau chốt ca) nhóm theo TÊN nhãn
    // chi phí. category_id thiếu / nhãn đã xoá → rơi về "Chi phí khác". Mỗi nhãn
    // là 1 dòng collapse; expand ra list phẳng, món sau chốt ca mang pill "Sau ca".
    const catById = new Map((expenseCategories || []).map(c => [c.id, c]))
    const opsGroups = (() => {
        const map = new Map()
        const add = (e, phase) => {
            const cat = catById.get(e.category_id)
            const label = cat?.name || 'Chi phí khác'
            const sortKey = cat ? (cat.sort_order ?? 100) : 999
            let g = map.get(label)
            if (!g) { g = { label, sortKey, inShift: [], postClose: [], total: 0 }; map.set(label, g) }
            g[phase].push(e)
            g.total += e.amount || 0
            g.sortKey = Math.min(g.sortKey, sortKey)
        }
        for (const e of shiftExpenses) add(e, 'inShift')
        for (const e of afterShiftOps) add(e, 'postClose')
        return [...map.values()].sort((a, b) => a.sortKey - b.sortKey || a.label.localeCompare(b.label, 'vi'))
    })()
    const opsTotal = opsGroups.reduce((s, g) => s + g.total, 0)

    // ── Section TỒN KHO — đi chợ hôm nay phân theo nhóm nguyên liệu (main /
    // packaging; payment không có ingredient key rơi về 'main' — cùng default với
    // normalizeIngredientCategory) + dòng Trả nợ cũ. Nhóm rỗng không hiển thị.
    const catByKey = new Map(
        (ingredientConfigs || []).map(c => [c.ingredient, normalizeIngredientCategory(c.category)])
    )
    const nvlGroups = INGREDIENT_CATEGORIES.map(cat => {
        const pays = purchaseToday.filter(p =>
            (catByKey.get(p.invoice_metadata?.ingredient) || 'main') === cat.key
        )
        return {
            key: cat.key,
            label: cat.key === 'packaging' ? 'Mua bao bì' : 'Mua nguyên liệu',
            rows: groupByIngredient(pays),
            count: pays.length,
            total: pays.reduce((s, p) => s + (p.amount || 0), 0),
        }
    }).filter(g => g.rows.length > 0)
    // Trả nợ cũ giữ nhóm theo hoá đơn (tên · ngày hoá đơn gốc) — ngày ở đây là
    // thông tin chính ("trả nợ ngày nào"), không gộp theo tên.
    const debtRows = groupByInvoice(debtRepayments)
    const inventoryGroups = [
        ...nvlGroups,
        ...(debtRows.length > 0 ? [{
            key: 'debt',
            label: 'Trả nợ cũ',
            rows: debtRows,
            count: debtRepayments.length,
            total: debtRepayments.reduce((s, p) => s + (p.amount || 0), 0),
        }] : []),
    ]
    const inventoryTotal = inventoryGroups.reduce((s, g) => s + g.total, 0)

    return (
        <div className="flex flex-col gap-4">
            {salesCard && <div className="w-full">{salesCard}</div>}

            {/* PANEL 1: THỰC THU */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Thực thu</h3>
                <div className="flex flex-col gap-2.5 pl-2">
                    {editable ? (
                        <>
                            <MoneyInputRow
                                label="Tiền mặt"
                                value={cashInput}
                                disabled={isSaving}
                                onChange={onCashChange}
                            />
                            <MoneyInputRow
                                label="Chuyển khoản"
                                value={transferInput}
                                disabled={isSaving}
                                onChange={onTransferChange}
                            />
                        </>
                    ) : (
                        <>
                            <div className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">Tiền mặt</span>
                                <span className="text-[13px] font-bold text-text tabular-nums">
                                    {formatVND(actualCash)}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">Chuyển khoản</span>
                                <span className="text-[13px] font-bold text-text tabular-nums">
                                    {formatVND(actualTransfer)}
                                </span>
                            </div>
                        </>
                    )}
                    <div
                        onClick={onDailyExpenseClick}
                        className="flex justify-between items-center cursor-pointer hover:opacity-85 active:scale-[0.99] transition-all"
                    >
                        <span className="text-[12px] font-bold text-text-secondary decoration-text-secondary/50 underline-offset-2">
                            Chi trong ca
                        </span>
                        <span className="text-[13px] font-bold text-warning tabular-nums">
                            {formatVND(inShiftOpsCash)}
                        </span>
                    </div>
                    {/* NVL/đi chợ trả tiền mặt TRƯỚC chốt cũng là tiền rút từ két trong ca →
                        cộng vào Thực thu. Hiện riêng để tổng nhìn ra được phần cộng lại. */}
                    {inShiftRefillCash > 0 && (
                        <div className="flex justify-between items-center">
                            <span className="text-[12px] font-bold text-text-secondary">Mua NVL trong ca</span>
                            <span className="text-[13px] font-bold text-warning tabular-nums">
                                {formatVND(inShiftRefillCash)}
                            </span>
                        </div>
                    )}
                </div>
                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng thực thu</span>
                    <span className="text-[13px] font-black text-success tabular-nums">
                        {formatVND(actualTotal)}
                    </span>
                </div>
            </div>

            {/* PANEL 2: THỰC CHI — 2 section (Vận hành / Tồn kho), mỗi section là
                các dòng nhãn collapse; Tổng thực chi nằm cuối CÙNG PANEL (cùng kiểu
                panel Thực nhận). Phân cấp cỡ chữ to dần từ trong ra ngoài:
                món 11px medium → nhãn 12px bold → tổng section 13px black →
                Tổng thực chi 14px black. */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Thực chi</h3>

                {/* SECTION: VẬN HÀNH */}
                <div className="flex flex-col gap-1 pl-1">
                    <div className="flex justify-between items-center">
                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest">Vận hành</span>
                        {opsGroups.length > 0 && (
                            <span className="text-[13px] font-black text-danger tabular-nums">-{formatVND(opsTotal)}</span>
                        )}
                    </div>
                    {opsGroups.length > 0 ? (
                        opsGroups.map((g) => (
                            <CollapseGroup
                                key={`op:${g.label}`}
                                expanded={!!expandedCats[`op:${g.label}`]}
                                onToggle={() => toggleCat(`op:${g.label}`)}
                                label={g.label}
                                count={g.inShift.length + g.postClose.length}
                                total={g.total}
                            >
                                {/* List phẳng `ngày · thời điểm · tên`: trong ca trước (mặc định,
                                    không pill), sau chốt ca sau với pill "Sau ca" giữa ngày và tên. */}
                                {g.inShift.map((e) => (
                                    <ItemRow key={e.id} date={dayMonth(e.created_at)} name={capFirst(e.name || 'Chi phí khác')} amount={e.amount} />
                                ))}
                                {g.postClose.map((e) => (
                                    <ItemRow key={e.id} date={dayMonth(e.created_at)} name={capFirst(e.name || 'Chi phí khác')} amount={e.amount} afterClose />
                                ))}
                            </CollapseGroup>
                        ))
                    ) : (
                        <span className="text-[12px] text-text-secondary italic">Không có chi phí vận hành</span>
                    )}
                </div>

                <div className="w-full h-[1px] bg-border/40 rounded-full my-3" />

                {/* SECTION: TỒN KHO */}
                <div className="flex flex-col gap-1 pl-1">
                    <div className="flex justify-between items-center">
                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest">Tồn kho</span>
                        {inventoryGroups.length > 0 && (
                            <span className="text-[13px] font-black text-danger tabular-nums">-{formatVND(inventoryTotal)}</span>
                        )}
                    </div>
                    {inventoryGroups.length > 0 ? (
                        inventoryGroups.map((g) => (
                            <CollapseGroup
                                key={g.key}
                                expanded={!!expandedCats[g.key]}
                                onToggle={() => toggleCat(g.key)}
                                label={g.label}
                                count={g.count}
                                total={g.total}
                            >
                                {/* Trả nợ cũ: tên kèm ngày hoá đơn gốc. Mua NVL/bao bì:
                                    1 dòng/nguyên liệu ×số lần, không ngày. */}
                                {g.rows.map((row) => (
                                    <ItemRow key={row.key} name={row.name} amount={row.amount} count={row.count} />
                                ))}
                            </CollapseGroup>
                        ))
                    ) : (
                        <span className="text-[12px] text-text-secondary italic">Không có đi chợ trong ngày</span>
                    )}
                </div>

                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />

                {/* TỔNG THỰC CHI — cùng panel, cùng kiểu với Tổng thực nhận. */}
                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng thực chi</span>
                    <span className="text-[14px] font-black text-danger tabular-nums">
                        -{formatVND(totalExpenses)}
                    </span>
                </div>
            </div>

            {/* PANEL 4: THỰC NHẬN */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Thực nhận</h3>
                <div className="flex flex-col gap-2.5 pl-2">
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">Tiền mặt thực tế:</span>
                        <span className={`text-[13px] font-bold tabular-nums ${takeHomeCash < 0 ? 'text-danger' : 'text-text'}`}>
                            {formatVND(takeHomeCash)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">Chuyển khoản thực tế:</span>
                        <span className={`text-[13px] font-bold tabular-nums ${takeHomeTransfer < 0 ? 'text-danger' : 'text-text'}`}>
                            {formatVND(takeHomeTransfer)}
                        </span>
                    </div>
                </div>

                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />

                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng thực nhận</span>
                    <span className={`text-[16px] font-black tabular-nums ${takeHome < 0 ? 'text-danger' : 'text-success'}`}>
                        {formatVND(takeHome)}
                    </span>
                </div>
            </div>
        </div>
    )
}

// Dòng nhãn collapse trong panel Thực chi — chevron + tên (số món) + tổng tiền,
// bấm để mở/đóng chi tiết (children). Cấp giữa của thang phân cấp: nhỏ hơn tổng
// section (13px black), to hơn món bên trong (11px medium).
function CollapseGroup({ expanded, onToggle, label, count, total, children }) {
    return (
        <div className="flex flex-col gap-1">
            <button
                type="button"
                onClick={onToggle}
                className="w-full flex justify-between items-center text-left hover:opacity-85 active:scale-[0.99] transition-all"
            >
                <span className="flex items-center gap-1 text-[12px] font-bold text-text-secondary">
                    {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {label}
                    <span className="text-text-dim font-medium">({count})</span>
                </span>
                <span className="text-[12px] font-bold text-danger tabular-nums">-{formatVND(total)}</span>
            </button>
            {expanded && children}
        </div>
    )
}

// Dòng món bên trong nhóm đã mở — cấp nhỏ nhất, thụt vào + nhạt hơn hàng nhãn.
// Thứ tự `ngày · thời điểm · tên`: `afterClose` → pill "Sau ca" chen giữa ngày
// và tên (trong ca là mặc định, không đánh dấu).
function ItemRow({ date, name, amount, count, afterClose = false }) {
    return (
        <div className="flex justify-between items-center gap-2 pl-4">
            <span className="text-[11px] font-medium text-text-secondary/90 min-w-0 truncate">
                ·{date && <span className="ml-1 text-text-dim tabular-nums">{date} ·</span>}
                {afterClose && (
                    <span className="ml-1.5 inline-flex items-center px-1.5 rounded-full text-[9px] font-bold border bg-warning/10 border-warning/30 text-warning align-[1px]">
                        Sau ca
                    </span>
                )}
                <span className="ml-1.5">{name}</span>
                {count > 1 && <span className="ml-1 text-text-dim">×{count}</span>}
            </span>
            <span className="text-[11px] font-medium text-danger/80 tabular-nums shrink-0">-{formatVND(amount)}</span>
        </div>
    )
}

function MoneyInputRow({ label, value, disabled, onChange }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-bold text-text-secondary shrink-0">{label}</span>
            <div className="relative flex items-center bg-surface-light border border-border/60 rounded-[10px] focus-within:border-primary/40 transition-colors overflow-hidden max-w-[180px] flex-1">
                <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={value}
                    onChange={e => onChange?.(e.target.value)}
                    disabled={disabled}
                    className="w-full bg-transparent px-2.5 py-1.5 text-right text-[13px] font-bold text-text tabular-nums placeholder:text-text-secondary/40 focus:outline-none disabled:opacity-50"
                />
                {value && (
                    <span className="text-[12px] font-bold text-text-secondary pr-2 shrink-0 pointer-events-none">đ</span>
                )}
            </div>
        </div>
    )
}
