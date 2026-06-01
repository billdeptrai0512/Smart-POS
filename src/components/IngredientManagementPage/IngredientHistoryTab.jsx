import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { formatVND } from '../../utils'

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
    monthLabel, monthOffset, onMonthChange,
    onOpenPayment, onCancelRestock,
}) {
    const hasOwing = summary.totalOwing > 0
    return (
        <>
            <MonthNav monthLabel={monthLabel} monthOffset={monthOffset} onMonthChange={onMonthChange} />

            {!loading && summary.count > 0 && (
                <SummaryStrip summary={summary} unit={unit} hasOwing={hasOwing} />
            )}

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
                            onOpenPayment={onOpenPayment}
                            onCancelRestock={onCancelRestock}
                        />
                    ))}
                </div>
            )}
        </>
    )
}

// ── Month nav ───────────────────────────────────────────────────────────────
function MonthNav({ monthLabel, monthOffset, onMonthChange }) {
    return (
        <div className="flex items-center justify-between bg-surface-light rounded-[12px] px-1 py-1">
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
    )
}

// ── Summary strip ───────────────────────────────────────────────────────────
function SummaryStrip({ summary, unit, hasOwing }) {
    // Grid 2×2 khi có nợ (gọn trên mobile), 1×3 khi không nợ.
    // "Tiền nhập" = nghĩa vụ phát sinh trong tháng (theo created_at).
    // "Đã trả" = cash-out NVL trong tháng (theo paid_at, có thể trả cho invoice tháng khác).
    return (
        <div className={`bg-surface rounded-[16px] border border-border/60 p-4 grid gap-3 ${hasOwing ? 'grid-cols-2' : 'grid-cols-3'}`}>
            <Stat label="Tiền nhập" value={formatVND(summary.totalSpent)} />
            <Stat label="Lượng nhập" value={`${summary.totalQty} ${unit}`} />
            {!hasOwing ? (
                <Stat label="TB/đơn vị" value={formatVND(summary.avgPrice)} tone="primary" />
            ) : (
                <>
                    <Stat label="Đã trả" value={formatVND(summary.totalPaidInMonth)} tone="success" />
                    <Stat label="Còn nợ" value={formatVND(summary.totalOwing)} tone="warning" />
                </>
            )}
        </div>
    )
}

function Stat({ label, value, tone }) {
    const labelCls = tone === 'success' ? 'text-success'
        : tone === 'warning' ? 'text-warning'
        : 'text-text-secondary'
    const valueCls = tone === 'success' ? 'text-success'
        : tone === 'warning' ? 'text-warning'
        : tone === 'primary' ? 'text-primary'
        : 'text-text'
    return (
        <div className="flex flex-col items-center">
            <span className={`text-[10px] font-black uppercase tracking-wider ${labelCls}`}>{label}</span>
            <span className={`text-[15px] font-black tabular-nums mt-1 ${valueCls}`}>{value}</span>
        </div>
    )
}

// ── History card ────────────────────────────────────────────────────────────
//
// Three row types share one card, distinguished by metadata:
//   • restock      — a purchase: qty + money + payment status + Hủy.
//   • adjustment   — manual stock fix (amount 0): qty + "Hiệu chỉnh", no money. Cancellable.
//   • cancel marker— the audit row a cancel leaves behind (cancel_restock=true): muted,
//                    qty 0, no money, NOT cancellable.
//
// Layout (top → bottom): type tag + Hủy (corner) · hero qty + money · Tồn X→Y ·
// context pills (restock only) · staff + datetime. One divider only, above the meta.
function HistoryCard({ entry, unit, onOpenPayment, onCancelRestock }) {
    const d = new Date(entry.created_at)
    // Hardcode dd/mm — Chromium's vi-VN renders "27 - 05" with literal spaces.
    const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

    const qty = entry.metadata?.qty || 0
    const isCancelMarker = !!entry.metadata?.cancel_restock
    const isAdjust = !!entry.metadata?.adjustment && !isCancelMarker
    const isRestock = !entry.metadata?.adjustment
    const isTransfer = entry.payment_method === 'transfer'
    const unitPrice = qty > 0 && isRestock ? Math.round(entry.amount / qty) : null

    const beforeStock = entry.metadata?.before_stock
    const afterStock = entry.metadata?.after_stock
    const hasSnapshot = Number.isFinite(beforeStock) && Number.isFinite(afterStock)

    const paid = (entry.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
    const owing = Math.max(0, (entry.amount || 0) - paid)
    const status = !isRestock ? null
        : owing <= 0 ? 'paid'
        : paid <= 0 ? 'unpaid'
        : 'partial'
    const clickable = (status === 'unpaid' || status === 'partial') && !!onOpenPayment
    // Restocks and adjustments can be cancelled; the cancel-marker audit row cannot.
    const cancellable = !!onCancelRestock && !isCancelMarker

    const typeLabel = isCancelMarker ? 'Đã hủy' : isAdjust ? 'Hiệu chỉnh tồn' : 'Nhập kho'
    const typeTone = isCancelMarker ? 'text-text-dim' : isAdjust ? 'text-warning' : 'text-primary'
    const qtyCls = qty > 0 ? 'text-success' : qty < 0 ? 'text-danger' : 'text-text-dim'

    const innerCls = `bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 transition-all ${
        isCancelMarker ? 'opacity-70' : ''
    } ${clickable ? 'cursor-pointer hover:border-primary/40 active:scale-[0.99]' : ''}`

    const Body = (
        <>
            {/* Row 0 — type tag (left) + cancel (corner). */}
            <div className="flex items-center justify-between gap-2 -mt-0.5">
                <span className={`text-[11px] font-black uppercase tracking-wider ${typeTone}`}>
                    {typeLabel}
                </span>
                {cancellable && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onCancelRestock(entry) }}
                        aria-label="Hủy phiếu"
                        className="-mr-1 -mt-1 w-7 h-7 flex items-center justify-center rounded-lg text-text-dim hover:text-danger hover:bg-danger/10 active:scale-95 transition-all"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>

            {/* Hero — qty delta (left) + money (right; restock only). */}
            <div className="flex justify-between items-baseline -mt-1">
                <span className={`text-[18px] font-black tabular-nums ${qtyCls}`}>
                    {qty > 0 ? '+' : ''}{qty} {unit}
                </span>
                {isRestock && (
                    <span className="text-[14px] font-black tabular-nums text-danger">
                        -{formatVND(entry.amount)}
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

            {/* Context pills — restock only (payment status + unit price + method). */}
            {isRestock && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {status === 'paid' && <Pill tone="success">Đã trả</Pill>}
                    {status === 'partial' && (
                        <Pill tone="neutral">Trả 1 phần · {formatVND(paid)}/{formatVND(entry.amount)}</Pill>
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
