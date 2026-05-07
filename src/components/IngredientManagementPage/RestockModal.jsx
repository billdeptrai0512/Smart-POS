import { useState } from 'react'
import { X } from 'lucide-react'
import { ingredientLabel } from '../common/recipeUtils'

export default function RestockModal({ ingredient, unit, onConfirm, onClose }) {
    const [qty, setQty] = useState('')
    const [totalCost, setTotalCost] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const isValid = qty && Number(qty) > 0 && totalCost && Number(totalCost) > 0

    const handleSubmit = async () => {
        if (!isValid || submitting) return
        setSubmitting(true)
        try {
            await onConfirm({
                ingredient,
                qty: Number(qty),
                totalCost: Number(totalCost) * 1000 // Input is in thousands
            })
            onClose()
        } catch {
            // Error handled by parent
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

            {/* Modal content - slide up from bottom */}
            <div
                className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-5 animate-slide-up"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Nhập kho</span>
                        <span className="text-[18px] font-black text-text leading-tight">{ingredientLabel(ingredient)}</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Form */}
                <div className="flex flex-col gap-4">
                    {/* Quantity */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                            Số lượng nhập
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                autoFocus
                                placeholder="0"
                                value={qty}
                                onChange={e => setQty(e.target.value)}
                                className="flex-1 bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[16px] font-black text-text placeholder:text-text-secondary/30 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                            />
                            <span className="text-[14px] font-bold text-text-secondary shrink-0 w-12">{unit}</span>
                        </div>
                    </div>

                    {/* Total cost */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                            Tổng tiền thanh toán
                        </label>
                        <div className="relative flex items-center">
                            <input
                                type="number"
                                placeholder="0"
                                value={totalCost}
                                onChange={e => setTotalCost(e.target.value)}
                                className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[16px] font-black text-text placeholder:text-text-secondary/30 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                            />
                            {totalCost && (
                                <div className="absolute right-4 pointer-events-none">
                                    <span className="text-[14px] font-bold text-text-secondary">.000đ</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Preview đơn giá */}
                    {qty && Number(qty) > 0 && totalCost && Number(totalCost) > 0 && (
                        <div className="flex items-center justify-between px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-[12px]">
                            <span className="text-[12px] font-bold text-text-secondary">Đơn giá mới</span>
                            <span className="text-[14px] font-black text-primary tabular-nums">
                                {Math.round((Number(totalCost) * 1000) / Number(qty)).toLocaleString('vi-VN')}đ / {unit}
                            </span>
                        </div>
                    )}
                </div>

                {/* Submit */}
                <button
                    onClick={handleSubmit}
                    disabled={!isValid || submitting}
                    className="w-full py-3.5 rounded-[14px] bg-primary text-white text-[15px] font-black uppercase tracking-wide hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                >
                    {submitting ? 'Đang xử lý...' : 'Xác nhận nhập kho'}
                </button>
            </div>
        </div>
    )
}
