import { useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowUpRight } from 'lucide-react'
import { formatVND } from '../../utils'
import { onboardingHintClass } from '../../utils/onboardingHint'
import CartListModal from './CartListModal'
import type { CartItem, Discount, UUID } from '../../types/domain'

// Thanh chốt bàn: giỏ chỉ thành đơn khi bấm Tạo đơn ở đây.
// Giảm giá / Ghi chú từng món mở từ việc chạm vào số Tổng (CartListModal).
interface Props {
    discountAmount: number
    finalTotal: number
    cart: CartItem[]
    onItemDiscount: (cartItemId: UUID, discount: Discount) => void
    onItemNote: (cartItemId: UUID, note: string | null) => void
    tableName: string
    onConfirm: (discountAmount: number, tableName: string) => void
    disabled?: boolean
    showOnboardingHint?: boolean
    onPickTable?: () => void // không truyền = ẩn chip bàn (khách dùng thử)
}

export default function CheckoutBar({
    discountAmount, finalTotal,
    cart, onItemDiscount, onItemNote,
    tableName, onConfirm, disabled, showOnboardingHint = false, onPickTable,
}: Props) {
    const [showCart, setShowCart] = useState(false)

    return (
        <footer className="shrink-0 bg-surface border-t border-border/80 px-6 dine-split:px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] [@media(display-mode:standalone)]:pb-[max(env(safe-area-inset-bottom),28px)] shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1 flex flex-col items-start gap-0.5">
                    {/* Chữ "Mang đi" (hoặc tên bàn) thay nhãn "Tổng cộng", cùng kiểu chữ, chỉ thêm ⌄ báo bấm được = mở lưới bàn.
                        Khách dùng thử / dine-split (lưới bàn đã hiện sẵn bên cạnh) không có nút này → giữ nhãn "Tổng cộng". */}
                    {onPickTable && (
                        <button
                            type="button"
                            onClick={onPickTable}
                            // after: vùng chạm vô hình nới lên trên (hết mép thanh) và ra hai bên → cao ~36px, không đè lên số tiền bên dưới.
                            className="dine-split:hidden relative max-w-full h-6 flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-text-secondary after:absolute after:-top-3 after:-left-2 after:-right-3 after:bottom-0"
                        >
                            <span className="truncate">{tableName || 'Mang đi'}</span>
                            <ArrowUpRight size={14} strokeWidth={2.5} className="shrink-0" />
                        </button>
                    )}
                    <span className={`${onPickTable ? 'hidden dine-split:block' : ''} h-6 leading-6 text-[11px] font-black uppercase tracking-wide text-text-secondary`}>Tổng cộng</span>
                    <button
                        type="button"
                        onClick={() => flushSync(() => setShowCart(true))}
                        disabled={disabled}
                        aria-label="Tổng cộng — giảm giá và ghi chú"
                        className="text-left disabled:cursor-not-allowed"
                    >
                        {/* Gạch chân đứt (cùng kiểu ngày ở Nhật ký) báo bấm được = mở giảm giá / ghi chú. */}
                        <span className={`text-[20px] font-black text-text tabular-nums leading-none ${disabled ? '' : 'underline decoration-dashed decoration-primary/40 underline-offset-4'}`}>{formatVND(finalTotal)}</span>
                    </button>
                </div>
                <button
                    onClick={() => onConfirm(discountAmount, tableName)}
                    disabled={disabled}
                    className={`w-[45%] min-w-[132px] max-w-[192px] shrink-0 h-11 rounded-[12px] bg-primary text-bg text-[14px] font-black uppercase tracking-wider hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${onboardingHintClass(showOnboardingHint, 'solid')}`}
                >
                    Tạo đơn
                </button>
            </div>

            {showCart && (
                <CartListModal cart={cart} onClose={() => setShowCart(false)} onItemDiscount={onItemDiscount} onItemNote={onItemNote} onConfirm={() => { onConfirm(discountAmount, tableName); setShowCart(false) }} />
            )}
        </footer>
    )
}
