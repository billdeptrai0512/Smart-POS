import { useMemo } from 'react'
import { formatVND } from '../../utils'
import { groupMeta } from '../../constants/expenseGroups'
import { dateShortVN } from '../../utils/dateVN'

// "Thực chi" model: chỉ list chi phí thực (operating + overhead). NVL refill
// KHÔNG hiện ở đây — lịch sử biến động kho cho mỗi nguyên liệu sống ở
// /ingredient/:id (cùng với qty in/out). NVL vẫn xuất hiện trong dòng tiền
// (CashFlowCard / FinancialFlow) vì chúng là cash-out thật, chỉ không trừ lại
// trong P&L vì COGS đã đảm nhận.
function formatTime(iso) {
    return dateShortVN(new Date(iso))
}

export default function ExpensePanel({
    isReadOnly, isLoading,
    expenses,
    expenseCategories = [],
    onEditExpense,      // (expense) => void — bấm thẻ để mở modal sửa
}) {
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
                    onEdit={isReadOnly ? null : onEditExpense}
                />
            )}
        </main>
    )
}

// Subcomponent that owns the running-total computation so it
// doesn't rerun when unrelated state changes in ExpensePanel.
function ExpenseList({ expenses, expenseCategories, isReadOnly, onEdit }) {
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
                    onEdit={onEdit}
                />
            ))}
        </>
    )
}

// Thẻ chi phí — HIỂN THỊ THUẦN, bấm cả thẻ để mở modal sửa (mọi thao tác đổi
// nhãn / tiền mặt / xoá / ngày dồn vào modal cho gọn). Bố cục:
//   row 1 — tên (hero) · số tiền
//   row 2 — badge: nhãn (chấm màu nhóm) · thời điểm · phương thức (gọn, nhạt)
//   row 3 — nhân viên + ngày (trái) · luỹ kế (phải, nhạt)
function ExpenseCard({ expense, category, isReadOnly, runningTotal, onEdit }) {
    const time = formatTime(expense.created_at)
    // "Sau ca" marker: free-form refill flag (NVL refills đã lọc ở trên).
    const isAfterShift = !!expense.metadata?.free_form
    const isTransfer = expense.payment_method === 'transfer'
    const clickable = !isReadOnly && !!onEdit

    const tag = category
        ? { name: category.name, group: category.group_section, muted: false, strike: false }
        : expense.category_id
        ? { name: 'Nhãn đã xoá', group: 'operating', muted: true, strike: true }
        : { name: 'Chưa phân loại', group: 'operating', muted: true, strike: false }

    return (
        <div
            onClick={clickable ? () => onEdit(expense) : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(expense) } } : undefined}
            className={`bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2.5 relative overflow-hidden transition-all ${
                clickable ? 'cursor-pointer hover:border-primary/40 active:scale-[0.99]' : ''
            }`}
        >
            {/* Row 1 — tên (hero) + số tiền */}
            <div className="flex justify-between items-baseline gap-3">
                <span className="text-[15px] leading-snug font-bold text-text whitespace-pre-wrap min-w-0">{expense.name}</span>
                <span className="text-[15px] font-black tabular-nums text-danger shrink-0">-{formatVND(expense.amount)}</span>
            </div>

            {/* Row 2 — badge gọn cùng style: nhãn (chấm màu) · thời điểm · phương thức */}
            <div className="flex flex-wrap items-center gap-1.5">
                <Badge dot={groupMeta(tag.group).dotCls} muted={tag.muted} strike={tag.strike}>{tag.name}</Badge>
                <Badge>{isAfterShift ? 'Sau ca' : 'Trong ca'}</Badge>
                <Badge>{isTransfer ? 'Chuyển khoản' : 'Tiền mặt'}</Badge>
            </div>

            {/* Row 3 — nhân viên + ngày (trái) · luỹ kế (phải) */}
            <div className="flex justify-between items-end gap-2 border-t border-border/40 pt-2">
                <span className="text-[12px] font-bold text-text-secondary/70 truncate">
                    {expense.staff_name || '—'}<span className="text-text-dim font-medium"> · {time}</span>
                </span>
                {runningTotal != null && (
                    <span className="text-[12px] font-bold text-text-dim tabular-nums shrink-0">Σ -{formatVND(runningTotal)}</span>
                )}
            </div>
        </div>
    )
}

// Badge hiển thị gọn, đồng nhất 1 style; `dot` = chấm màu nhóm (cho nhãn).
function Badge({ children, dot, muted = false, strike = false }) {
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-surface-light border-border/60 max-w-[160px] ${
            muted ? 'text-text-dim italic' : 'text-text-secondary'
        }`}>
            {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot} opacity-70 shrink-0`} />}
            <span className={`truncate ${strike ? 'line-through' : ''}`}>{children}</span>
        </span>
    )
}

