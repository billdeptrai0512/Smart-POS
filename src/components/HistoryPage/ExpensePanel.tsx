import { useMemo } from 'react'
import CupsRevenueSummary from '../common/CupsRevenueSummary'
import { formatVND } from '../../utils'
import { groupMeta } from '../../constants/expenseGroups'
import { dateShortVN } from '../../utils/dateVN'
import type { ReactNode } from 'react'
import type { ExpenseCategory, Row } from '../../types/domain'

// "Thực chi" model: chỉ list chi phí thực (operating + overhead). NVL refill
// KHÔNG hiện ở đây — lịch sử biến động kho cho mỗi nguyên liệu sống ở
// /ingredient/:id (cùng với qty in/out). NVL vẫn xuất hiện trong dòng tiền
// (CashFlowCard / FinancialFlow) vì chúng là cash-out thật, chỉ không trừ lại
// trong P&L vì COGS đã đảm nhận.

interface Props {
    isReadOnly?: boolean
    isLoading?: boolean
    expenses: Row[]
    expenseCategories?: ExpenseCategory[]
    onEditExpense?: (expense: Row) => void // bấm thẻ để mở modal sửa
}

export default function ExpensePanel({ isReadOnly, isLoading, expenses, expenseCategories = [], onEditExpense }: Props) {
    // O(1) category lookup keyed by id.
    const catById = useMemo(() => new Map(expenseCategories.map(c => [c.id, c])), [expenseCategories])

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
            ) : (<>
                {/* Thẻ tổng kết — cùng bố cục tab Bán hàng */}
                <div className="bg-surface rounded-[24px] p-5 shadow-sm border border-border/60">
                    <CupsRevenueSummary
                        cups={expenses.length}
                        revenue={expenses.reduce((sum, e) => sum + (e.amount || 0), 0)}
                        leftLabel="Phát sinh" unit="chi phí" rightLabel="Tổng cộng" rightTone="text-danger"
                    />
                </div>
                {expenses.map(expense => (
                    <ExpenseCard
                        key={expense.id}
                        expense={expense}
                        category={catById.get(expense.category_id)}
                        onEdit={isReadOnly ? null : onEditExpense}
                    />
                ))}
            </>)}
        </main>
    )
}

// Thẻ chi phí — HIỂN THỊ THUẦN, bấm cả thẻ để mở modal sửa (mọi thao tác đổi
// nhãn / tiền mặt / xoá / ngày dồn vào modal cho gọn). Bố cục:
//   header — badge: nhãn (chấm màu nhóm) · thời điểm (trái) · số tiền (phải)
//   body — tên
//   footer — nhân viên + ngày (trái) · phương thức (phải)
interface CardProps { expense: Row; category?: ExpenseCategory; onEdit?: ((expense: Row) => void) | null }

function ExpenseCard({ expense, category, onEdit }: CardProps) {
    const time = dateShortVN(new Date(expense.created_at))
    // "Sau ca" marker: free-form refill flag (NVL refills đã lọc ở trên).
    const isAfterShift = !!expense.metadata?.free_form
    const isTransfer = expense.payment_method === 'transfer'
    const clickable = !!onEdit

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
            className={`bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden transition-all ${
                clickable ? 'cursor-pointer hover:border-primary/40 active:scale-[0.99]' : ''
            }`}
        >
            {/* Header — badge (trái) · số tiền (phải), divider như thẻ lịch sử bán hàng */}
            <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <Badge dot={groupMeta(tag.group).dotCls} muted={tag.muted} strike={tag.strike}>{tag.name}</Badge>
                    <Badge>{isAfterShift ? 'Sau ca' : 'Trong ca'}</Badge>
                </div>
                <span className="text-[14px] font-bold tabular-nums text-danger shrink-0">-{formatVND(expense.amount)}</span>
            </div>

            {/* Body — tên chi phí, cùng lề trái với badge và footer */}
            <span className="text-[14px] leading-snug font-medium text-text whitespace-pre-wrap">{expense.name}</span>

            {/* Footer — nhân viên + ngày (trái) · phương thức (phải) */}
            <div className="flex justify-between items-end gap-2 border-t border-border/40 pt-2">
                <span className="text-[12px] font-bold text-text-secondary/70 truncate">
                    {expense.staff_name || '—'}<span className="text-text-dim font-medium"> · {time}</span>
                </span>
                <Badge>{isTransfer ? 'Chuyển khoản' : 'Tiền mặt'}</Badge>
            </div>
        </div>
    )
}

// Badge hiển thị gọn, đồng nhất 1 style; `dot` = chấm màu nhóm (cho nhãn).
function Badge({ children, dot, muted = false, strike = false }: { children: ReactNode; dot?: string; muted?: boolean; strike?: boolean }) {
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-surface-light border-border/60 max-w-[160px] ${
            muted ? 'text-text-dim italic' : 'text-text-secondary'
        }`}>
            {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot} opacity-70 shrink-0`} />}
            <span className={`truncate ${strike ? 'line-through' : ''}`}>{children}</span>
        </span>
    )
}

