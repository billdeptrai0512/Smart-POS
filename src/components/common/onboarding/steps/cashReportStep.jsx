import ChecklistRow from '../ChecklistRow'
import { isCashFlowProgressDone } from '../../../../utils/onboardingStorage'

export default {
    name: 'Kết ca thực thu',
    done: (ctx) => isCashFlowProgressDone(ctx.cashFlowProgress),
    Body: ({ ctx }) => (
        <>
            <ChecklistRow label="Nhập tiền mặt" done={ctx.cashFlowProgress.cash} />
            <ChecklistRow label="Nhập chuyển khoản" done={ctx.cashFlowProgress.transfer} />
        </>
    ),
}
