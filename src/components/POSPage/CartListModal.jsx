import { useState } from 'react'
import { Percent } from 'lucide-react'
import { formatVND, cartLineSubtotal, computeDiscount, NO_DISCOUNT } from '../../utils'
import { useDiscountEditing } from '../../hooks/useDiscountEditing'
import { Dialog, ModalHeader } from '../common/ModalShell'
import DiscountEditor from './DiscountEditor'

// Giảm giá cho giỏ đang dựng (đợt chưa gửi) — mở từ nút % ở CheckoutBar.
// 1 món: mở thẳng ô sửa của dòng đó, không cần tab. Nhiều món: 2 tab —
// "Từng món" (sửa riêng từng dòng, hành vi cũ) và "Tất cả" (1 ô, áp cùng
// mức giảm cho mọi dòng cùng lúc — đỡ phải mở/sửa từng món khi muốn giảm
// đều cho cả bàn).
export default function CartListModal({ cart, onClose, onItemDiscount }) {
    const singleItem = cart.length === 1
    const [tab, setTab] = useState('each')
    const { editingId, preview, setPreview, toggleEditing } = useDiscountEditing(singleItem ? cart[0].cartItemId : null)
    const [allPreview, setAllPreview] = useState(NO_DISCOUNT)

    const applyToAll = (d) => {
        cart.forEach(item => onItemDiscount(item.cartItemId, d))
        onClose()
    }

    return (
        <Dialog onClose={onClose} panelClassName="w-full max-w-md mx-4 max-h-[85dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
            <ModalHeader title="Giảm giá" onClose={onClose} className="shrink-0" />

            {!singleItem && (
                <div className="flex gap-1.5 px-5 pt-4 shrink-0">
                    <button
                        type="button"
                        onClick={() => setTab('each')}
                        className={`flex-1 py-2 rounded-[10px] text-xs font-black uppercase tracking-wider transition-colors ${tab === 'each' ? 'bg-primary/10 text-primary' : 'bg-surface-light text-text-secondary hover:text-text'}`}
                    >
                        Từng món
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab('all')}
                        className={`flex-1 py-2 rounded-[10px] text-xs font-black uppercase tracking-wider transition-colors ${tab === 'all' ? 'bg-primary/10 text-primary' : 'bg-surface-light text-text-secondary hover:text-text'}`}
                    >
                        Tất cả
                    </button>
                </div>
            )}

            {(singleItem || tab === 'each') && (
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
            )}

            {!singleItem && tab === 'all' && (() => {
                // Tổng trước/sau — cùng mức giảm đang gõ áp cho MỖI món, để thấy ngay
                // tác động lên cả đơn trước khi bấm Đồng ý. 1 pass thay vì 3 reduce riêng.
                const { subtotal: allSubtotal, final: allFinal } = cart.reduce((acc, item) => {
                    const subtotal = cartLineSubtotal(item)
                    acc.subtotal += subtotal
                    acc.final += computeDiscount(subtotal, allPreview).finalTotal
                    return acc
                }, { subtotal: 0, final: 0 })

                return (
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                        <div className="rounded-[14px] border border-border/40 bg-surface-light/40 px-4 py-3 flex items-center justify-between">
                            <span className="text-[12px] font-bold text-text-secondary">{cart.length} món</span>
                            <div className="flex flex-col items-end">
                                {allFinal < allSubtotal && (
                                    <span className="text-[11px] font-bold text-text-secondary/60 line-through tabular-nums">{formatVND(allSubtotal)}</span>
                                )}
                                <span className="text-[15px] font-black tabular-nums text-text">{formatVND(allFinal)}</span>
                            </div>
                        </div>

                        <DiscountEditor
                            discount={NO_DISCOUNT}
                            onPreview={setAllPreview}
                            secondaryLabel="Hủy"
                            onSecondary={onClose}
                            onApply={applyToAll}
                        />
                    </div>
                )
            })()}
        </Dialog>
    )
}
