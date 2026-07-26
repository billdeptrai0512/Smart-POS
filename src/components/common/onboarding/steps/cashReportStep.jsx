import ChecklistRow from '../ChecklistRow'

export default {
    to: '/daily-report',
    navLabel: 'Đi tới báo cáo dòng tiền',
    name: 'Báo cáo thực thu',
    done: (ctx) => ctx.cashReportDone.cash && ctx.cashReportDone.transfer,
    Body: ({ ctx }) => (
        <>
            <ChecklistRow label="Nhập tiền mặt" done={ctx.todayClosing?.actual_cash != null} />
            <ChecklistRow label="Nhập chuyển khoản" done={ctx.todayClosing?.actual_transfer != null} />
        </>
    ),
}
