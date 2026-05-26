import { useRef } from 'react'
import { X } from 'lucide-react'
import ExpenseCategoryPicker from './ExpenseCategoryPicker'
import MoneyInput from '../common/MoneyInput'
import { parseVNDInput } from '../../utils'

// Create flow: pick label → name → amount → submit. Payment defaults to cash
// on insert; user toggles it on the expense card (ExpensePanel) after the row
// appears — keeps this modal tight to the essential 3 fields.
export default function AddExpenseModal({
    expenseCategory, costName, costAmount, isSubmitting,
    // Tag picker
    expenseCategories = [],
    selectedCategoryId,
    onCategoryIdChange,
    onCreateCategory,
    //
    onClose, onSubmit,
    onCategoryChange, onNameChange, onAmountChange,
}) {
    const canSubmit = parseVNDInput(costAmount) > 0 && costName.trim() && !isSubmitting
    const submitColor = expenseCategory === 'fixed' ? 'bg-warning' : 'bg-danger'

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
                    className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[15px] font-medium text-text placeholder:text-text-secondary/40 focus:outline-none focus:border-primary/50"
                />

                <MoneyInput
                    value={costAmount}
                    onChange={onAmountChange}
                    onKeyDown={e => { if (e.key === 'Enter') canSubmit && onSubmit() }}
                    inputRef={amountRef}
                    size="lg"
                />

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
