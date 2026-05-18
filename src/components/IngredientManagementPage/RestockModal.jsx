import { useState } from 'react'
import { X } from 'lucide-react'
import { ingredientLabel } from '../common/recipeUtils'

export default function RestockModal({ ingredient, unit, packSize, packUnit, onConfirm, onClose }) {
    const hasPack = !!(packSize && packUnit)
    const [usePackMode, setUsePackMode] = useState(hasPack)
    const [qty, setQty] = useState('')
    const [totalCost, setTotalCost] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const activeUnit = usePackMode ? packUnit : unit
    const actualQty = usePackMode ? Number(qty) * packSize : Number(qty)

    const isValid = qty && Number(qty) > 0 && totalCost && Number(totalCost) > 0

    const handleSubmit = async () => {
        if (!isValid || submitting) return
        setSubmitting(true)
        try {
            await onConfirm({
                ingredient,
                qty: actualQty,
                totalCost: Number(totalCost) * 1000
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
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

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

                {/* Single-inflow reminder — this modal is the only legit way to add to kho tổng */}
                <p className="text-[11px] text-text-secondary leading-snug bg-primary/5 border border-primary/15 rounded-[10px] px-3 py-2">
                    Mọi nguyên liệu mua về <span className="font-bold text-text">phải nhập qua đây</span> để kho tổng khớp sổ.
                    Đừng để hàng thẳng lên quầy không qua hệ thống.
                </p>

                {/* Form */}
                <div className="flex flex-col gap-4">
                    {/* Quantity */}
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                                Số lượng nhập
                            </label>
                            {hasPack && (
                                <div className="flex items-center gap-1 bg-surface-light border border-border/60 rounded-lg p-0.5">
                                    <button
                                        onClick={() => setUsePackMode(true)}
                                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-all ${usePackMode ? 'bg-primary text-white' : 'text-text-secondary hover:text-text'}`}
                                    >
                                        {packUnit}
                                    </button>
                                    <button
                                        onClick={() => setUsePackMode(false)}
                                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-all ${!usePackMode ? 'bg-primary text-white' : 'text-text-secondary hover:text-text'}`}
                                    >
                                        {unit}
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="relative flex items-center">
                            <input
                                type="number"
                                autoFocus
                                placeholder="0"
                                value={qty}
                                onChange={e => setQty(e.target.value)}
                                className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 pr-16 text-[16px] font-black text-text placeholder:text-text-secondary/30 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                            />
                            <div className="absolute right-4 pointer-events-none flex flex-col items-end">
                                <span className="text-[14px] font-bold text-text-secondary">{activeUnit}</span>
                                {usePackMode && qty && Number(qty) > 0 && (
                                    <span className="text-[10px] text-text-dim tabular-nums leading-none">={actualQty}{unit}</span>
                                )}
                            </div>
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

                    {/* Preview */}
                    {qty && Number(qty) > 0 && totalCost && Number(totalCost) > 0 && (
                        <div className="flex items-center justify-between px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-[12px]">
                            <span className="text-[12px] font-bold text-text-secondary">Đơn giá mới</span>
                            <span className="text-[14px] font-black text-primary tabular-nums">
                                {Math.round((Number(totalCost) * 1000) / actualQty).toLocaleString('vi-VN')}đ / {unit}
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
