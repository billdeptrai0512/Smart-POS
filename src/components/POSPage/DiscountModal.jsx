import { useState, useEffect } from 'react'
import { X, BadgePercent } from 'lucide-react'
import { formatVND, formatVNDInput, parseVNDInput, computeDiscount } from '../../utils'
import { Dialog } from '../common/ModalShell'

const PERCENT_PRESETS = [25, 50, 100]
const AMOUNT_PRESETS = [10000, 20000, 50000]

// Per-order discount picker. Centered popup; does not alter the cart, only the
// final total written on confirm. Supports % or fixed-amount (đ).
export default function DiscountModal({ open, onClose, subtotal, discount, onApply }) {
    const [type, setType] = useState('percent')
    const [input, setInput] = useState('')

    // Seed local form state from the active discount each time the modal opens.
    // Intentional state-sync on the `open` edge — not a cascading-render hazard.
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (!open) return
        const t = discount.value ? discount.type : 'percent'
        setType(t)
        setInput(!discount.value ? '' : t === 'amount' ? formatVNDInput(discount.value) : String(discount.value))
    }, [open, discount])
    /* eslint-enable react-hooks/set-state-in-effect */

    if (!open) return null

    const rawValue = type === 'amount' ? parseVNDInput(input) : (parseInt(input, 10) || 0)
    const { discountAmount, finalTotal } = computeDiscount(subtotal, { type, value: rawValue })
    const presets = type === 'percent' ? PERCENT_PRESETS : AMOUNT_PRESETS

    function switchType(next) {
        if (next === type) return
        setType(next)
        setInput('')
    }

    function handleInput(raw) {
        if (type === 'amount') return setInput(formatVNDInput(raw))
        // Percent: digits only, clamp to 100
        const digits = raw.replace(/[^\d]/g, '')
        if (!digits) return setInput('')
        setInput(String(Math.min(parseInt(digits, 10), 100)))
    }

    function handleApply() {
        onApply({ type, value: type === 'percent' ? Math.min(rawValue, 100) : rawValue })
        onClose()
    }

    function handleClear() {
        onApply({ type, value: 0 })
        onClose()
    }

    return (
        <Dialog onClose={onClose} panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center">
                            <BadgePercent size={15} className="text-primary" />
                        </div>
                        <p className="text-text font-black text-base leading-none">Giảm giá</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text rounded-lg hover:bg-surface-light">
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-5 py-4 space-y-4">
                    {/* Value input + type toggle */}
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1 flex items-center h-12 bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                            <input
                                type="text"
                                inputMode="numeric"
                                value={input}
                                onChange={e => handleInput(e.target.value)}
                                placeholder="0"
                                className="w-full h-full bg-transparent px-3 text-right font-bold text-text tabular-nums text-lg placeholder:text-text-secondary/40 focus:outline-none"
                            />
                            <span className="text-[13px] font-bold text-text-secondary pr-3 shrink-0 pointer-events-none">{type === 'percent' ? '%' : 'đ'}</span>
                        </div>
                        <div className="flex h-12 bg-surface-light rounded-[12px] p-1 border border-border/60 shrink-0">
                            {[['percent', '%'], ['amount', 'đ']].map(([t, label]) => (
                                <button
                                    key={t}
                                    onClick={() => switchType(t)}
                                    className={`w-10 h-full flex items-center justify-center rounded-[9px] font-black text-sm transition-colors ${type === t ? 'bg-primary text-black' : 'text-text-secondary hover:text-text'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Quick presets — values depend on mode (% vs đ) */}
                    <div className="grid grid-cols-3 gap-2">
                        {presets.map(p => {
                            const active = rawValue === p
                            return (
                                <button
                                    key={p}
                                    onClick={() => handleInput(String(p))}
                                    className={`py-2 rounded-[10px] border font-bold text-[13px] tabular-nums transition-colors ${active ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-bg border-border/60 text-text-secondary hover:text-text'}`}
                                >
                                    {type === 'percent' ? `${p}%` : formatVND(p)}
                                </button>
                            )
                        })}
                    </div>

                    {/* Result readout: Giảm X / Còn Y */}
                    <div className="flex items-center justify-between px-3.5 py-3 rounded-[12px] bg-primary/5 border border-primary/20">
                        <span className="text-text-secondary text-sm font-bold">
                            Giảm <span className="text-primary tabular-nums">{formatVND(discountAmount)}</span>
                        </span>
                        <span className="text-text font-black text-lg tabular-nums">
                            <span className="text-text-secondary text-sm font-bold">Còn </span>{formatVND(finalTotal)}
                        </span>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-border/40 flex gap-2">
                    {discount.value > 0 && (
                        <button
                            onClick={handleClear}
                            className="px-4 py-3 rounded-[14px] bg-bg border border-danger/30 text-danger font-bold text-sm hover:bg-danger/5 transition-colors"
                        >
                            Bỏ
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors"
                    >
                        Đóng
                    </button>
                    <button
                        onClick={handleApply}
                        className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors"
                    >
                        Đồng ý
                    </button>
                </div>
        </Dialog>
    )
}
