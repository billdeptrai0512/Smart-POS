import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Percent } from 'lucide-react'
import { formatVND, cartLineSubtotal, computeDiscount, NO_DISCOUNT } from '../../utils'
import { useDiscountEditing } from '../../hooks/useDiscountEditing'
import { Dialog } from '../common/ModalShell'
import DiscountEditor from './DiscountEditor'
import type { CartItem, Discount, UUID } from '../../types/domain'

// Ghi chú + giảm giá từng món và giảm giá CẢ ĐƠN (chip cạnh Tổng cộng, GHI ĐÈ giảm giá riêng từng món) cho giỏ đang dựng.
// Mở từ số Tổng ở CheckoutBar. 1 món thì không có chip cả đơn (trùng chip của chính món đó).
interface Props {
    cart: CartItem[]
    onClose: () => void
    onItemDiscount: (cartItemId: UUID, discount: Discount) => void
    onItemNote: (cartItemId: UUID, note: string | null) => void
    onConfirm: () => void
}

// Mức giảm dạng ngắn cho chip: 22.000đ → "22k" (chip chỉ rộng cỡ một cái nút).
const shortDiscount = (d: Discount) =>
    d.type === 'percent' ? `${d.value}%` : d.value % 1000 === 0 ? `${d.value / 1000}k` : formatVND(d.value)

const ALL = '__all__'

export default function CartListModal({ cart, onClose, onItemDiscount, onItemNote, onConfirm }: Props) {
    const { editingId, preview, setPreview, toggleEditing } = useDiscountEditing()
    const [noteEditingId, setNoteEditingId] = useState<string | null>(null)
    const [noteDraft, setNoteDraft] = useState('')

    // Esc đóng modal (bàn phím trên tablet/máy tính). Đang gõ ghi chú thì Esc chỉ rời ô (blur = lưu), Esc lần hai mới đóng —
    // đóng thẳng thì ghi chú đang gõ dở bị mất vì unmount không bắn blur.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
            else onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    const openNote = (item: CartItem) => { setNoteDraft(item.note || ''); setNoteEditingId(item.cartItemId) }
    const commitNote = (item: CartItem) => {
        const v = noteDraft.trim()
        if (v !== (item.note || '')) onItemNote(item.cartItemId, v)
        setNoteEditingId(null)
    }

    // Ô giảm giá đang mở (của dòng đó, hoặc cả đơn) thì dòng liên quan theo giá trị đang chọn (preview), còn lại theo giảm giá đã áp.
    const lines = cart.map(item => {
        const subtotal = cartLineSubtotal(item)
        const discount = preview && (editingId === ALL || editingId === item.cartItemId) ? preview : (item.discount || NO_DISCOUNT)
        return { item, subtotal, discount, ...computeDiscount(subtotal, discount) }
    })
    const allSubtotal = lines.reduce((s, l) => s + l.subtotal, 0)
    const allFinal = lines.reduce((s, l) => s + l.finalTotal, 0)
    const saved = allSubtotal - allFinal
    // Cả đơn: nếu mọi món đang cùng một mức giảm thì ô hiện đúng mức đó (sáng preset / có nút Bỏ) — mới gỡ được hàng loạt.
    const first = cart[0]?.discount || NO_DISCOUNT
    const allDiscount = cart.every(i => (i.discount?.type ?? first.type) === first.type && (i.discount?.value ?? 0) === first.value) ? first : NO_DISCOUNT

    return (
        <Dialog onClose={onClose} panelClassName="w-full max-w-md mx-4 max-h-[85%] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 pt-1">
                {/* Danh sách phẳng (không khung): chữ món và giá thẳng lề với Tổng cộng / Tạo đơn / preset bên dưới. */}
                <div className="divide-y divide-border/40">
                {lines.map(({ item, discount, discountAmount, finalTotal }) => {
                    const editing = editingId === item.cartItemId
                    const extrasLabel = (item.extras || []).map(e => e.name).join(', ')
                    return (
                        <div key={item.cartItemId} className="py-3.5">
                            {/* Hàng 1: tên (+ nút bút ghi chú ngay cạnh) | giá. Hàng 2 chỉ vẽ khi có tuỳ chọn hoặc ghi chú. */}
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 flex items-center gap-2">
                                    <span className="text-[15px] font-black text-text truncate">
                                        {item.quantity > 1 && <span className="tabular-nums text-text-secondary">{item.quantity} </span>}{item.name}
                                    </span>
                                    {/* Đã có ghi chú thì bỏ nút này: dòng "Ghi chú: …" bên dưới tự là chỗ chạm để sửa. */}
                                    {!item.note && (
                                        <button
                                            type="button"
                                            onClick={() => flushSync(() => openNote(item))}
                                            aria-label={`Ghi chú ${item.name}`}
                                            className="h-[26px] px-2.5 rounded-full border flex items-center shrink-0 transition-colors bg-surface-light border-border/70 text-[11px] font-bold text-text-secondary hover:text-text"
                                        >
                                            Ghi chú
                                        </button>
                                    )}
                                </div>
                                {/* Chip giảm giá nằm bên phải giá: chưa giảm = icon %, đã giảm = "-50%" (màu warning). */}
                                <div className="shrink-0 flex items-center gap-2.5">
                                    <span className="text-[15px] font-black tabular-nums text-text">{formatVND(finalTotal)}</span>
                                    <button
                                        type="button"
                                        onClick={() => flushSync(() => toggleEditing(item.cartItemId))}
                                        aria-label={`Giảm giá ${item.name}`}
                                        className={`h-[26px] min-w-[34px] px-2 text-[11px] rounded-full border flex items-center justify-center shrink-0 transition-colors ${discountAmount > 0 ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface-light border-border/70 text-text-secondary hover:text-text'}`}
                                    >
                                        {discountAmount > 0 ? <span className="font-black tabular-nums">-{shortDiscount(discount)}</span> : <Percent size={12} strokeWidth={2.5} />}
                                    </button>
                                </div>
                            </div>
                            {/* Tuỳ chọn và ghi chú mỗi thứ một dòng, cùng cỡ/line-height/tông xám, cách nhau một khoảng đều (gap-1);
                                ghi chú có nhãn chữ "Ghi chú:" thay vì icon. */}
                            {(extrasLabel || (item.note && noteEditingId !== item.cartItemId)) && (
                                <div className="mt-2 flex flex-col items-start gap-1 text-[13px] leading-snug text-text-secondary">
                                    {extrasLabel && <span className="max-w-full font-medium truncate">{extrasLabel}</span>}
                                    {item.note && noteEditingId !== item.cartItemId && (
                                        <button type="button" onClick={() => flushSync(() => openNote(item))} className="max-w-full text-left font-medium py-1 -my-1">
                                            <span className="font-bold">Ghi chú:</span> <span className="break-words">{item.note}</span>
                                        </button>
                                    )}
                                </div>
                            )}
                            {noteEditingId === item.cartItemId && (
                                <input
                                    autoFocus
                                    value={noteDraft}
                                    onChange={e => setNoteDraft(e.target.value)}
                                    onBlur={() => commitNote(item)}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur() }}
                                    placeholder="Ghi chú cho bếp"
                                    maxLength={200}
                                    aria-label={`Ghi chú ${item.name}`}
                                    enterKeyHint="done"
                                    className="mt-2.5 block w-full h-9 px-3 rounded-[10px] bg-bg border border-border/60 text-[13px] font-medium text-text placeholder:text-text-dim focus:outline-none focus:border-primary/40"
                                />
                            )}
                            {editing && (
                                <div className="pt-3 space-y-2">
                                    <DiscountEditor compact discount={item.discount || NO_DISCOUNT} onPreview={setPreview} onApply={d => onItemDiscount(item.cartItemId, d)} />
                                </div>
                            )}
                        </div>
                    )
                })}
                </div>
            </div>

            {/* Cùng bố cục thanh dưới ngoài POS: Tổng bên trái, Tạo đơn cố định bên phải. Không có nút Đóng —
                bấm ra ngoài modal là đóng. */}
            <div className="shrink-0 flex items-center gap-4 px-5 py-4 border-t border-border/60 bg-bg/40">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[11px] font-black uppercase tracking-wider text-text-secondary">Tổng cộng</span>
                        {cart.length > 1 && <button
                            type="button"
                            onClick={() => flushSync(() => toggleEditing(ALL))}
                            aria-label="Giảm giá cả đơn"
                            className={`h-[22px] px-2 text-[11px] gap-1.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${saved > 0 ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface-light border-border/70 text-text-secondary hover:text-text'}`}
                        >
                            {saved > 0
                                ? <span className="font-black tabular-nums">-{shortDiscount({ type: 'amount', value: saved })}</span>
                                : <Percent size={11} strokeWidth={2.5} />}
                        </button>}
                    </div>
                    <span className="block text-[20px] font-black text-text tabular-nums leading-none">{formatVND(allFinal)}</span>
                </div>
                <button
                    type="button"
                    onClick={onConfirm}
                    className="w-[112px] shrink-0 h-11 rounded-[12px] bg-primary text-bg text-[14px] font-black uppercase tracking-wider hover:bg-primary/90 active:bg-primary/80 transition-colors"
                >
                    Tạo đơn
                </button>
            </div>

            {/* Ô giảm giá mở từ chip % cạnh Tổng cộng — nằm dưới hàng Tổng cộng / Tạo đơn. */}
            {editingId === ALL && (
                <div className="shrink-0 px-5 pb-4 pt-3 space-y-2 border-t border-border/40 bg-bg/40">
                    <DiscountEditor compact discount={allDiscount} onPreview={setPreview} onApply={d => cart.forEach(item => onItemDiscount(item.cartItemId, d))} />
                </div>
            )}
        </Dialog>
    )
}
