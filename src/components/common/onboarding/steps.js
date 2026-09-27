import { isRecipeProgressDone, reachedCashCard } from '../../../utils/onboardingStorage'
import { INGREDIENT_SETUP_FIELDS } from '../../../utils/onboardingHint'

// Single source of truth for phase 5's anchor product — RecipeMenuPage.jsx (card hint) and
// RecipeIngredientPage.jsx (input/extras hints) both match against this instead of each
// hardcoding the name.
export const RECIPE_TARGET_PRODUCT = 'cà phê đen'

// Phase 4 xong, phase 5 chưa → user đang đi qua phase này. Dùng chung bởi DailyReportPage.jsx
// + HistoryPage.jsx để hint nút mũi tên "tiến" ở header — tách ra đây để 2 trang khỏi tự viết
// lại cùng 1 công thức.
export const isRecipeStepActive = (inventoryDone, recipeProgress) =>
    inventoryDone && !isRecipeProgressDone(recipeProgress)

// Bước 1 "Tạo đơn" — món tick ngay lúc chọn đúng món, "Bấm Tạo đơn" tick khi gửi đơn thật (cả
// hai ghi bởi useOrderOnboardingProgress.js). Không đòi viewedHistory — đó là việc của bước 2.
// Export riêng vì HistoryPage.jsx cần biết bước này xong chưa.
export const orderStep = {
    items: (ctx) => [
        { label: 'Chọn 1 ly cà phê sữa', done: ctx.orderProgress.cafeSua },
        { label: 'Chọn 1 ly cacao cà phê lớn', done: ctx.orderProgress.cacaoCaPheLon },
        { label: 'Chọn 1 ly matcha cà phê', done: ctx.orderProgress.matcha },
        { label: 'Bấm tạo đơn', done: ctx.orderProgress.submitted },
    ],
}

// 6 bước onboarding khách dùng thử — mỗi bước là items(ctx) → [{ label, done }], xong khi mọi
// item done. Tiến độ do từng trang ghi vào localStorage (xem onboardingStorage.js).
// ⚠ Thêm/bớt bước ở đây → phải sửa 20260801_guest_onboarding_funnel.sql (CHECK 0..6,
// generate_series(0,6), CASE nhãn) rồi chạy lại. Không sửa thì stage vượt 6 bị RPC bỏ qua
// IM LẶNG — phễu chết mà không báo lỗi gì.
export const STEPS = [
    orderStep,
    // 2. Nhật ký — 3 tab của /history (HistoryTabsBar.jsx). viewedIncome tick ngay khi vào
    // /history (Doanh thu là tab mặc định) nên nhãn là "Vào nhật ký" — lúc này user còn đứng ở
    // POS. Chi phí/Báo cáo tick khi user tự bấm — ghi từ HistoryPage.jsx.
    {
        items: (ctx) => [
            { label: 'Vào nhật ký', done: ctx.journalProgress.viewedIncome },
            { label: 'Xem chi phí', done: ctx.journalProgress.viewedExpense },
            { label: 'Xem báo cáo', done: ctx.journalProgress.viewedReport },
        ],
    },
    // 3-4. Kết ca thực thu / tồn quầy — ghi từ DailyReportPage.jsx. Thẻ Thực thu nằm dưới mép
    // màn hình lúc vừa vào /daily-report nên việc đầu là kéo xuống cho thẻ hiện trọn.
    {
        items: (ctx) => [
            { label: 'Kéo xuống', done: reachedCashCard(ctx.cashFlowProgress) },
            { label: 'Nhập tiền mặt', done: ctx.cashFlowProgress.cash },
            { label: 'Nhập chuyển khoản', done: ctx.cashFlowProgress.transfer },
        ],
    },
    {
        items: (ctx) => [
            { label: 'Nhập tồn cuối kỳ cà phê', done: ctx.inventoryProgress.coffee },
            { label: 'Nhập tồn cuối kỳ cacao', done: ctx.inventoryProgress.cacao },
        ],
    },
    // 5. Công thức "Cà phê đen" — không có nút riêng: hint mũi tên "tiến" ở header /history +
    // /daily-report dẫn tới /recipes (hintGoToRecipes, menuSequence.js), rồi card Cà phê đen →
    // input định lượng → "+ Thêm tùy chọn" (RecipeMenuPage.jsx/RecipeIngredientPage.jsx).
    {
        items: (ctx) => [
            { label: 'Thêm định lượng', done: ctx.recipeProgress.filledAmount },
            { label: 'Tạo tùy chọn thêm', done: ctx.recipeProgress.addedExtra },
        ],
    },
    // 6. (CUỐI CÙNG) Cài đặt 1 nguyên liệu mẫu (Cà phê) — tab "Nguyên liệu" trên MenuTabsBar tự
    // sáng hint (hintIngredientsTab). Chưa có ingredient "Cà phê" → [] = vacuously done.
    {
        items: ({ coffeeConfig, stockProgress }) => coffeeConfig
            ? INGREDIENT_SETUP_FIELDS.map(f => ({ label: f.label, done: f.done(coffeeConfig, stockProgress.coffeeWarehouseSet) }))
            : [],
    },
]
