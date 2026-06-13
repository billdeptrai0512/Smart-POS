import { useMemo, useState } from 'react'
import { formatVND } from '../../utils'
import { groupMeta } from '../../constants/expenseGroups'
import ChangeCategorySheet from './ChangeCategorySheet'

// "Thực chi" model: chỉ list chi phí thực (operating + overhead). NVL refill
// KHÔNG hiện ở đây — lịch sử biến động kho cho mỗi nguyên liệu sống ở
// /ingredient/:id (cùng với qty in/out). NVL vẫn xuất hiện trong dòng tiền
// (CashFlowCard / FinancialFlow) vì chúng là cash-out thật, chỉ không trừ lại
// trong P&L vì COGS đã đảm nhận.
function formatTime(iso) {
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function ExpensePanel({
    isReadOnly, isLoading,
    expenses,
    expenseCategories = [],
    deletingExpId, onDeleteExpense,
    onChangeCategory,   // (expenseId, newCategoryId) => Promise
    onCreateCategory,   // ({name, group_section}) => Promise<{id}>
    onUpdateCategory,   // (id, updates) => Promise
    onDeleteCategoryTag,// (id) => Promise
    onChangePayment,    // (expenseId, 'cash' | 'transfer') => Promise
}) {
    // Sheet state lives at panel level so opening one card doesn't unmount the
    // sheet when re-render reorders rows. `retaggingExpense` = the row being edited.
    const [retaggingExpense, setRetaggingExpense] = useState(null)

    const handleSheetSelect = async (newCategoryId) => {
        if (!retaggingExpense) return
        try {
            await onChangeCategory?.(retaggingExpense.id, newCategoryId)
        } finally {
            setRetaggingExpense(null)
        }
    }

    return (
        <main className="flex-1 overflow-y-auto px-4 py-4 pb-4 space-y-3 bg-bg">
            {isLoading ? (
                <div className="flex flex-col gap-3 animate-pulse">
                    <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                    <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                </div>
            ) : expenses.length === 0 ? (
                <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                    Chưa có chi phí nào.
                </div>
            ) : (
                <ExpenseList
                    expenses={expenses}
                    expenseCategories={expenseCategories}
                    isReadOnly={isReadOnly}
                    deletingExpId={deletingExpId}
                    onDeleteExpense={onDeleteExpense}
                    onTagClick={isReadOnly ? null : setRetaggingExpense}
                    onPaymentToggle={isReadOnly ? null : onChangePayment}
                />
            )}

            <ChangeCategorySheet
                open={!!retaggingExpense}
                expense={retaggingExpense}
                selectedId={retaggingExpense?.category_id}
                categories={expenseCategories}
                onSelect={handleSheetSelect}
                onCreate={onCreateCategory}
                onUpdate={onUpdateCategory}
                onDelete={onDeleteCategoryTag}
                onClose={() => setRetaggingExpense(null)}
            />
        </main>
    )
}

// Subcomponent that owns the running-total computation so it
// doesn't rerun when unrelated state changes in ExpensePanel.
function ExpenseList({ expenses, expenseCategories, isReadOnly, deletingExpId, onDeleteExpense, onTagClick, onPaymentToggle }) {
    // Running total (cumulative) — walks oldest → newest. expenses list is sorted
    // newest-first so we iterate in reverse.
    const runningMap = useMemo(() => {
        const map = new Map()
        let cum = 0
        for (let i = expenses.length - 1; i >= 0; i--) {
            cum += expenses[i].amount || 0
            map.set(expenses[i].id, cum)
        }
        return map
    }, [expenses])

    // O(1) category lookup keyed by id.
    const catById = useMemo(
        () => new Map(expenseCategories.map(c => [c.id, c])),
        [expenseCategories]
    )

    return (
        <>
            {expenses.map(expense => (
                <ExpenseCard
                    key={expense.id}
                    expense={expense}
                    category={catById.get(expense.category_id)}
                    isReadOnly={isReadOnly}
                    runningTotal={runningMap.get(expense.id)}
                    deletingExpId={deletingExpId}
                    onDelete={onDeleteExpense}
                    onTagClick={onTagClick}
                    onPaymentToggle={onPaymentToggle}
                />
            ))}
        </>
    )
}

function ExpenseCard({ expense, category, isReadOnly, runningTotal, deletingExpId, onDelete, onTagClick, onPaymentToggle }) {
    const time = formatTime(expense.created_at)
    // "Sau ca" marker: free-form refill flag was originally used for after-shift
    // ops expenses. is_refill=true here only happens for free-form (NVL refills
    // are already filtered out upstream).
    const isAfterShift = !!expense.metadata?.free_form
    // Default 'cash' khi payment_method nullish — matches insertExpense default.
    const isTransfer = expense.payment_method === 'transfer'

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden opacity-90">
            <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2 mt-1">
                    <span className="font-black text-[14px] text-warning">
                        -{formatVND(expense.amount)}
                    </span>
                    <Pill
                        tone={isTransfer ? 'primary' : 'neutral'}
                        onClick={onPaymentToggle ? () => onPaymentToggle(expense.id, isTransfer ? 'cash' : 'transfer') : null}
                    >
                        {isTransfer ? 'Chuyển khoản' : 'Tiền mặt'}
                    </Pill>
                </div>
                {runningTotal != null && (
                    <span className="text-danger leading-none text-[14px] font-bold tabular-nums">
                        -{formatVND(runningTotal)}
                    </span>
                )}
            </div>

            {/* Meta pills row — tag (colored by group) + timing. */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2">
                {category ? (
                    <TagPill
                        name={category.name}
                        group={category.group_section}
                        onClick={onTagClick ? () => onTagClick(expense) : null}
                    />
                ) : expense.category_id ? (
                    <TagPill
                        name="Nhãn đã xoá"
                        group="operating"
                        muted
                        strike
                        onClick={onTagClick ? () => onTagClick(expense) : null}
                    />
                ) : (
                    <TagPill
                        name="Chưa phân loại"
                        group="operating"
                        muted
                        onClick={onTagClick ? () => onTagClick(expense) : null}
                    />
                )}
                <Pill tone="neutral">{isAfterShift ? 'Sau ca' : 'Trong ca'}</Pill>
            </div>

            <div className="flex justify-between items-stretch mb-1">
                <div className="flex flex-col flex-1 gap-1.5 mt-0.5">
                    <span className="text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text">{expense.name}</span>
                    {expense.staff_name && (
                        <span className="text-text-secondary/70 text-[12px] font-bold leading-none mt-2">{expense.staff_name}</span>
                    )}
                </div>
                <div className="flex flex-col justify-end items-end gap-1 shrink-0 mt-0.5">
                    {isReadOnly ? (
                        <span className="text-text-dim text-[14px] font-bold leading-none">{time}</span>
                    ) : (
                        <span
                            className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none leading-none"
                            onClick={() => {
                                if (deletingExpId === expense.id) return
                                if (window.confirm(`Xóa chi phí "${expense.name}"?\n\nHành động này không thể hoàn tác!`)) {
                                    onDelete(expense.id, expense.amount)
                                }
                            }}
                        >
                            {deletingExpId === expense.id ? '⏳' : time}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}

// Tag chip with a colored dot. Group section drives the dot color. Clickable when
// onClick is provided (manager can re-tag); plain span otherwise (read-only).
// `strike` is shown for orphan tags (category was soft-deleted).
function TagPill({ name, group, muted = false, strike = false, onClick }) {
    const dotCls = groupMeta(group).dotCls
    const wrapCls = muted
        ? 'bg-surface-light border-border/60 text-text-dim italic'
        : 'bg-surface-light border-border/60 text-text-secondary'
    const nameCls = strike ? 'line-through' : ''
    const baseCls = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border max-w-[160px] truncate ${wrapCls}`
    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={`${baseCls} hover:border-primary/50 hover:text-primary cursor-pointer transition-colors`}
            >
                <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-80 shrink-0`} />
                <span className={`truncate ${nameCls}`}>{name}</span>
            </button>
        )
    }
    return (
        <span className={baseCls}>
            <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-80 shrink-0`} />
            <span className={`truncate ${nameCls}`}>{name}</span>
        </span>
    )
}

function Pill({ tone, children, onClick }) {
    const cls = tone === 'primary'
        ? 'bg-primary/10 border-primary/30 text-primary'
        : 'bg-surface-light border-border/60 text-text-secondary'
    const baseCls = `inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`
    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={`${baseCls} hover:border-primary/50 hover:text-primary cursor-pointer transition-colors`}
            >
                {children}
            </button>
        )
    }
    return <span className={baseCls}>{children}</span>
}
