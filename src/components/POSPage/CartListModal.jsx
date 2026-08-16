import { X, Percent } from 'lucide-react'
import { formatVND, cartLineSubtotal, computeDiscount, NO_DISCOUNT } from '../../utils'
import { useDiscountEditing } from '../../hooks/useDiscountEditing'
import { Dialog } from '../common/ModalShell'
import DiscountEditor from './DiscountEditor'

// Giảm giá cho giỏ đang dựng (đợt chưa gửi) — mở từ nút % ở CheckoutBar. 1 dòng
// thì mở thẳng ô sửa của dòng đó; nhiều dòng thì liệt kê, bấm % ở dòng nào mở ô
// sửa ngay dưới dòng đó (không chồng modal lên modal).
export default function CartListModal({ cart, onClose, onItemDiscount }) {
    const { editingId, preview, setPreview, toggleEditing } = useDiscountEditing(cart.length === 1 ? cart[0].cartItemId : null)

    return (
        <Dialog onClose={onClose} panelClassName="w-full max-w-md mx-4 max-h-[85dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                <p className="text-text font-black text-base leading-none">Giảm giá</p>
                <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text rounded-lg hover:bg-surface-light">
                    <X size={16} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {cart.map(item => {
                    const subtotal = cartLineSubtotal(item)
                    const discount = item.discount || NO_DISCOUNT
                    const editing = editingId === item.cartItemId
                    // Dòng đang mở: hiện theo giá trị đang gõ/chọn (chưa xác nhận); các
                    // dòng khác vẫn hiện theo giảm giá đã áp.
                    const displayDiscount = editing && preview ? preview : discount
                    const { discountAmount, finalTotal } = computeDiscount(subtotal, displayDiscount)
                    const extrasLabel = (item.extras || []).map(e => e.name).join(', ')

                    return (
                        <div key={item.cartItemId} className="rounded-[14px] border border-border/40 bg-surface-light/40 overflow-hidden">
                            {/* Cả dòng là điểm bấm mở/đóng ô sửa — badge chỉ còn để ĐỌC (icon %
                                khi chưa giảm, "-X%"/"-Yđ" khi đã giảm), không phải nút riêng nữa. */}
                            <button
                                type="button"
                                onClick={() => toggleEditing(item.cartItemId)}
                                aria-label={`Giảm giá ${item.name}`}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left"
                            >
                                <div className="min-w-0 flex-1">
                                    <span className="block text-[13px] font-black text-text truncate">
                                        {item.quantity > 1 && <span className="tabular-nums text-text-secondary">{item.quantity} </span>}{item.name}
                                    </span>
                                    {extrasLabel && <span className="block text-[11px] font-medium text-text-secondary truncate">{extrasLabel}</span>}
                                </div>
                                <div className="shrink-0 flex flex-col items-end">
                                    {discountAmount > 0 && (
                                        <span className="text-[11px] font-bold text-text-secondary/60 line-through tabular-nums">{formatVND(subtotal)}</span>
                                    )}
                                    <span className="text-[13px] font-black tabular-nums text-text">{formatVND(finalTotal)}</span>
                                </div>
                                <span className={`shrink-0 h-[30px] min-w-[30px] px-2.5 rounded-[25px] border flex items-center justify-center transition-colors ${discountAmount > 0 ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface border-border/60 text-text-secondary'}`}>
                                    {discountAmount > 0
                                        ? <span className="text-[13px] font-black tabular-nums">-{displayDiscount.type === 'percent' ? `${displayDiscount.value}%` : formatVND(displayDiscount.value)}</span>
                                        : <Percent size={14} strokeWidth={2.5} />}
                                </span>
                            </button>

                            {editing && (
                                <div className="px-4 pb-4 pt-3 border-t border-border/40 space-y-3">
                                    <DiscountEditor
                                        discount={discount}
                                        onPreview={setPreview}
                                        secondaryLabel="Hủy"
                                        onSecondary={() => toggleEditing(item.cartItemId)}
                                        onApply={(d) => { onItemDiscount(item.cartItemId, d); toggleEditing(item.cartItemId) }}
                                    />
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </Dialog>
    )
}
