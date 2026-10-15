import type { ReactNode } from 'react'
import { ArrowRight, Trash2 } from 'lucide-react'
import { TIME_PILL, ROUND_ICON_BTN } from '../common/ModalShell'
import { formatVND } from '../../utils'
import { formatPackedQty } from '../../utils/inventory'
import { dateShortVN, timeStringVN } from '../../utils/dateVN'
import type { Pack2 } from '../../utils/inventory'
import type { Row } from '../../types/domain'

/** Tổng hợp khoảng ngày đang xem (IngredientDetailPage tính từ history). */
export interface RestockSummary { totalQty: number; totalSpent: number; totalOwing: number; totalPaidInMonth: number }

interface PackProps {
    unit: string
    packSize?: number | null
    packUnit?: string | null
    pack2?: Pack2 | null
}

interface Props extends PackProps {
    loading: boolean
    summary: RestockSummary
    history: Row[]
    rangeLabel: string
    onOpenPayment?: (entry: Row) => void
    onCancelRestock?: (entry: Row) => void
    onEditRestock?: (entry: Row) => void
    addressNameById?: Record<string, string> | null
}

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
    packSize, packUnit, pack2,
    rangeLabel,
    onOpenPayment, onCancelRestock, onEditRestock,
    addressNameById, // {id: name} — chỉ truyền khi địa chỉ thuộc 1 warehouse group (kho tổng chung)
}: Props) {
    return (
        <>
            <MonthSummaryCard showStats={!loading && history.length > 0} summary={summary} unit={unit} packSize={packSize} packUnit={packUnit} pack2={pack2} />

            {loading ? (
                <div className="flex flex-col gap-3 animate-pulse">
                    {[1, 2, 3].map(i => <div key={i} className="bg-surface-light rounded-[20px] h-24" />)}
                </div>
            ) : history.length === 0 ? (
                <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-[14px] border border-border/40">
                    Chưa có lịch sử nhập kho trong {rangeLabel}.
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
                            onEditRestock={onEditRestock}
                            addressName={addressNameById?.[entry.address_id]}
                        />
                    ))}
                </div>
            )}
        </>
    )
}

// ── Summary card ──────────────────────────────────────────────────────────────
// Hàng 1: Tổng tiền | Khối lượng. Hàng 2 (chỉ khi có nợ): Đã trả | Còn nợ.
function MonthSummaryCard({ showStats, summary, unit, packSize, packUnit, pack2 }: PackProps & { showStats: boolean; summary: RestockSummary }) {
    if (!showStats) return null
    return (
        <div className="bg-surface rounded-[16px] border border-border/60 overflow-hidden">
            <div className="grid gap-3 grid-cols-2 p-4">
                <Stat label="Tổng tiền" value={formatVND(summary.totalSpent)} align="start" />
                <Stat label="Khối lượng" value={formatPackedQty(summary.totalQty, packSize, packUnit, unit, { compact: true, pack2 })} align="end" />
                {summary.totalOwing > 0 && (
                    <>
                        <Stat label="Đã trả" value={formatVND(summary.totalPaidInMonth)} tone="success" align="start" />
                        <Stat label="Còn nợ" value={formatVND(summary.totalOwing)} tone="warning" align="end" />
                    </>
                )}
            </div>
        </div>
    )
}

// [màu nhãn, màu giá trị]
const STAT_TONE: Record<string, [string, string]> = {
    success: ['text-success', 'text-success'],
    warning: ['text-warning', 'text-warning'],
    primary: ['text-text-secondary', 'text-primary'],
}

function Stat({ label, value, tone, align = 'center' }: { label: string; value: string; tone?: 'success' | 'warning' | 'primary'; align?: 'start' | 'end' | 'center' }) {
    const [labelCls, valueCls] = STAT_TONE[tone ?? ''] ?? ['text-text-secondary', 'text-text']
    return (
        <div className={`flex flex-col ${align === 'start' ? 'items-start' : align === 'end' ? 'items-end' : 'items-center'}`}>
            <span className={`text-[11px] font-black uppercase tracking-wide ${labelCls}`}>{label}</span>
            <span className={`text-[18px] font-black tabular-nums mt-1 ${valueCls}`}>{value}</span>
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
// Layout: ĐÃ HỦY badge (if cancelled) · datetime (trái) | type tag + qty rút / money (phải) ·
// Tồn X→Y · footer: address + staff + context pills (restock only) + Hủy.
interface HistoryCardProps {
    unit: string
    entry: Row
    onOpenPayment?: (entry: Row) => void
    onCancelRestock?: (entry: Row) => void
    onEditRestock?: (entry: Row) => void
    addressName?: string
}

function HistoryCard({ entry, unit, onOpenPayment, onCancelRestock, onEditRestock, addressName }: HistoryCardProps) {
    const d = new Date(entry.created_at)
    const dateStr = dateShortVN(d)
    const timeStr = timeStringVN(d)

    const cancelled = !!entry.metadata?.cancelled
    const cancelledBy = entry.metadata?.cancelled_by
    const isWithdrawal = !!entry.is_withdrawal
    const isAdjust = !!entry.metadata?.adjustment
    const isRestock = !isAdjust && !isWithdrawal
    const isTransfer = entry.payment_method === 'transfer'
    const packedBy = entry.metadata?.packed_by as { packed_by_name: string | null; packed_at: string } | undefined

    // When cancelled the row is zeroed in the DB; display the ORIGINAL figures.
    const qty = cancelled ? (Number(entry.metadata?.cancelled_qty) || 0) : (entry.metadata?.qty || 0)
    const amount = cancelled ? (Number(entry.metadata?.cancelled_amount) || 0) : (entry.amount || 0)

    const beforeStock = entry.metadata?.before_stock
    const afterStock = entry.metadata?.after_stock
    const hasSnapshot = Number.isFinite(beforeStock) && Number.isFinite(afterStock)

    // Payment status only meaningful on a live restock (cancelled rows have no payments left).
    const paid = (entry.payments || []).reduce((s: number, p: Row) => s + (p.amount || 0), 0)
    const owing = Math.max(0, amount - paid)
    const status = (!isRestock || cancelled) ? null
        : owing <= 0 ? 'paid'
        : paid <= 0 ? 'unpaid'
        : 'partial'
    // Chỉ restock thật (không phải adjustment/withdrawal/cancelled) sửa được: bấm cả card → modal Sửa
    // (Hủy phiếu nằm trong modal đó). Pill nợ vẫn mở riêng sheet thanh toán.
    const editable = !!onEditRestock && isRestock && !cancelled
    const liveRestock = isRestock && !cancelled
    // Hiệu chỉnh tồn không có modal sửa → giữ nút Hủy trên card. Lượt rút sửa ở báo cáo ca (field Nhập thêm).
    const cancellable = !!onCancelRestock && !cancelled && isAdjust

    const typeLabel = isWithdrawal ? 'Rút ra quầy' : isAdjust ? 'Hiệu chỉnh tồn' : 'Nhập kho'
    const typeTone = cancelled ? 'text-text-dim'
        : isWithdrawal ? 'text-text-secondary'
        : isAdjust ? 'text-warning' : 'text-primary'
    // Màu số tồn SAU: tăng xanh / giảm đỏ (rút ra quầy là chuyển nội bộ → trung tính).
    const delta = hasSnapshot ? afterStock - beforeStock : qty
    const afterCls = cancelled ? 'text-text-dim line-through'
        : isWithdrawal ? 'text-text'
        : delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-text'
    const openPayment = onOpenPayment && (() => onOpenPayment(entry))
    // Pill phụ ở chân card nhỏ hơn pill ở đầu (22px vs 26px) để đầu card đọc trước.
    const TYPE_PILL = 'h-[26px] inline-flex items-center rounded-full bg-surface-light border border-border/60 px-2.5 text-[12px] font-bold leading-none whitespace-nowrap shrink-0'
    // Cụm header: 1 hàng khi card rộng, xếp dọc khi hẹp (container query).
    const CLUSTER = 'flex flex-col @[20rem]:flex-row @[20rem]:items-center gap-1.5'
    const META_PILL ='h-[22px] px-2 text-[11px] font-bold text-text-secondary/50 inline-flex items-center rounded-full bg-surface-light border border-border/60 leading-none whitespace-nowrap'

    const innerCls = `bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-3 relative overflow-hidden transition-all ${
        cancelled ? 'opacity-50 grayscale select-none' : ''
    } ${editable ? 'cursor-pointer hover:border-primary/40 active:scale-[0.99]' : ''}`

    // Cùng dáng card /history bán hàng: pills + số chính ở đầu · divider · thân · divider · pills + nút tròn.
    const Body = (
        <>
            {/* Cancelled corner badge — same treatment as a deleted order. */}
            {cancelled && (
                <div className="absolute top-0 left-0 bg-danger/20 text-danger text-[10px] font-black px-3 py-1 rounded-br-[14px] uppercase tracking-wider z-10">
                    ĐÃ HỦY {cancelledBy ? `BỞI ${String(cancelledBy).toUpperCase()}` : ''}
                </div>
            )}

            {/* Header — ngày giờ (trái) | loại + số lượng rút / tiền (phải). Hẹp (<20rem) → mỗi cụm xếp dọc. Đẩy xuống khi có badge ĐÃ HỦY. */}
            <div className={`@container flex items-start justify-between gap-2 ${cancelled ? 'mt-4' : ''}`}>
                <div className={`${CLUSTER} items-start`}>
                    <span className={`${TIME_PILL} tabular-nums`}>{dateStr}</span>
                    <span className={`${TIME_PILL} tabular-nums`}>{timeStr}</span>
                </div>
                <div className={`${CLUSTER} items-end`}>
                    <span className={`${TYPE_PILL} uppercase tracking-wide ${typeTone}`}>{typeLabel}</span>
                    {!isAdjust && delta !== 0 && (
                        <span className={`${TYPE_PILL} tabular-nums text-text`}>
                            {Math.round(Math.abs(delta) * 10) / 10} {unit}
                        </span>
                    )}
                </div>
            </div>

            <div className="h-[1px] bg-border/40" />

            {/* Thân — số chính của card: tồn kho trước (trái) → sau (phải). */}
            <div className="flex flex-col gap-1">
                <span className="text-[11px] font-black uppercase tracking-wide text-text-secondary">Tồn kho</span>
                {hasSnapshot ? (
                    <div className="flex justify-between items-baseline gap-2 text-[22px] font-black tabular-nums leading-tight">
                        <span className="font-bold text-text-secondary">{Math.round(beforeStock * 10) / 10}<span className="text-[12px] font-bold ml-1">{unit}</span></span>
                        <ArrowRight size={18} className="text-text-dim self-center shrink-0" />
                        <span className={afterCls}>{Math.round(afterStock * 10) / 10}<span className="text-[12px] font-bold ml-1 text-text-secondary">{unit}</span></span>
                    </div>
                ) : (
                    <span className={`text-[22px] font-black tabular-nums leading-tight ${afterCls}`}>{qty > 0 ? '+' : ''}{qty} {unit}</span>
                )}
                {/* Rút ra quầy: ai SOẠN (xác nhận ở "Soạn cho ngày mai" hôm trước) — người NHẬN là staff ở đầu card. */}
                {isWithdrawal && packedBy && (
                    <div className="text-[11px] font-medium text-text-secondary mt-1">
                        Soạn: <span className="font-bold text-text">{packedBy.packed_by_name || '—'}</span>
                        {' · '}{dateShortVN(new Date(packedBy.packed_at))} {timeStringVN(new Date(packedBy.packed_at))}
                    </div>
                )}
            </div>

            <div className="h-[1px] bg-border/40" />

            {/* Footer — địa chỉ · nhân viên (pills) + trạng thái trả / hình thức (phiếu nhập) | Hủy (hiệu chỉnh). */}
            <div className="flex justify-between items-center gap-2">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {addressName && <span className={`${META_PILL} max-w-full`}><span className="truncate">{addressName}</span></span>}
                    <span className={`${META_PILL} max-w-full`}><span className="truncate">{entry.staff_name || '—'}</span></span>
                    {liveRestock && (
                        <>
                            {status === 'partial' && (
                                <Pill tone="neutral" onClick={openPayment}>Trả 1 phần · {formatVND(paid)}/{formatVND(amount)}</Pill>
                            )}
                            {status === 'unpaid' && (
                                <Pill tone="warning" onClick={openPayment}>Còn nợ {formatVND(owing)}</Pill>
                            )}
                            <Pill tone={isTransfer ? 'primary' : 'neutral'}>{isTransfer ? 'Chuyển khoản' : 'Tiền mặt'}</Pill>
                        </>
                    )}
                </div>
                {cancellable && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onCancelRestock?.(entry) }}
                        aria-label="Hủy phiếu"
                        className={`${ROUND_ICON_BTN} text-text-dim hover:text-danger active:scale-95`}
                    >
                        <Trash2 size={13} />
                    </button>
                )}
            </div>
        </>
    )

    // Clickable cards use div[role=button] (not <button>) so the nested pill
    // <button> is valid. Keyboard-activatable via Enter/Space.
    return editable ? (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onEditRestock?.(entry)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEditRestock?.(entry) } }}
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
const PILL_TONE = {
    success: 'bg-success/10 border-success/30 text-success',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    primary: 'bg-primary/10 border-primary/30 text-primary',
    neutral: 'bg-surface-light border-border/60 text-text-secondary',
}

// onClick → pill là nút (dừng nổi bọt để không mở modal Sửa của card). Cao 22px khớp META_PILL.
function Pill({ tone, children, onClick }: { tone: 'success' | 'warning' | 'primary' | 'neutral'; children: ReactNode; onClick?: (() => void) | null }) {
    // Project palette has no separate "info" hue (warning ≡ primary literally),
    // so partial-status uses the neutral pill — clearly distinct from unpaid (amber).
    const cls = `inline-flex items-center h-[22px] px-2 rounded-full text-[11px] font-bold leading-none whitespace-nowrap border ${PILL_TONE[tone]}`
    return onClick
        ? <button type="button" onClick={(e) => { e.stopPropagation(); onClick() }} className={`${cls} active:scale-95 transition-transform`}>{children}</button>
        : <span className={cls}>{children}</span>
}
