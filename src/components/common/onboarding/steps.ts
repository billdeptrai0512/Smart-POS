import { isInventoryProgressDone, type OnboardingState } from '../../../utils/onboardingStorage'

// offerSignup: từ việc này trở đi dải guide hiện nút "Đăng ký" (OnboardingGuide.tsx).
// hideBar: tới việc này thì ẩn dải guide — nút cần bấm đã sáng, thêm chữ chỉ rối.
export interface StepItem { label: string; done: boolean; offerSignup?: boolean; hideBar?: boolean }
export interface Step { title: string; items: (ctx: OnboardingState) => StepItem[] }

// Kịch bản "một ngày của quán" (6 bước): đầu ca lấy hàng từ kho ra quầy → bán 1 đơn (app tự sinh cả ngày bán
// trước đó, localRepository.seedGuestDemoDay) → xem Nhật ký → Kết ca (két lệch 20k) → Kiểm kê (hao hụt) →
// Bổ sung tồn kho cho mai. Đi theo đúng thứ tự mũi tên "tiến" của menuSequence.ts (Nhật ký → Báo cáo → Tồn kho).
// Tiến độ do từng trang ghi vào localStorage (onboardingStorage.ts).
// ⚠ Thêm/bớt/đổi thứ tự bước → phải sửa guest_onboarding_funnel_stats() (nhãn mốc gắn theo VỊ TRÍ, bản mới
// nhất: 20261045_guest_onboarding_funnel_day_story.sql). track_guest_onboarding_stage nhận 0..6; stage vượt 6
// bị RPC bỏ qua IM LẶNG — phễu chết mà không báo lỗi gì.
export const STEPS: Step[] = [
    {
        title: 'Chuẩn bị',
        items: ({ prepProgress: p }) => [
            { label: `Lấy hàng từ kho ra quầy${p.total ? ` (${Math.min(p.taken, p.total)}/${p.total})` : ''}`, done: p.done },
        ],
    },
    {
        title: 'Bán hàng',
        items: ({ orderProgress: { sent } }) => [
            { label: 'KOPHiN xin chào ạ!', done: sent >= 1 },
        ],
    },
    {
        title: 'Nhật ký',
        items: ({ journalProgress: j }) => [
            { label: 'Xem bán hàng cả ngày', done: j.viewedIncome },
            { label: 'Xem chi phí', done: j.viewedExpense, hideBar: true },
            { label: 'Sang báo cáo kết ca', done: j.viewedReport, hideBar: true },
        ],
    },
    {
        title: 'Kết ca',
        items: ({ cashFlowProgress: c }) => [
            { label: 'Bấm ô Tiền mặt', done: c.cash, hideBar: true },
            { label: 'Bấm ô Chuyển khoản', done: c.transfer, hideBar: true },
        ],
    },
    {
        title: 'Kiểm kê',
        items: ({ inventoryProgress: i }) => [
            // Chi tiết Sử dụng + Lý thuyết còn đã hiện sẵn trên dòng, khách chỉ việc đếm → nhập Cuối kỳ. Số gợi ý nhập: `suggest` (tab Kiểm kê tính theo mấy ly pha
            // không bấm bill), chưa có thì Lý thuyết − 20g; rời ô là tự lưu.
            { label: 'Nhập Cuối kỳ cà phê', done: isInventoryProgressDone(i), offerSignup: true, hideBar: true },
        ],
    },
    {
        title: 'Bổ sung tồn kho',
        items: ({ restockProgress: r }) => [
            { label: 'Nhập kho thử 1 món, app nhập nốt phần còn lại', done: r.bought, hideBar: true },
            { label: 'Quay về Báo cáo xem Thực chi', done: r.viewedNet, hideBar: true },
        ],
    },
]
