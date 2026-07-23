import { useState } from 'react'
import MoneyInput from '../common/MoneyInput'
import { formatVND, formatVNDInput, parseVNDInput } from '../../utils'
import { dateStringVN } from '../../utils/dateVN'
import DatePicker from '../common/DatePicker'
import TimeInput from '../common/TimeInput'
import { BottomSheet } from '../common/ModalShell'

// Bottom-sheet form to record a payment against an existing refill invoice.
// Caller provides the invoice row (already includes nested `payments`).
export default function InvoicePaymentSheet({ invoice, saving, onClose, onConfirm }) {
    const today = dateStringVN()
    // Không cho chọn ngày trả trước ngày nhập hàng (RPC cũng chặn theo ngày VN).
    const invoiceDate = invoice.created_at ? dateStringVN(new Date(invoice.created_at)) : undefined
    const paidPrev = (invoice.payments || []).reduce((s, p) => s + (p.amount || 0), 0)
    const owing = Math.max(0, (invoice.amount || 0) - paidPrev)
    const [amountInput, setAmountInput] = useState(formatVNDInput(owing))
    const [paymentMethod, setPaymentMethod] = useState('cash')
    const [paidDate, setPaidDate] = useState(today)
    // Giờ trả tuỳ chọn để nhật ký biên nhận phản ánh đúng thời điểm trả thật.
    // Mặc định = giờ VN hiện tại; RPC chỉ chặn theo NGÀY VN nên giờ nào cũng hợp lệ.
    const [paidTime, setPaidTime] = useState(() =>
        new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()))
    const [isAfterShift, setIsAfterShift] = useState(false)
    const amount = parseVNDInput(amountInput)
    const isValid = amount > 0 && amount <= owing

    const handleConfirm = () => {
        if (!isValid || saving) return
        onConfirm({
            amount,
            paymentMethod,
            paidAt: new Date(`${paidDate}T${paidTime || '12:00'}:00+07:00`).toISOString(),
            cashPhase: isAfterShift ? 'post_close' : 'in_shift',
        })
    }

    return (
        <BottomSheet
            onClose={onClose}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-5 animate-slide-up"
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

                <div className="flex flex-col gap-3">
                    {/* 1. Ngày + giờ trả (lên đầu) */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Ngày trả</label>
                        {/* Ngày | giờ chung 1 khối — cùng pattern với ô ngày mua của RestockModal */}
                        <div className="flex items-center bg-surface-light border border-border/60 rounded-[12px] hover:border-primary/50 focus-within:border-primary/50 transition-colors">
                            {/* grid: blockify wrapper inline-flex của DatePicker để nút date stretch full width */}
                            <div className="flex-1 grid">
                                <DatePicker
                                    value={paidDate}
                                    min={invoiceDate}
                                    max={today}
                                    onChange={setPaidDate}
                                    presets={false}
                                    align="start"
                                    trigger={(label, toggle) => (
                                        <button
                                            type="button"
                                            onClick={toggle}
                                            className="w-full px-4 py-3 text-[14px] font-bold text-text text-left tabular-nums"
                                        >
                                            {label}
                                        </button>
                                    )}
                                />
                            </div>
                            <span className="w-px self-stretch bg-border/60" />
                            <TimeInput
                                value={paidTime}
                                onChange={setPaidTime}
                                aria-label="Giờ trả"
                                className="w-16 bg-transparent px-3 py-3 text-[14px] font-bold text-text text-center tabular-nums placeholder:text-text-dim focus:outline-none"
                            />
                        </div>
                    </div>

                    {/* 2. Thời điểm trả */}
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Thời điểm trả</span>
                        <div className="w-48 flex items-center gap-0.5 bg-surface-light border border-border/60 rounded-lg p-0.5">
                            <button
                                type="button"
                                onClick={() => setIsAfterShift(false)}
                                className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${!isAfterShift ? 'bg-primary text-white' : 'text-text-secondary'}`}
                            >
                                Trong ca
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsAfterShift(true)}
                                className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${isAfterShift ? 'bg-primary text-white' : 'text-text-secondary'}`}
                            >
                                Sau chốt ca
                            </button>
                        </div>
                    </div>
                </div>

                {/* 3. Panel hoá đơn gốc - đã trả - còn nợ */}
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
                    {/* 4. Số tiền trả */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Số tiền trả</label>
                        <MoneyInput value={amountInput} onChange={setAmountInput} size="lg" />
                    </div>

                    {/* 5. Phương thức */}
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Phương thức</span>
                        <div className="w-48 flex items-center gap-0.5 bg-surface-light border border-border/60 rounded-lg p-0.5">
                            <button
                                type="button"
                                onClick={() => setPaymentMethod('cash')}
                                className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'cash' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                            >
                                Tiền mặt
                            </button>
                            <button
                                type="button"
                                onClick={() => setPaymentMethod('transfer')}
                                className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'transfer' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                            >
                                Bank
                            </button>
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
        </BottomSheet>
    )
}

