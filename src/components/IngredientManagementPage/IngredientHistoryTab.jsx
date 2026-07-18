import { ChevronLeft, ChevronRight, Trash2, Pencil } from 'lucide-react'
import { formatVND } from '../../utils'
import { formatPackedQty } from '../../utils/inventory'
import { dateShortVN, timeStringVN } from '../../utils/dateVN'

// Monthly restock log for one ingredient. Card layout mirrors /history's
// ExpenseCard so the eye scans the same shape across pages:
//   row 1 — hero qty (left) + cash impact (right)
//   row 2 — status / unit-price pills (sits behind a divider)
//   row 3 — "what happened" + staff (left) | date·time (right)
//
// Unpaid / partial cards are clickable → opens the payment sheet (parent owns
// the sheet via onOpenPayment). Adjustment rows are non-clickable (no $ owed).
export default function IngredientHistoryTab({
    loading, summary, history, unit,
    packSize, packUnit,
    monthLabel, monthOffset, onMonthChange,
    onOpenPayment, onCancelRestock, onEditRestock,
    addressNameById, // {id: name} — chỉ truyền khi địa chỉ thuộc 1 warehouse group (kho tổng chung)
}) {
    const hasOwing = summary.totalOwing > 0
    return (
        <>
            <MonthSummaryCard
                monthLabel={monthLabel}
                monthOffset={monthOffset}
                onMonthChange={onMonthChange}
                showStats={!loading && summary.count > 0}
                summary={summary}
                unit={unit}
                packSize={packSize}
                packUnit={packUnit}
                hasOwing={hasOwing}
            />

            {loading ? (
                <div className="flex flex-col gap-3 animate-pulse">
                    {[1, 2, 3].map(i => <div key={i} className="bg-surface-light rounded-[20px] h-24" />)}
                </div>
            ) : history.length === 0 ? (
                <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-[14px] border border-border/40">
                    Chưa có lịch sử nhập kho trong {monthLabel}.
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {history.map(entry => (
                        <HistoryCard
                            key={entry.id}
                            entry={entry}
                            unit={unit}
                            packSize={packSize}
                            packUnit={packUnit}
                            onOpenPayment={onOpenPayment}
                            onCancelRestock={onCancelRestock}
                            onEditRestock={onEditRestock}
                            addressName={addressNameById?.[entry.address_id]}
                        />
                    ))}
                </div>
            )}
        </>
    )
}

// ── Month nav + summary (one card) ────────────────────────────────────────────
// Nav row on top, stats below a divider. Stats keep p-4 so the left column lines
// up with the history card titles underneath. Hàng 2 (Đã trả | Còn nợ) chỉ khi có nợ.
function MonthSummaryCard({ monthLabel, monthOffset, onMonthChange, showStats, summary, unit, packSize, packUnit, hasOwing }) {
    return (
        <div className="bg-surface rounded-[16px] border border-border/60 overflow-hidden">
            <div className="flex items-center justify-between px-1.5 py-1.5">
                <button
                    onClick={() => onMonthChange(monthOffset - 1)}
                    className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all"
                >
                    <ChevronLeft size={18} />
                </button>
                <span className="text-[13px] font-black text-text capitalize">{monthLabel}</span>
                <button
                    onClick={() => onMonthChange(Math.min(0, monthOffset + 1))}
                    disabled={monthOffset >= 0}
                    className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all disabled:opacity-20"
                >
                    <ChevronRight size={18} />
                </button>
            </div>
            {showStats && (
                <>
                    <div className="h-[1px] bg-border/60" />
                    <div className="grid gap-3 grid-cols-2 p-4">
                        <Stat label="Số lượng nhập" value={formatPackedQty(summary.totalQty, packSize, packUnit, unit, { compact: true })} align="start" />
                        <Stat label="Tổng tiền nhập" value={formatVND(summary.totalSpent)} align="end" />
                        {hasOwing && (
                            <>
                                <Stat label="Đã trả" value={formatVND(summary.totalPaidInMonth)} tone="success" align="start" />
                                <Stat label="Còn nợ" value={formatVND(summary.totalOwing)} tone="warning" align="end" />
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}

function Stat({ label, value, tone, align = 'center' }) {
    const labelCls = tone === 'success' ? 'text-success'
        : tone === 'warning' ? 'text-warning'
        : 'text-text-secondary'
    const valueCls = tone === 'success' ? 'text-success'
        : tone === 'warning' ? 'text-warning'
        : tone === 'primary' ? 'text-primary'
        : 'text-text'
    return (
        <div className={`flex flex-col ${align === 'start' ? 'items-start' : align === 'end' ? 'items-end' : 'items-center'}`}>
            <span className={`text-[10px] font-black uppercase tracking-wider ${labelCls}`}>{label}</span>
            <span className={`text-[15px] font-black tabular-nums mt-1 ${valueCls}`}>{value}</span>
        </div>
    )
}

// ── History card ────────────────────────────────────────────────────────────
//
// Three live row types + a cancelled overlay (like a deleted order in /history):
//   • restock    — a purchase: qty + money + payment status + Hủy.
//   • adjustment — manual stock fix (amount 0): qty + "Hiệu chỉnh", no money. Cancellable.
//   • withdrawal — "Rút ra quầy": số "Nhập thêm" ghi trong phiếu chốt ca (kho → quầy,
//                  chuyển nội bộ). Không tiền, không pills, không Hủy (sửa ở báo cáo ca).
//   • cancelled  — restock/adjustment sau Hủy: zeroed in the DB (qty/amount 0) but the
//                  ORIGINAL numbers live in metadata.cancelled_qty/_amount, shown struck-
//                  through under a "ĐÃ HỦY" corner badge + grayscale. Not cancellable again.
//
// Layout: ĐÃ HỦY badge (if cancelled) · type tag + Hủy (corner) · hero qty + money ·
// Tồn X→Y · context pills (restock only) · staff + datetime above a hairline divider.
function HistoryCard({ entry, unit, packSize, packUnit, onOpenPayment, onCancelRestock, onEditRestock, addressName }) {
    const d = new Date(entry.created_at)
    const dateStr = dateShortVN(d)
    const timeStr = timeStringVN(d)

    const cancelled = !!entry.metadata?.cancelled
    const cancelledBy = entry.metadata?.cancelled_by
    const isWithdrawal = !!entry.is_withdrawal
    const isAdjust = !!entry.metadata?.adjustment
    const isRestock = !isAdjust && !isWithdrawal
    const isTransfer = entry.payment_method === 'transfer'

    // When cancelled the row is zeroed in the DB; display the ORIGINAL figures.
    const qty = cancelled ? (Number(entry.metadata?.cancelled_qty) || 0) : (entry.metadata?.qty || 0)
    const amount = cancelled ? (Number(entry.metadata?.cancelled_amount) || 0) : (entry.amount || 0)
    const unitPrice = qty > 0 && isRestock ? Math.round(amount / qty) : null

    // Hiệu chỉnh tồn ≥ 1 quy cách → ghi rõ quy đổi: "-2 hộp = -2568 ml". Dưới 1 quy cách
    // (hoặc không có quy cách) → giữ base unit. Phiếu nhập giữ hiển thị base như cũ.
    const ps = Number(packSize) || 0
    const showPackAdjust = isAdjust && ps > 0 && !!packUnit && Math.abs(qty) >= ps
    // Rút ra quầy là chuyển nội bộ — không dấu +/− (tổng tồn không đổi).
    const heroQty = isWithdrawal
        ? `${qty} ${unit}`
        : showPackAdjust
        ? `${qty > 0 ? '+' : ''}${formatPackedQty(qty, packSize, packUnit, unit, { compact: true })} = ${qty > 0 ? '+' : ''}${qty} ${unit}`
        : `${qty > 0 ? '+' : ''}${qty} ${unit}`

    const beforeStock = entry.metadata?.before_stock
    const afterStock = entry.metadata?.after_stock
    const hasSnapshot = Number.isFinite(beforeStock) && Number.isFinite(afterStock)

    // Payment status only meaningful on a live restock (cancelled rows have no payments left).
    const paid = (entry.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
    const owing = Math.max(0, amount - paid)
    const status = (!isRestock || cancelled) ? null
        : owing <= 0 ? 'paid'
        : paid <= 0 ? 'unpaid'
        : 'partial'
    const clickable = (status === 'unpaid' || status === 'partial') && !!onOpenPayment
    // Lượt rút sửa ở báo cáo ca (field Nhập thêm), không Hủy được từ Nhật ký.
    const cancellable = !!onCancelRestock && !cancelled && !isWithdrawal
    // Chỉ hiện nút Sửa cho restock thật (không phải adjustment/withdrawal/cancelled).
    const editable = !!onEditRestock && isRestock && !cancelled

    // Kho tổng dùng chung nhiều địa chỉ — withdrawal ghi rõ ĐIỂM ĐẾN (rút vào quầy nào), còn
    // lại (nhập/hiệu chỉnh) ghi NƠI ghi nhận. addressName chỉ có giá trị khi có nhóm (xem cha).
    const addressCaption = addressName ? (isWithdrawal ? `vào ${addressName}` : `tại ${addressName}`) : null

    const typeLabel = isWithdrawal ? 'Rút ra quầy' : isAdjust ? 'Hiệu chỉnh tồn' : 'Nhập kho'
    const typeTone = cancelled ? 'text-text-dim'
        : isWithdrawal ? 'text-text-secondary'
        : isAdjust ? 'text-warning' : 'text-primary'
    const qtyCls = cancelled ? 'text-text-dim line-through'
        : isWithdrawal ? 'text-text'
        : qty > 0 ? 'text-success' : qty < 0 ? 'text-danger' : 'text-text-dim'
    const moneyCls = cancelled ? 'text-text-dim line-through' : 'text-danger'

    const innerCls = `bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden transition-all ${
        cancelled ? 'opacity-50 grayscale select-none' : ''
    } ${clickable ? 'cursor-pointer hover:border-primary/40 active:scale-[0.99]' : ''}`

    const Body = (
        <>
            {/* Cancelled corner badge — same treatment as a deleted order. */}
            {cancelled && (
                <div className="absolute top-0 left-0 bg-danger/20 text-danger text-[10px] font-black px-3 py-1 rounded-br-[14px] uppercase tracking-wider z-10">
                    ĐÃ HỦY {cancelledBy ? `BỞI ${String(cancelledBy).toUpperCase()}` : ''}
                </div>
            )}

            {/* Row 0 — type tag (left) + cancel (corner). Pushed down a touch when the
                ĐÃ HỦY badge occupies the top-left. */}
            <div className={`flex items-center justify-between gap-2 -mt-0.5 ${cancelled ? 'mt-4' : ''}`}>
                <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className={`text-[11px] font-black uppercase tracking-wider ${typeTone}`}>
                        {typeLabel}
                    </span>
                    {addressCaption && (
                        <span className="text-[11px] font-medium text-text-dim truncate">{addressCaption}</span>
                    )}
                </span>
                {(editable || cancellable) && (
                    <div className="flex items-center gap-0.5 -mr-1 -mt-1">
                        {editable && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onEditRestock(entry) }}
                                aria-label="Sửa phiếu"
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-dim hover:text-primary hover:bg-primary/10 active:scale-95 transition-all"
                            >
                                <Pencil size={13} />
                            </button>
                        )}
                        {cancellable && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onCancelRestock(entry) }}
                                aria-label="Hủy phiếu"
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-text-dim hover:text-danger hover:bg-danger/10 active:scale-95 transition-all"
                            >
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Hero — qty delta (left) + money (right; restock only). */}
            <div className="flex justify-between items-baseline -mt-1">
                <span className={`text-[18px] font-black tabular-nums ${qtyCls}`}>
                    {heroQty}
                </span>
                {isRestock && (
                    <span className={`text-[14px] font-black tabular-nums ${moneyCls}`}>
                        -{formatVND(amount)}
                    </span>
                )}
            </div>

            {/* Tồn snapshot — "delta → resulting stock" in one downward scan. */}
            {hasSnapshot && (
                <div className="text-[11px] font-medium text-text-dim tabular-nums -mt-0.5">
                    Tồn kho <span className="text-text-secondary">{Math.round(beforeStock * 10) / 10}</span>
                    <span className="mx-1">→</span>
                    <span className="text-text font-bold">{Math.round(afterStock * 10) / 10}</span> {unit}
                </div>
            )}

            {/* Context pills — live restock only (payment status + unit price + method). */}
            {isRestock && !cancelled && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {status === 'paid' && <Pill tone="success">Đã trả</Pill>}
                    {status === 'partial' && (
                        <Pill tone="neutral">Trả 1 phần · {formatVND(paid)}/{formatVND(amount)}</Pill>
                    )}
                    {status === 'unpaid' && <Pill tone="warning">Còn nợ {formatVND(owing)}</Pill>}
                    {unitPrice != null && <Pill tone="neutral">{formatVND(unitPrice)}/{unit}</Pill>}
                    <Pill tone={isTransfer ? 'primary' : 'neutral'}>
                        {isTransfer ? 'Chuyển khoản' : 'Tiền mặt'}
                    </Pill>
                </div>
            )}

            {/* Footer — staff (left) + datetime (right), above a hairline divider. */}
            <div className="flex justify-between items-center gap-2 border-t border-border/40 pt-2 mt-0.5">
                <span className="text-[11px] font-bold text-text-secondary/70 truncate">
                    {entry.staff_name || '—'}
                </span>
                <span className="text-[12px] font-bold text-text-dim tabular-nums shrink-0">
                    {dateStr} · {timeStr}
                </span>
            </div>
        </>
    )

    // Clickable cards use div[role=button] (not <button>) so the corner cancel
    // <button> nests validly. Keyboard-activatable via Enter/Space.
    return clickable ? (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onOpenPayment(entry)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPayment(entry) } }}
            className={`text-left ${innerCls}`}
        >
            {Body}
        </div>
    ) : (
        <div className={innerCls}>{Body}</div>
    )
}

// Pill — local helper supporting the tone set this card uses. Same shape as
// /history Pill but expanded palette for status semantics.
function Pill({ tone, children }) {
    // Project palette has no separate "info" hue (warning ≡ primary literally),
    // so partial-status uses the neutral pill — clearly distinct from unpaid (amber).
    const cls = tone === 'success'
        ? 'bg-success/10 border-success/30 text-success'
        : tone === 'warning'
        ? 'bg-warning/10 border-warning/30 text-warning'
        : tone === 'primary'
        ? 'bg-primary/10 border-primary/30 text-primary'
        : 'bg-surface-light border-border/60 text-text-secondary'
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>
            {children}
        </span>
    )
}
