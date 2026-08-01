import ChecklistRow from '../ChecklistRow'

// Phase 2 "Nhật ký" — theo dõi việc user tự bấm qua 3 tab của /history (Thu nhập/Chi
// phí/Báo cáo, xem HistoryTabsBar.jsx). "Xem thu nhập" tick ngay vì đó là tab mặc định
// khi vào /history; "Xem chi phí"/"Xem báo cáo" tick khi user tự bấm tab tương ứng —
// ghi từ HistoryPage.jsx (xem onboardingStorage.js).
export default {
    name: 'Nhật ký',
    done: (ctx) => ctx.journalProgress.viewedIncome && ctx.journalProgress.viewedExpense && ctx.journalProgress.viewedReport,
    Body: ({ ctx }) => (
        <>
            <ChecklistRow label="Xem thu nhập" done={ctx.journalProgress.viewedIncome} />
            <ChecklistRow label="Xem chi phí" done={ctx.journalProgress.viewedExpense} />
            <ChecklistRow label="Xem báo cáo" done={ctx.journalProgress.viewedReport} />
        </>
    ),
}
