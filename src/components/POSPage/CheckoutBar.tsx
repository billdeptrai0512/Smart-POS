import { useState } from 'react'
import { flushSync } from 'react-dom'
import { ChevronUp } from 'lucide-react'
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
}

export default function CheckoutBar({
    discountAmount, finalTotal,
    cart, onItemDiscount, onItemNote,
    tableName, onConfirm, disabled, showOnboardingHint = false,
}: Props) {
    const [showCart, setShowCart] = useState(false)

    return (
        <footer className="shrink-0 bg-surface border-t border-border/80 px-6 dine-split:px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] [@media(display-mode:standalone)]:pb-[max(env(safe-area-inset-bottom),28px)] shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-4">
                <button
                    type="button"
                    onClick={() => flushSync(() => setShowCart(true))}
                    disabled={disabled}
                    aria-label="Giảm giá và ghi chú"
                    className="min-w-0 flex-1 flex flex-col gap-0.5 text-left disabled:cursor-not-allowed"
                >
                    {/* Cùng khuôn với chân modal giỏ: nhãn "TỔNG CỘNG" trên, số tiền dưới. */}
                    <span className="text-[11px] font-black uppercase tracking-wide text-text-secondary">Tổng cộng</span>
                    <span className="flex items-center gap-1.5">
                        <span className="text-[20px] font-black text-text tabular-nums leading-none">{formatVND(finalTotal)}</span>
                        {!disabled && <ChevronUp size={14} strokeWidth={3} className="text-text-secondary" />}
                    </span>
                </button>
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
