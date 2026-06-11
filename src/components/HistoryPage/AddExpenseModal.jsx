import { useRef } from 'react'
import { X } from 'lucide-react'
import ExpenseCategoryPicker from './ExpenseCategoryPicker'
import MoneyInput from '../common/MoneyInput'
import DatePicker from '../common/DatePicker'
import { formatIsoDisplay } from '../common/datePickerUtils'
import { parseVNDInput } from '../../utils'
import { dateStringVN } from '../../utils/dateVN'

// Create flow: pick label → name → amount → (date) → submit. Payment defaults to
// cash on insert; user toggles it on the expense card (ExpensePanel) after the row
// appears. Ngày chi defaults to today; pick a past day to backdate the expense.
export default function AddExpenseModal({
    expenseCategory, costName, costAmount, isSubmitting,
    isAfterShift, onAfterShiftChange,
    // Tag picker
    expenseCategories = [],
    selectedCategoryId,
    onCategoryIdChange,
    onCreateCategory,
    // Date (backdate support)
    expenseDate, onDateChange,
    // Payment method toggle
    paymentMethod = 'cash', onPaymentMethodChange,
    //
    onClose, onSubmit,
    onCategoryChange, onNameChange, onAmountChange,
}) {
    const canSubmit = parseVNDInput(costAmount) > 0 && costName.trim() && !isSubmitting
    const submitColor = expenseCategory === 'fixed' ? 'bg-warning' : 'bg-danger'
    const today = dateStringVN()
    const isBackdated = expenseDate && expenseDate !== today

    const nameRef = useRef(null)
    const amountRef = useRef(null)

    // The top Vận hành/Quản lý tab is gone — chip section + dot color carry the
    // group context now. When user picks a chip, mirror its group_section back
    // into expenseCategory so the parent's save path (and submit button tone)
    // route to the correct bucket without a separate tab toggle.
    const handleChipSelect = (id) => {
        const chip = expenseCategories.find(c => c.id === id)
        if (chip) {
            const next = chip.group_section === 'overhead' ? 'fixed' : 'expense'
            if (next !== expenseCategory) onCategoryChange?.(next)
        }
        onCategoryIdChange(id)
        // Advance focus only when the user hasn't started typing — avoid
        // yanking caret away if they reach back to fix the label.
        if (!costName.trim()) nameRef.current?.focus()
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <span className="text-[16px] font-black text-text">Thêm chi phí</span>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all">
                        <X size={16} />
                    </button>
                </div>

                {/* Ngày chi — lên đầu modal, full-width. Mặc định hôm nay; chọn ngày quá khứ để ghi lùi. */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Ngày chi</span>
                    <DatePicker
                        value={expenseDate || today}
                        max={today}
                        onChange={onDateChange}
                        presets={false}
                        align="start"
                        trigger={(label, toggle) => (
                            <button
                                type="button"
                                onClick={toggle}
                                className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[14px] font-bold text-text text-left hover:border-primary/40 transition-all"
                            >
                                {formatIsoDisplay(expenseDate || today)}
                            </button>
                        )}
                    />
                    {isBackdated && (
                        <p className="text-[11px] text-warning leading-snug">
                            Sẽ ghi vào ngày {formatIsoDisplay(expenseDate)}, không phải hôm nay.
                        </p>
                    )}
                </div>

                {/* Thời điểm (Timing Toggle) */}
                <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Thời điểm</span>
                    <div className="w-48 flex items-center gap-0.5 bg-surface-light border border-border/60 rounded-lg p-0.5">
                        <button
                            type="button"
                            onClick={() => onAfterShiftChange?.(false)}
                            className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${!isAfterShift ? 'bg-primary text-white' : 'text-text-secondary'}`}
                        >
                            Trong ca
                        </button>
                        <button
                            type="button"
                            onClick={() => onAfterShiftChange?.(true)}
                            className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${isAfterShift ? 'bg-primary text-white' : 'text-text-secondary'}`}
                        >
                            Sau chốt ca
                        </button>
                    </div>
                </div>

                <ExpenseCategoryPicker
                    categories={expenseCategories}
                    selectedId={selectedCategoryId}
                    onSelect={handleChipSelect}
                    onCreate={onCreateCategory}
                    disabled={isSubmitting}
                />

                <input
                    ref={nameRef}
                    type="text"
                    placeholder="Tên chi phí..."
                    value={costName}
                    onChange={e => onNameChange(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault()
                            amountRef.current?.focus()
                        }
                    }}
                    className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[16px] font-medium text-text placeholder:text-text-secondary/40 focus:outline-none focus:border-primary/50"
                />

                <MoneyInput
                    value={costAmount}
                    onChange={onAmountChange}
                    onKeyDown={e => { if (e.key === 'Enter') canSubmit && onSubmit() }}
                    inputRef={amountRef}
                    size="lg"
                    align="left"
                    weight="medium"
                    placeholder="Số tiền..."
                />

                {/* Phương thức thanh toán (Toggle Tiền mặt / Chuyển khoản) */}
                <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Phương thức</span>
                    <div className="w-48 flex items-center gap-0.5 bg-surface-light border border-border/60 rounded-lg p-0.5">
                        <button
                            type="button"
                            onClick={() => onPaymentMethodChange?.('cash')}
                            className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'cash' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                        >
                            Tiền mặt
                        </button>
                        <button
                            type="button"
                            onClick={() => onPaymentMethodChange?.('transfer')}
                            className={`flex-1 px-1 py-1 rounded-md text-[11px] font-bold transition-all ${paymentMethod === 'transfer' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                        >
                            Chuyển khoản
                        </button>
                    </div>
                </div>

                <button
                    onClick={() => canSubmit && onSubmit()}
                    disabled={!canSubmit}
                    className={`w-full py-3.5 rounded-[14px] text-white text-[15px] font-black uppercase tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed ${submitColor}`}
                >
                    {isSubmitting ? 'Đang lưu...' : 'Xác nhận'}
                </button>
            </div>
        </div>
    )
}
