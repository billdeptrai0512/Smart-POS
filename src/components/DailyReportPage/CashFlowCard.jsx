import { formatVND, parseVNDInput } from '../../utils'
import { ingredientLabel } from '../../utils/ingredients'

export default function CashFlowCard({
    actualCash = 0,
    actualTransfer = 0,
    dailyExpense = 0,
    refillNvl = 0,
    refillFreeForm = 0,
    expenses = [],
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

    // 1. Thực thu = Tiền mặt + Chuyển khoản + Chi phí phát sinh trong ca
    const actualTotal = liveCash + liveTransfer + (dailyExpense || 0)

    // 2. Tổng chi phí
    const totalExpenses = (dailyExpense || 0) + (refillFreeForm || 0) + (refillNvl || 0)

    // 3. Thực nhận (Cầm về thực) — trừ refill theo đúng pot đã chi.
    // Trước đây dùng refillTotal + fall-through (hết cash thì ăn transfer), khiến tổng
    // refill > revenue lập tức kéo cả 2 pot về 0. Bây giờ split theo payment_method nên
    // refill chuyển khoản chỉ trừ chuyển khoản, refill tiền mặt chỉ trừ tiền mặt.
    let cashRefill = 0, transferRefill = 0
    for (const e of expenses || []) {
        if (!e.is_refill) continue
        if (e.metadata?.adjustment) continue  // bookkeeping only, không phải cash-out
        if (e.payment_method === 'transfer') transferRefill += e.amount || 0
        else cashRefill += e.amount || 0  // default 'cash' when payment_method nullish
    }
    const takeHomeCash = Math.max(0, liveCash - cashRefill)
    const takeHomeTransfer = Math.max(0, liveTransfer - transferRefill)
    const takeHome = takeHomeCash + takeHomeTransfer

    // Phân loại chi phí — bỏ filter `!e.is_fixed` vì legacy fixed expenses
    // vẫn là cash-out thực, cần hiện trong dòng tiền.
    const shiftExpenses = (expenses || []).filter(e => !e.is_refill)
    const afterShiftOps = (expenses || []).filter(e => e.is_refill && e.metadata?.free_form)
    const afterShiftNvl = (expenses || []).filter(e => e.is_refill && !e.metadata?.free_form && !e.metadata?.adjustment)

    const getExpenseName = (e) => {
        if (e.is_refill && !e.metadata?.free_form && e.metadata?.ingredient) {
            return ingredientLabel(e.metadata.ingredient)
        }
        return e.name || 'Chi phí'
    }

    // Multiple refill bills can land on the same ingredient (e.g. 4 lần nhập Sữa đặc
    // trong ngày). Roll them up by display name so the cashflow line shows one row per
    // NVL with the total spent, instead of a wall of duplicate names.
    const afterShiftNvlGrouped = (() => {
        const byName = new Map()
        for (const e of afterShiftNvl) {
            const name = getExpenseName(e)
            const prev = byName.get(name)
            if (prev) {
                prev.amount += e.amount || 0
                prev.count += 1
            } else {
                byName.set(name, { name, amount: e.amount || 0, count: 1, key: e.id })
            }
        }
        return [...byName.values()]
    })()

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
                            {formatVND(dailyExpense || 0)}
                        </span>
                    </div>
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
                    <span className="text-[10px] font-black text-text-dim uppercase tracking-widest">Nguyên vật liệu</span>
                    {afterShiftNvlGrouped.length > 0 ? (
                        afterShiftNvlGrouped.map((row) => (
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
                        <span className="text-[12px] text-text-secondary italic">Không có nguyên vật liệu nhập kho</span>
                    )}
                </div>
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
