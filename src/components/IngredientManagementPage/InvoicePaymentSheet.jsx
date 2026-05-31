import { useState } from 'react'
import MoneyInput from '../common/MoneyInput'
import { formatVND, formatVNDInput, parseVNDInput } from '../../utils'
import { dateStringVN } from '../../utils/dateVN'

// Bottom-sheet form to record a payment against an existing refill invoice.
// Caller provides the invoice row (already includes nested `payments`).
export default function InvoicePaymentSheet({ invoice, saving, onClose, onConfirm }) {
    const today = dateStringVN()
    const paidPrev = (invoice.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
    const owing = Math.max(0, (invoice.amount || 0) - paidPrev)
    const [amountInput, setAmountInput] = useState(formatVNDInput(owing))
    const [paymentMethod, setPaymentMethod] = useState('cash')
    const [paidDate, setPaidDate] = useState(today)
    const amount = parseVNDInput(amountInput)
    const isValid = amount > 0 && amount <= owing

    const handleConfirm = () => {
        if (!isValid || saving) return
        // Noon-VN anchor — same rule for today and back-dated so the stored
        // time is deterministic regardless of when the user opened the sheet.
        onConfirm({
            amount,
            paymentMethod,
            paidAt: new Date(`${paidDate}T12:00:00+07:00`).toISOString(),
        })
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-5 animate-slide-up"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Ghi nhận thanh toán</span>
                        <span className="text-[16px] font-black text-text leading-tight">{invoice.name}</span>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all">
                        <span className="text-[18px]">×</span>
                    </button>
                </div>

                <div className="flex flex-col gap-2 p-3 bg-warning/5 border border-warning/20 rounded-[12px]">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-text-secondary">Hoá đơn gốc</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">{formatVND(invoice.amount)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-text-secondary">Đã trả</span>
                        <span className="text-[13px] font-bold text-text tabular-nums">{formatVND(paidPrev)}</span>
                    </div>
                    <div className="flex items-center justify-between pt-1.5 border-t border-warning/20">
                        <span className="text-[12px] font-black text-warning">Còn nợ</span>
                        <span className="text-[15px] font-black text-warning tabular-nums">{formatVND(owing)}</span>
                    </div>
                </div>

                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Số tiền trả</label>
                        <MoneyInput value={amountInput} onChange={setAmountInput} size="lg" />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Ngày trả</label>
                        <input
                            type="date"
                            value={paidDate}
                            max={today}
                            onChange={e => setPaidDate(e.target.value)}
                            className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[14px] font-bold text-text focus:outline-none focus:border-primary/50"
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Phương thức</span>
                        <div className="flex items-center gap-0.5 bg-surface-light border border-border/60 rounded-lg p-0.5">
                            <button onClick={() => setPaymentMethod('cash')} className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'cash' ? 'bg-primary text-white' : 'text-text-secondary'}`}>Tiền mặt</button>
                            <button onClick={() => setPaymentMethod('transfer')} className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'transfer' ? 'bg-primary text-white' : 'text-text-secondary'}`}>Chuyển khoản</button>
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleConfirm}
                    disabled={!isValid || saving}
                    className="w-full py-3.5 rounded-[14px] bg-primary text-white text-[15px] font-black uppercase tracking-wide hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                >
                    {saving ? 'Đang lưu...' : 'Xác nhận thanh toán'}
                </button>
            </div>
        </div>
    )
}
