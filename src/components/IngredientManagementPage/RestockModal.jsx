import { useState, useMemo, useEffect } from 'react'
import { X } from 'lucide-react'
import { ingredientLabel } from '../../utils/ingredients'
import MoneyInput from '../common/MoneyInput'
import { parseVNDInput, formatVND, formatVNDInput } from '../../utils'
import { dateStringVN } from '../../utils/dateVN'
import DatePicker from '../common/DatePicker'

export default function RestockModal({
    ingredient,
    unit,
    packSize,
    packUnit,
    cashClosedToday = false,
    onConfirm,
    onClose,
    mode = 'create',
    initial = null
}) {
    const today = dateStringVN()
    const hasPack = !!(packSize && packUnit)
    // Edit mode: auto-bật pack mode nếu qty chia hết cho packSize (user nhập theo thùng/lốc).
    // Create mode: default theo hasPack như cũ.
    const initPackMode = mode === 'edit' && hasPack && initial?.qty > 0
        ? Number(initial.qty) % packSize === 0
        : hasPack
    const [usePackMode, setUsePackMode] = useState(initPackMode)
    // Edit mode: nếu pack mode, hiển thị số lốc/thùng thay vì base unit.
    const initQty = () => {
        if (initial?.qty == null) return ''
        if (mode === 'edit' && hasPack && Number(initial.qty) % packSize === 0) {
            return String(Number(initial.qty) / packSize)
        }
        return String(initial.qty)
    }
    const [qty, setQty] = useState(initQty)
    const [subtotal, setSubtotal] = useState(initial?.subtotal ? formatVNDInput(initial.subtotal) : '')
    const [purchaseDate, setPurchaseDate] = useState(initial?.purchaseDate || today)
    const [discountMode, setDiscountMode] = useState('amount') // 'amount' | 'percent'
    const [discountInput, setDiscountInput] = useState(initial?.discount ? formatVNDInput(initial.discount) : '')
    const [extraCostInput, setExtraCostInput] = useState(initial?.extraCost ? formatVNDInput(initial.extraCost) : '')
    const [paidInput, setPaidInput] = useState(initial?.paid !== undefined && initial?.paid !== null ? formatVNDInput(initial.paid) : '')
    const [userTouchedPaid, setUserTouchedPaid] = useState(mode === 'edit')
    const [paymentMethod, setPaymentMethod] = useState(initial?.paymentMethod || 'cash')
    const [cashPhase, setCashPhase] = useState(initial?.cashPhase || (cashClosedToday ? 'post_close' : 'in_shift'))
    const [userTouchedPhase, setUserTouchedPhase] = useState(mode === 'edit')
    const [submitting, setSubmitting] = useState(false)

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

    // Mặc định cash_phase: chốt rồi hôm nay, hoặc nhập lùi ngày (quá khứ) → 'post_close';
    // còn lại (đang trong ca, chưa chốt) → 'in_shift'. Không ghi đè nếu user đã tự chọn.
    useEffect(() => {
        if (userTouchedPhase) return
        setCashPhase(cashClosedToday || isBackdated ? 'post_close' : 'in_shift')
    }, [cashClosedToday, isBackdated, userTouchedPhase])

    // Chỉ tiền mặt mới ảnh hưởng két (CK không cộng Thực thu) → chỉ hỏi phase khi trả tiền mặt.
    const showPhaseToggle = paymentMethod === 'cash' && paidNum > 0

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
                // Phân loại cố định trên phiếu: chỉ 'in_shift' (tiền mặt, trước chốt) mới
                // cộng vào Thực thu. CK / sau chốt → 'post_close'.
                cashPhase: paymentMethod === 'cash' ? cashPhase : 'post_close',
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
                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">{mode === 'edit' ? 'Sửa phiếu nhập' : 'Nhập kho'}</span>
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
                    <div className="flex flex-col gap-3 p-3 bg-surface-light rounded-[14px] border border-border/40">
                        {/* Ngày mua */}
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Ngày mua</span>
                            <DatePicker
                                value={purchaseDate}
                                max={today}
                                onChange={setPurchaseDate}
                                presets={false}
                                align="end"
                                trigger={(label, toggle) => (
                                    <button
                                        type="button"
                                        onClick={toggle}
                                        className="w-32 bg-surface border border-border/60 rounded-[8px] px-3 py-1.5 text-[13px] font-bold text-text text-center hover:border-primary/50 transition-colors"
                                    >
                                        {label}
                                    </button>
                                )}
                            />
                        </div>
                        {isBackdated && (
                            <p className="text-[11px] text-warning leading-snug text-right">
                                Sẽ ghi vào ngày {purchaseDate.split('-').reverse().join('/')}, không phải hôm nay.
                            </p>
                        )}

                        {/* Số lượng nhập — toggle đơn vị nằm trong ô, sát phải */}
                        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
                            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Số lượng</span>
                            <div className="flex flex-col items-end gap-0.5">
                                {usePackMode && qty && Number(qty) > 0 && (
                                    <span className="text-[10px] text-text-dim tabular-nums leading-none">= {actualQty} {unit}</span>
                                )}
                                <div className="flex items-center bg-surface border border-border/60 rounded-[8px] overflow-hidden focus-within:border-primary/50 transition-colors w-40">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        autoFocus
                                        placeholder="0"
                                        value={qty}
                                        onChange={e => {
                                            const v = e.target.value.replace(',', '.')
                                            if (v === '' || /^\d*\.?\d*$/.test(v)) setQty(v)
                                        }}
                                        className="w-full bg-transparent px-3 py-2 text-[13px] font-bold text-text text-right tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                                    />
                                    {hasPack ? (
                                        <div className="flex items-center gap-0.5 mr-1.5 shrink-0 bg-surface-light border border-border/60 rounded-md p-0.5">
                                            <button
                                                onClick={() => { if (!usePackMode) { setUsePackMode(true); setQty('') } }}
                                                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${usePackMode ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                            >
                                                {packUnit}
                                            </button>
                                            <button
                                                onClick={() => { if (usePackMode) { setUsePackMode(false); setQty('') } }}
                                                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${!usePackMode ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                            >
                                                {unit}
                                            </button>
                                        </div>
                                    ) : (
                                        <span className="text-[11px] font-bold text-text-secondary pr-3 shrink-0 pointer-events-none">{unit}</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Tổng tiền hàng */}
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Tổng tiền</span>
                            <MoneyInput
                                value={subtotal}
                                onChange={setSubtotal}
                                onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                                size="sm"
                                className="w-32"
                            />
                        </div>

                        {/* Chi phí thêm */}
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Chi phí</span>
                            <MoneyInput value={extraCostInput} onChange={setExtraCostInput} size="sm" className="w-32" />
                        </div>

                        {/* Giảm giá — toggle đ/% nằm trong ô, sát phải */}
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Giảm giá</span>
                            <div className="flex flex-col items-end gap-0.5">
                                {discountMode === 'percent' && discountAmount > 0 && (
                                    <span className="text-[10px] text-text-dim tabular-nums leading-none">= {formatVND(discountAmount)}</span>
                                )}
                                <div className="flex items-center bg-surface-light border border-border/60 rounded-[12px] overflow-hidden focus-within:border-primary/40 transition-colors w-40">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={discountInput}
                                        placeholder="0"
                                        // percent: clamp 0–100 ngay tại input (CHECK ở RPC không phải catch); amount: format nghìn.
                                        onChange={e => {
                                            if (discountMode === 'percent') {
                                                const v = e.target.value
                                                if (v === '' || (Number(v) >= 0 && Number(v) <= 100)) setDiscountInput(v)
                                            } else {
                                                setDiscountInput(formatVNDInput(e.target.value))
                                            }
                                        }}
                                        className="w-full bg-transparent px-3 py-2 text-[13px] font-bold text-text text-right tabular-nums placeholder:text-text-secondary/40 focus:outline-none"
                                    />
                                    <div className="flex items-center gap-0.5 mr-1.5 shrink-0 bg-surface border border-border/60 rounded-md p-0.5">
                                        <button
                                            onClick={() => { if (discountMode !== 'amount') { setDiscountMode('amount'); setDiscountInput('') } }}
                                            className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${discountMode === 'amount' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                        >
                                            đ
                                        </button>
                                        <button
                                            onClick={() => { if (discountMode !== 'percent') { setDiscountMode('percent'); setDiscountInput('') } }}
                                            className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${discountMode === 'percent' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                        >
                                            %
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Tổng cộng */}
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Tổng cộng</span>
                            <span className="text-[14px] font-black text-primary tabular-nums">{formatVND(amountDue)}</span>
                        </div>

                        {/* Đã thanh toán — trạng thái đủ/nợ hiển thị ở dòng Trạng thái bên dưới */}
                        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
                            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Đã thanh toán</span>
                            <MoneyInput
                                value={paidInput}
                                onChange={v => { setUserTouchedPaid(true); setPaidInput(v) }}
                                onBlur={() => { if (paidNum > amountDue && amountDue > 0) setPaidInput(formatVNDInput(amountDue)) }}
                                size="sm"
                                className="w-32"
                            />
                        </div>

                        {/* Còn nợ / Đã trả đủ */}
                        {owing > 0 ? (
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Còn nợ</span>
                                <span className="text-[14px] font-black text-warning tabular-nums">{formatVND(owing)}</span>
                            </div>
                        ) : paidNum > 0 && amountDue > 0 ? (
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Trạng thái</span>
                                <span className="text-[14px] font-black text-success tabular-nums">Đã trả đủ ✓</span>
                            </div>
                        ) : null}

                        {/* Phương thức — chỉ hiện khi có thanh toán */}
                        {paidNum > 0 && (
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Phương thức</span>
                                <div className="w-32 flex items-center gap-0.5 bg-surface border border-border/60 rounded-lg p-0.5">
                                    <button
                                        onClick={() => setPaymentMethod('cash')}
                                        className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'cash' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                    >
                                        Tiền mặt
                                    </button>
                                    <button
                                        onClick={() => setPaymentMethod('transfer')}
                                        className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'transfer' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                    >
                                        Bank
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Phân loại dòng tiền — chỉ hỏi khi trả TIỀN MẶT. 'Trong ca' = rút từ
                            doanh thu bán hàng trước khi chốt ca tiền → cộng vào Thực thu. */}
                        {showPhaseToggle && (
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wide">Thời điểm</span>
                                <div className="w-32 flex items-center gap-0.5 bg-surface border border-border/60 rounded-lg p-0.5">
                                    <button
                                        onClick={() => { setUserTouchedPhase(true); setCashPhase('in_shift') }}
                                        className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition-all ${cashPhase === 'in_shift' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                    >
                                        Trong ca
                                    </button>
                                    <button
                                        onClick={() => { setUserTouchedPhase(true); setCashPhase('post_close') }}
                                        className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition-all ${cashPhase === 'post_close' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                                    >
                                        Sau chốt
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Submit */}
                <button
                    onClick={handleSubmit}
                    disabled={!isValid || submitting}
                    className="w-full py-3.5 rounded-[14px] bg-primary text-white text-[15px] font-black uppercase tracking-wide hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                >
                    {submitting ? 'Đang xử lý...' : mode === 'edit' ? 'Lưu thay đổi' : 'Xác nhận nhập kho'}
                </button>
            </div>
        </div>
    )
}
