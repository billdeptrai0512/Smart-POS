import { useState, useMemo, useEffect } from 'react'
import { X } from 'lucide-react'
import { ingredientLabel } from '../../utils/ingredients'
import MoneyInput from '../common/MoneyInput'
import { parseVNDInput, formatVND, formatVNDInput } from '../../utils'
import { dateStringVN } from '../../utils/dateVN'

export default function RestockModal({ ingredient, unit, packSize, packUnit, onConfirm, onClose }) {
    const today = dateStringVN()
    const hasPack = !!(packSize && packUnit)
    const [usePackMode, setUsePackMode] = useState(hasPack)
    const [qty, setQty] = useState('')
    const [subtotal, setSubtotal] = useState('')
    const [purchaseDate, setPurchaseDate] = useState(today)
    // Cost fields — collapsed by default to keep form ngắn cho trường hợp typical.
    const [showCostBlock, setShowCostBlock] = useState(false)
    const [discountMode, setDiscountMode] = useState('amount') // 'amount' | 'percent'
    const [discountInput, setDiscountInput] = useState('')
    const [extraCostInput, setExtraCostInput] = useState('')
    const [paidInput, setPaidInput] = useState('')
    const [userTouchedPaid, setUserTouchedPaid] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState('cash')
    const [submitting, setSubmitting] = useState(false)

    const activeUnit = usePackMode ? packUnit : unit
    const actualQty = usePackMode ? Number(qty) * packSize : Number(qty)
    const subtotalNum = parseVNDInput(subtotal)
    const extraCostNum = parseVNDInput(extraCostInput)

    const discountAmount = useMemo(() => {
        if (!discountInput) return 0
        if (discountMode === 'percent') {
            const pct = Number(discountInput) || 0
            return Math.round(subtotalNum * (pct / 100))
        }
        return parseVNDInput(discountInput)
    }, [discountInput, discountMode, subtotalNum])

    // Cần trả NCC = subtotal − discount + extra. Clamp ≥ 0 đề phòng user nhập discount > tổng.
    const amountDue = Math.max(0, subtotalNum - discountAmount + extraCostNum)

    // Default "Tiền trả" = Cần trả NCC. User chưa touch input → auto-sync mỗi khi amountDue đổi.
    useEffect(() => {
        if (!userTouchedPaid) {
            setPaidInput(amountDue > 0 ? formatVNDInput(amountDue) : '')
        }
    }, [amountDue, userTouchedPaid])

    const paidNum = parseVNDInput(paidInput)
    const owing = Math.max(0, amountDue - paidNum)

    const isValid = qty && Number(qty) > 0 && subtotalNum > 0 && amountDue > 0
    const isBackdated = purchaseDate && purchaseDate !== today

    const handleSubmit = async () => {
        if (!isValid || submitting) return
        setSubmitting(true)
        try {
            await onConfirm({
                ingredient,
                qty: actualQty,
                subtotal: subtotalNum,
                discount: discountAmount,
                extraCost: extraCostNum,
                paid: Math.min(paidNum, amountDue),
                paymentMethod,
                // Chỉ truyền khi user đổi sang ngày khác hôm nay — giữ default NOW() server-side.
                // Anchor noon VN để rơi gọn vào ngày đó bất chấp TZ của client/DB.
                purchaseDate: isBackdated ? new Date(`${purchaseDate}T12:00:00+07:00`).toISOString() : null,
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
                className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-5 animate-slide-up max-h-[92vh] overflow-y-auto"
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

                    {/* Subtotal */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                            Tổng tiền hàng
                        </label>
                        <MoneyInput
                            value={subtotal}
                            onChange={setSubtotal}
                            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                            size="lg"
                        />
                    </div>

                    {/* Purchase date */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                            Ngày mua
                        </label>
                        <input
                            type="date"
                            value={purchaseDate}
                            max={today}
                            onChange={e => setPurchaseDate(e.target.value)}
                            className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[14px] font-bold text-text focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                        />
                        {isBackdated && (
                            <p className="text-[11px] text-warning leading-snug">
                                Sẽ ghi nhập kho vào ngày {purchaseDate.split('-').reverse().join('/')}, không phải hôm nay.
                            </p>
                        )}
                    </div>

                    {/* Toggle cost block — giữ form ngắn cho case typical (trả full, không giảm giá, không phí ship) */}
                    <button
                        onClick={() => setShowCostBlock(s => !s)}
                        className="text-[12px] font-bold text-primary hover:underline self-start"
                    >
                        {showCostBlock ? '− Ẩn tuỳ chọn giảm giá / công nợ' : '+ Có giảm giá, phí nhập, hoặc ghi nợ?'}
                    </button>

                    {showCostBlock && (
                        <div className="flex flex-col gap-3 p-3 bg-surface-light rounded-[14px] border border-border/40">
                            {/* Discount */}
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-[12px] font-bold text-text-secondary">Giảm giá</span>
                                    <div className="flex items-center gap-0.5 bg-surface border border-border/60 rounded-lg p-0.5">
                                        <button
                                            onClick={() => { if (discountMode !== 'amount') { setDiscountMode('amount'); setDiscountInput('') } }}
                                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-all ${discountMode === 'amount' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                        >
                                            đ
                                        </button>
                                        <button
                                            onClick={() => { if (discountMode !== 'percent') { setDiscountMode('percent'); setDiscountInput('') } }}
                                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-all ${discountMode === 'percent' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                        >
                                            %
                                        </button>
                                    </div>
                                </div>
                                {discountMode === 'percent' ? (
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={discountInput}
                                        placeholder="0"
                                        // Clamp ngay tại input để CHECK ở RPC không phải catch.
                                        onChange={e => {
                                            const v = e.target.value
                                            if (v === '' || (Number(v) >= 0 && Number(v) <= 100)) setDiscountInput(v)
                                        }}
                                        className="w-24 bg-surface border border-border/60 rounded-[8px] px-3 py-1.5 text-[13px] font-bold text-text text-right tabular-nums focus:outline-none focus:border-primary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                ) : (
                                    <MoneyInput value={discountInput} onChange={setDiscountInput} size="sm" className="w-32" />
                                )}
                            </div>

                            {/* Extra cost */}
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] font-bold text-text-secondary">Chi phí nhập</span>
                                <MoneyInput value={extraCostInput} onChange={setExtraCostInput} size="sm" className="w-32" />
                            </div>

                            {/* Cần trả NCC */}
                            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
                                <span className="text-[12px] font-bold text-text-secondary">Cần trả NCC</span>
                                <span className="text-[14px] font-black text-primary tabular-nums">{formatVND(amountDue)}</span>
                            </div>

                            {/* Tiền trả NCC */}
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] font-bold text-text-secondary">Tiền trả Nhà cung cấp</span>
                                <MoneyInput
                                    value={paidInput}
                                    onChange={v => { setUserTouchedPaid(true); setPaidInput(v) }}
                                    size="sm"
                                    className="w-32"
                                />
                            </div>

                            {/* Phương thức trả */}
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] font-bold text-text-secondary">Phương thức trả</span>
                                <div className="flex items-center gap-0.5 bg-surface border border-border/60 rounded-lg p-0.5">
                                    <button
                                        onClick={() => setPaymentMethod('cash')}
                                        className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'cash' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                    >
                                        Tiền mặt
                                    </button>
                                    <button
                                        onClick={() => setPaymentMethod('transfer')}
                                        className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'transfer' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                    >
                                        Chuyển khoản
                                    </button>
                                </div>
                            </div>

                            {/* Owing preview */}
                            {owing > 0 && (
                                <div className="flex items-center justify-between gap-3 px-3 py-2 bg-warning/10 border border-warning/20 rounded-[10px]">
                                    <span className="text-[12px] font-bold text-warning">Còn nợ sau lần này</span>
                                    <span className="text-[14px] font-black text-warning tabular-nums">{formatVND(owing)}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Preview đơn giá theo Cần trả NCC (vốn thực tế) */}
                    {qty && Number(qty) > 0 && amountDue > 0 && (
                        <div className="flex items-center justify-between px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-[12px]">
                            <span className="text-[12px] font-bold text-text-secondary">Đơn giá mới</span>
                            <span className="text-[14px] font-black text-primary tabular-nums">
                                {Math.round(amountDue / actualQty).toLocaleString('vi-VN')}đ / {unit}
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
