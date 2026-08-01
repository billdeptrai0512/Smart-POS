import ChecklistRow from '../ChecklistRow'
import { isRecipeProgressDone } from '../../../../utils/onboardingStorage'

// Single source of truth for phase 5's anchor product — RecipeMenuPage.jsx (card hint) and
// RecipeIngredientPage.jsx (input/extras hints) both match against this instead of each
// hardcoding the name.
export const RECIPE_TARGET_PRODUCT = 'cà phê đen'

// Phase 4 xong, phase 5 chưa → user đang đi qua phase này. Dùng chung bởi DailyReportPage.jsx
// + HistoryPage.jsx để hint nút mũi tên "tiến" ở header (xem comment trong export default bên
// dưới) — tách ra đây để 2 trang khỏi tự viết lại cùng 1 công thức.
export const isRecipeStepActive = (inventoryDone, recipeProgress) =>
    inventoryDone && !isRecipeProgressDone(recipeProgress)

export default {
    // Không có navLabel — bước này không dẫn qua nút riêng trong panel guide nữa, mà hint
    // thẳng vào nút mũi tên "tiến" có sẵn ở header (HistoryHeader) trên /history + /daily-report,
    // đi xuyên page bằng menuSequence.js cho tới khi chạm /recipes — xem hintGoToRecipes ở
    // DailyReportPage.jsx/HistoryPage.jsx. Card Cà phê đen → từng input định lượng → nút
    // "+ Thêm tùy chọn" (RecipeMenuPage.jsx/RecipeIngredientPage.jsx) tiếp quản hint từ đó.
    name: 'Cài công thức',
    done: (ctx) => isRecipeProgressDone(ctx.recipeProgress),
    Body: ({ ctx }) => (
        <>
            <ChecklistRow label="Thêm định lượng nguyên liệu" done={ctx.recipeProgress.filledAmount} />
            <ChecklistRow label="Tạo tùy chọn thêm" done={ctx.recipeProgress.addedExtra} />
        </>
    ),
}
