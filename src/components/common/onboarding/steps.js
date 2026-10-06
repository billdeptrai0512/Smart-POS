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

// Bước 1 "Tạo đơn" — 2 đơn: cà phê sữa; rồi bạc xỉu ít ngọt + cacao lớn + matcha lớn hơi ngọt.
// Mỗi dòng done theo `sent` (số đơn đã gửi thật, ghi bởi useOrderOnboardingProgress.js). Không
// đòi viewedHistory — đó là việc của bước 2. Export riêng vì HistoryPage.jsx cần biết bước này
// xong chưa.
export const orderStep = {
    title: 'Tạo đơn',
    // n = số dòng đã xong: dòng 1 khi gửi đơn 1; dòng 2-3 ngay lúc chọn đủ món (`picked`, tối đa
    // 2 dù matcha cũng đã chọn); dòng 4 (matcha) chỉ khi gửi đơn 2 = bấm Tạo đơn → xong bước 1.
    items: ({ orderProgress: { sent, picked = 0 } }) => {
        const n = sent >= 2 ? 4 : sent === 1 ? 1 + Math.min(picked, 2) : 0
        return [
            'Khách gọi 1 cà phê sữa',
            '1 ly bạc xỉu ít ngọt',
            '1 ly cacao cà phê lớn',
            '1 ly matcha cà phê lớn, hơi ngọt nha',
        ].map((label, i) => ({ label, done: i < n }))
    },
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
        title: 'Nhật ký',
        items: (ctx) => [
            { label: 'Xem nhật ký doanh thu', done: ctx.journalProgress.viewedIncome },
            { label: 'Xem chi phí', done: ctx.journalProgress.viewedExpense },
            { label: 'Xem báo cáo', done: ctx.journalProgress.viewedReport },
        ],
    },
    // 3-4. Kết ca thực thu / tồn quầy — ghi từ DailyReportPage.jsx. Thẻ Thực thu nằm dưới mép
    // màn hình lúc vừa vào /daily-report nên việc đầu là kéo xuống cho thẻ hiện trọn.
    {
        title: 'Kết ca',
        items: (ctx) => [
            { label: 'Kéo xuống', done: reachedCashCard(ctx.cashFlowProgress) },
            { label: 'Nhập 60.000đ tiền mặt', done: ctx.cashFlowProgress.cash },
            { label: 'Nhập 40.000đ chuyển khoản', done: ctx.cashFlowProgress.transfer },
        ],
    },
    {
        title: 'Tồn kho',
        items: (ctx) => [
            { label: 'Nhập tồn cuối kỳ cà phê', done: ctx.inventoryProgress.coffee },
            { label: 'Nhập tồn cuối kỳ cacao', done: ctx.inventoryProgress.cacao },
        ],
    },
    // 5. Công thức "Cà phê đen" — không có nút riêng: hint mũi tên "tiến" ở header /history +
    // /daily-report dẫn tới /recipes (hintGoToRecipes, menuSequence.js), rồi card Cà phê đen →
    // input định lượng → "+ Thêm tùy chọn" (RecipeMenuPage.jsx/RecipeIngredientPage.jsx).
    {
        title: 'Công thức',
        items: (ctx) => [
            { label: 'Thêm định lượng', done: ctx.recipeProgress.filledAmount },
            { label: 'Tạo tùy chọn thêm', done: ctx.recipeProgress.addedExtra },
        ],
    },
    // 6. (CUỐI CÙNG) Cài đặt 1 nguyên liệu mẫu (Cà phê) — mũi tên "trở về" ở header /recipes tự
    // sáng hint (hintIngredientsTab) để dẫn về Tồn kho. Chưa có ingredient "Cà phê" → [] = vacuously done.
    {
        title: 'Nguyên liệu',
        items: ({ coffeeConfig, stockProgress }) => coffeeConfig
            ? INGREDIENT_SETUP_FIELDS.map(f => ({ label: f.label, done: f.done(coffeeConfig, stockProgress.coffeeWarehouseSet) }))
            : [],
    },
]
