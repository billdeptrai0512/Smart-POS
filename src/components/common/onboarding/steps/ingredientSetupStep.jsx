import ChecklistRow from '../ChecklistRow'
import { nextIngredientSetupField } from '../../../../utils/onboardingHint'

// Phase 6 (CUỐI CÙNG) — thay cho cặp mainStockStep+ingredientCoffeeStep cũ đòi nhập kho
// TOÀN BỘ nguyên liệu: giờ chỉ đi sâu vào đúng 1 ingredient mẫu (Cà phê), dạy đủ 4 việc cần
// làm khi cài 1 nguyên liệu — tồn kho cuối ngày, quy đổi, tồn kho tối thiểu, khối lượng bì —
// thay vì bắt gõ số cho cả chục dòng. Xong phase này = xong onboarding (STEPS hết phase chưa
// done → OnboardingGuide chuyển FINISHED_STEP, mời đăng ký tài khoản).
// Không có navLabel — cùng pattern với recipeStep.jsx: user đã ở /recipes (đến từ hint mũi tên
// header của phase 5), tab "Nguyên liệu" có sẵn ngay trên header (MenuTabsBar, dùng chung giữa
// /recipes và /ingredients) tự sáng hint — xem hintIngredientsTab ở RecipeMenuPage.jsx/
// IngredientManagementPage.jsx. Khỏi cần thêm 1 nút CTA trùng việc trong panel guide.
export default {
    name: 'Cài đặt nguyên liệu',
    // ctx.coffeeConfig rỗng (chưa có ingredient "Cà phê" nào) → vacuously done, khỏi chặn.
    done: (ctx) => !ctx.coffeeConfig || nextIngredientSetupField(ctx.coffeeConfig, ctx.stockProgress.coffeeWarehouseSet) === null,
    Body: ({ ctx }) => {
        const c = ctx.coffeeConfig
        return (
            <>
                <ChecklistRow label="Nhập tồn kho cuối ngày" done={ctx.stockProgress.coffeeWarehouseSet} />
                <ChecklistRow label="Cài quy đổi" done={!!(c?.pack_size && c?.pack_unit)} />
                <ChecklistRow label="Cài tồn kho tối thiểu" done={c?.min_stock != null} />
                <ChecklistRow label="Cài khối lượng bì" done={c?.tare_weight != null && c.tare_weight > 0} />
            </>
        )
    },
}
