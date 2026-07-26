import ChecklistRow from '../ChecklistRow'
import { VIEW_INVENTORY } from '../../../DailyReportPage/ReportViewFilter'

export default {
    to: '/daily-report',
    state: { initialView: VIEW_INVENTORY },
    navLabel: 'Đi tới báo cáo tồn kho',
    name: 'Kiểm kê tồn kho',
    done: (ctx) => ctx.closingDone,
    Body: ({ ctx }) => (
        <ChecklistRow label={`Nhập tồn cuối ${ctx.countedToday}/${ctx.totalStock}`} done={ctx.countedToday >= ctx.totalStock} />
    ),
}
