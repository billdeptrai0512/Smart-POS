import ChecklistRow from '../ChecklistRow'
import { isInventoryProgressDone } from '../../../../utils/onboardingStorage'

export default {
    name: 'Kết ca tồn quầy',
    done: (ctx) => isInventoryProgressDone(ctx.inventoryProgress),
    Body: ({ ctx }) => (
        <>
            <ChecklistRow label="Nhập tồn cuối kỳ cà phê" done={ctx.inventoryProgress.coffee} />
            <ChecklistRow label="Nhập tồn cuối kỳ cacao" done={ctx.inventoryProgress.cacao} />
        </>
    ),
}
