import { X } from 'lucide-react'
import ExpenseCategoryPicker from './ExpenseCategoryPicker'

export default function AddExpenseModal({
    expenseCategory, costName, costAmount, isSubmitting,
    // Tag picker
    expenseCategories = [],
    selectedCategoryId,
    onCategoryIdChange,
    onCreateCategory,
    // Payment method (defaults to 'cash' if undefined)
    paymentMethod = 'cash',
    onPaymentMethodChange,
    //
    onClose, onSubmit,
    onCategoryChange, onNameChange, onAmountChange,
}) {
    const canSubmit = costAmount && !isNaN(costAmount) && Number(costAmount) > 0 && costName.trim() && !isSubmitting
    const submitColor = expenseCategory === 'fixed' ? 'bg-warning' : 'bg-danger'

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

                <input
                    type="text"
                    autoFocus
                    placeholder="Tên chi phí..."
                    value={costName}
                    onChange={e => onNameChange(e.target.value)}
                    className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[15px] font-medium text-text placeholder:text-text-secondary/40 focus:outline-none focus:border-primary/50"
                />

                {/* Tag picker — sections itself into Vận hành / Quản lý & khác so
                    the dropped top tab's group context lives inside the chip list. */}
                <ExpenseCategoryPicker
                    categories={expenseCategories}
                    selectedId={selectedCategoryId}
                    onSelect={handleChipSelect}
                    onCreate={onCreateCategory}
                    disabled={isSubmitting}
                />

                <div className="relative flex items-center bg-surface-light border border-border/60 rounded-[12px] overflow-hidden focus-within:border-primary/50">
                    <input
                        type="number"
                        placeholder="0"
                        value={costAmount}
                        onChange={e => onAmountChange(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') canSubmit && onSubmit() }}
                        className="w-full bg-transparent px-4 py-3 text-[15px] font-medium text-text placeholder:text-text-secondary/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    {costAmount && <span className="absolute right-4 text-[15px] font-medium text-text-secondary pointer-events-none">.000đ</span>}
                </div>

                {/* Payment method — default cash. Editable here avoids the
                    "create then toggle pill" 2-tap pattern. */}
                <div className="flex bg-surface-light border border-border/60 rounded-[10px] p-0.5">
                    <PaymentTab
                        active={paymentMethod === 'cash'}
                        onClick={() => onPaymentMethodChange?.('cash')}
                    >
                        Tiền mặt
                    </PaymentTab>
                    <PaymentTab
                        active={paymentMethod === 'transfer'}
                        color="bg-primary/15 text-primary"
                        onClick={() => onPaymentMethodChange?.('transfer')}
                    >
                        Chuyển khoản
                    </PaymentTab>
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

function PaymentTab({ active, color, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 py-1.5 rounded-[8px] text-[11px] font-bold transition-all ${active ? (color || 'bg-surface text-text shadow-sm') : 'text-text-secondary hover:text-text'}`}
        >
            {children}
        </button>
    )
}
