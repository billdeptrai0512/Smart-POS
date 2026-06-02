import { formatVND, parseVNDInput } from '../../utils'
import { ingredientLabel } from '../../utils/ingredients'
import { isSameDayVN } from '../../utils/dateVN'
import { computeCashFlowTotals } from '../../utils/reportStats'

export default function CashFlowCard({
    actualCash = 0,
    actualTransfer = 0,
    dailyExpense = 0,
    refillFreeForm = 0,
    expenses = [],
    payments = [],   // NEW: expense_payments của ngày này (cash-out thực, theo paid_at)
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
    } = computeCashFlowTotals({ liveCash, liveTransfer, payments, shiftExpenses })

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
    const nvlGrouped = groupByInvoice(purchaseToday)
    const debtGrouped = groupByInvoice(debtRepayments).map(g => ({
        // Strip date suffix khỏi tên cho debt group? Giữ luôn để rõ ngày invoice gốc.
        ...g,
    }))

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

            {/* PANEL 2: CHI PHÍ PHÁT SINH */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">Thực chi</h3>
                <div className="flex flex-col gap-1 pl-1">
                    <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Trong ca</span>

                    {shiftExpenses.length > 0 ? (
                        shiftExpenses.map((e) => (
                            <div key={e.id} className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">· {e.name || 'Chi phí khác'}</span>
                                <span className="text-[13px] font-bold text-danger tabular-nums">-{formatVND(e.amount)}</span>
                            </div>
                        ))
                    ) : (
                        <span className="text-[12px] text-text-secondary italic">Không có chi phí trong ca</span>
                    )}
                </div>

                <div className="w-full h-[1px] bg-border/40 rounded-full my-3" />

                <div className="flex flex-col gap-1 pl-1">
                    <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Sau chốt ca</span>
                    {afterShiftOps.length > 0 ? (
                        afterShiftOps.map((e) => (
                            <div key={e.id} className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">· {e.name || 'Chi phí khác'}</span>
                                <span className="text-[13px] font-bold text-danger tabular-nums">-{formatVND(e.amount)}</span>
                            </div>
                        ))
                    ) : (
                        <span className="text-[12px] text-text-secondary italic">Không có chi phí sau ca</span>
                    )}
                </div>

                <div className="w-full h-[1px] bg-border/40 rounded-full my-3" />

                <div className="flex flex-col gap-1 pl-1">
                    <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Mua nguyên liệu / bao bì</span>
                    {nvlGrouped.length > 0 ? (
                        nvlGrouped.map((row) => (
                            <div key={row.key} className="flex justify-between items-center">
                                <span className="text-[12px] font-bold text-text-secondary">
                                    · {row.name}
                                    {row.count > 1 && (
                                        <span className="ml-1 text-text-dim font-medium">×{row.count}</span>
                                    )}
                                </span>
                                <span className="text-[13px] font-bold text-danger tabular-nums">-{formatVND(row.amount)}</span>
                            </div>
                        ))
                    ) : (
                        <span className="text-[12px] text-text-secondary italic">Không có đi chợ trong ngày</span>
                    )}
                </div>

                {debtGrouped.length > 0 && (
                    <>
                        <div className="w-full h-[1px] bg-border/40 rounded-full my-3" />
                        <div className="flex flex-col gap-1 pl-1">
                            <span className="text-[10px] font-black text-warning uppercase tracking-widest">Trả nợ cũ</span>
                            {debtGrouped.map((row) => (
                                <div key={row.key} className="flex justify-between items-center">
                                    <span className="text-[12px] font-bold text-text-secondary">
                                        · {row.name}
                                        {row.count > 1 && (
                                            <span className="ml-1 text-text-dim font-medium">×{row.count}</span>
                                        )}
                                    </span>
                                    <span className="text-[13px] font-bold text-danger tabular-nums">-{formatVND(row.amount)}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* PANEL 3: TỔNG CHI PHÍ */}
            <div className="w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
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
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(takeHomeCash)}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-[12px] font-bold text-text-secondary">Chuyển khoản thực tế:</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">
                            {formatVND(takeHomeTransfer)}
                        </span>
                    </div>
                </div>

                <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />

                <div className="flex justify-between items-center mt-1 pl-1">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Tổng thực nhận</span>
                    <span className="text-[16px] font-black text-success tabular-nums">
                        {formatVND(takeHome)}
                    </span>
                </div>
            </div>
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
