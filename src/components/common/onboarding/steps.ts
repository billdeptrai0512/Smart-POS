import { isRecipeProgressDone, isInventoryProgressDone, type OnboardingState } from '../../../utils/onboardingStorage'

// recipeRows: các dòng định lượng hiện có của công thức RECIPE_TARGET_PRODUCT (đã xếp theo thứ tự hiển thị).
export interface StepCtx extends OnboardingState {
    recipeRows: { ingredient: string; amount: number }[]
}
// offerSignup: từ việc này trở đi dải guide hiện nút "Đăng ký" (OnboardingGuide.tsx) — khách đã đi đủ vòng để thấy giá trị.
export interface StepItem { label: string; done: boolean; offerSignup?: boolean }
export interface Step { title: string; items: (ctx: StepCtx) => StepItem[] }

// Single source of truth for phase 5's anchor product — RecipeMenuPage.tsx (card hint) and
// RecipeIngredientPage.tsx (input/extras hints) both match against this instead of each
// hardcoding the name.
export const RECIPE_TARGET_PRODUCT = 'cà phê đen'

// Đã đi tới đủ xa (prevDone) mà phase 5 chưa xong → hint mũi tên "tiến" ở header để đi tiếp tới
// /category. Dùng chung bởi DailyReportPage/HistoryPage/IngredientManagementPage — tách ra đây để
// các trang khỏi tự viết lại cùng 1 công thức.
export const isRecipeStepActive = (prevDone: boolean, recipeProgress: OnboardingState['recipeProgress']) =>
    prevDone && !isRecipeProgressDone(recipeProgress)

// Bước 1 "Tạo đơn" — 2 đơn: cà phê sữa; rồi cacao cà phê lớn + matcha cà phê lớn (xem ORDERS trong
// useOrderOnboardingProgress.ts — số tiền ở bước Kết ca phụ thuộc doanh thu của 2 đơn này).
// Mỗi dòng done theo `sent` (số đơn đã gửi thật, ghi bởi useOrderOnboardingProgress.ts). Không
// đòi viewedHistory — đó là việc của bước 2. Export riêng vì HistoryPage.tsx cần biết bước này
// xong chưa.
export const orderStep = {
    title: 'Tạo đơn',
    // n = số dòng đã xong: dòng 1 khi gửi đơn 1; dòng 2 ngay lúc chọn xong cacao (`picked`, tối đa
    // 1 dù matcha cũng đã chọn); dòng 3 (matcha) chỉ khi gửi đơn 2 = bấm Tạo đơn → xong bước 1.
    items: ({ orderProgress: { sent, picked = 0, ready } }: Pick<StepCtx, 'orderProgress'>) => {
        const n = sent >= 2 ? 3 : sent === 1 ? 1 + Math.min(picked, 1) : 0
        return [
            'Khách gọi 1 cà phê sữa',
            'Cho mình 1 ly cacao cà phê lớn',
            '1 matcha cà phê lớn và ngọt',
        ].map((label, i) => ({
            // Đủ món → việc kế tiếp là bấm nút, không phải gọi thêm món.
            label: ready && i === n ? 'Bấm "Tạo đơn"' : label,
            done: i < n,
        }))
    },
} satisfies Step

// 5 bước onboarding khách dùng thử — mỗi bước là items(ctx) → [{ label, done }], xong khi mọi
// item done. Tiến độ do từng trang ghi vào localStorage (xem onboardingStorage.ts).
// ⚠ Thêm/bớt bước ở đây → phải sửa guest_onboarding_funnel_stats() (CASE nhãn, generate_series,
// max_stage >= N — bản mới nhất: 20261018_guest_onboarding_funnel_five_steps.sql) rồi chạy lại.
// ⚠ Nhãn mốc trong SQL gắn theo VỊ TRÍ (3 = "Kết ca đếm tiền", 4 = "Kiểm kê tồn kho"); thứ tự hiện tại
// là Tồn kho rồi Kết ca nên AdminDashboardPage.tsx (stageLabel) đảo 2 nhãn đó ở client.
// CHECK 0..6 của track_guest_onboarding_stage cố ý giữ nguyên (client cũ còn gửi 6); stage vượt 6
// thì bị RPC bỏ qua IM LẶNG — phễu chết mà không báo lỗi gì.
export const STEPS: Step[] = [
    orderStep,
    // 2. Nhật ký — 3 tab của /history (HistoryTabsBar.tsx). viewedIncome tick ngay khi vào
    // /history (Doanh thu là tab mặc định) nên nhãn là "Vào nhật ký" — lúc này user còn đứng ở
    // POS. Chi phí tick khi user tự bấm tab; viewedReport tick khi bấm mũi tên "tiến" sang trang kế
    // (Tồn kho — thứ tự trong menuSequence.ts) — ghi từ HistoryPage.tsx.
    {
        title: 'Nhật ký',
        items: (ctx) => [
            { label: 'Xem nhật ký bán hàng', done: ctx.journalProgress.viewedIncome },
            { label: 'Xem chi phí', done: ctx.journalProgress.viewedExpense },
            { label: 'Xem tồn kho', done: ctx.journalProgress.viewedReport },
        ],
    },
    // 3. Tồn kho (đếm tồn trước, để hao hụt có sẵn khi xem lợi nhuận) — ghi từ tab Kiểm kê của /inventory.
    {
        title: 'Tồn kho',
        items: (ctx) => [
            // 3 câu hỏi: đã dùng bao nhiêu → máy tính còn bao nhiêu → mình đếm được bao nhiêu (nhập). `|| coffee`:
            // khách nhập luôn mà không bấm xem 2 ô đầu thì vẫn không kẹt ở đây. `theory` = số Lý thuyết hiện tại
            // của cà phê, do dòng kiểm kê ghi lại (đổi theo số đơn khách bấm thử).
            { label: 'Xem chi tiết đã sử dụng', done: ctx.inventoryProgress.usedOpened || ctx.inventoryProgress.coffee },
            {
                label: `Theo công thức, bạn sẽ còn ${ctx.inventoryProgress.theory ? `${ctx.inventoryProgress.theory}g ` : ''}cà phê`,
                done: ctx.inventoryProgress.theoryOpened || ctx.inventoryProgress.coffee,
            },
            { label: ctx.inventoryProgress.typed ? 'Bấm "Lưu"' : 'Nhập tồn cuối kỳ, ví dụ 940g', done: isInventoryProgressDone(ctx.inventoryProgress) },
        ],
    },
    // 4. Kết ca thực thu — ghi từ DailyReportPage.tsx (CashFlowCard tự cuộn thẻ Thực thu vào màn hình).
    {
        title: 'Kết ca',
        items: (ctx) => [
            { label: 'Nhập 40.000đ tiền mặt', done: ctx.cashFlowProgress.cash },
            { label: 'Nhập 23.000đ tiền chuyển khoản', done: ctx.cashFlowProgress.transfer },
            { label: 'Xem báo cáo lợi nhuận', done: ctx.journalProgress.viewedProfit, offerSignup: true },
        ],
    },
    // 5. Công thức "Cà phê đen" — không có nút riêng: hint mũi tên "tiến" ở header /report
    // dẫn tới /category (hintGoToRecipes, menuSequence.ts) → xem Menu → tab Công thức → card
    // Cà phê đen → các dòng định lượng có sẵn gộp thành 1 việc → "+ Thêm tùy chọn"
    // (RecipeMenuPage.tsx/RecipeIngredientPage.tsx). Chưa có dòng nào (chưa tải xong / đã xoá hết) thì
    // chưa xong cho tới khi cờ filledAmount bật.
    {
        title: 'Công thức',
        items: ({ recipeProgress, recipeRows }) => [
            { label: 'Xem danh mục menu', done: recipeProgress.viewedMenu },
            { label: 'Xem danh mục công thức', done: recipeProgress.viewedRecipes },
            // Mọi dòng định lượng gộp thành 1 việc; cờ filledAmount chỉ lên không xuống nên xong là xong.
            { label: 'Nhập định lượng', done: recipeProgress.filledAmount || (recipeRows.length > 0 && recipeRows.every(r => r.amount > 0)) },
            { label: 'Thêm tùy chọn', done: recipeProgress.addedExtra },
        ],
    },
]
