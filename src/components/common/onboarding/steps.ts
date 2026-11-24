import { isInventoryProgressDone, type OnboardingState } from '../../../utils/onboardingStorage'

// hideBar: tới việc này thì ẩn dải guide — nút cần bấm đã sáng, thêm chữ chỉ rối. Việc hideBar không có label:
// chữ dẫn của nó (nếu có) nằm ở pageGuide / journalOnPos trong OnboardingGuide.tsx.
export interface StepItem { label?: string; done: boolean; hideBar?: boolean }
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
            { label: 'Chạm vào món để thêm vào đơn', done: sent >= 1 },
        ],
    },
    {
        title: 'Nhật ký',
        items: ({ journalProgress: j }) => [
            { done: j.viewedReport, hideBar: true }, // bấm sang báo cáo kết ca
        ],
    },
    {
        title: 'Kết ca',
        items: ({ cashFlowProgress: c }) => [
            { done: c.cash && c.transfer, hideBar: true }, // bấm ô Tiền mặt và Chuyển khoản
        ],
    },
    {
        title: 'Kiểm kê',
        items: ({ inventoryProgress: i }) => [
            // Chi tiết Sử dụng + Lý thuyết còn đã hiện sẵn trên dòng, khách chỉ việc đếm → nhập Cuối kỳ. Số gợi ý nhập: `suggest` (tab Kiểm kê tính theo mấy ly pha
            // không bấm bill), chưa có thì Lý thuyết − 20g; rời ô là tự lưu.
            { done: isInventoryProgressDone(i), hideBar: true }, // nhập Cuối kỳ cà phê
        ],
    },
    {
        title: 'Bổ sung tồn kho',
        items: ({ restockProgress: r }) => [
            // Xong là Đóng sheet → app tự đưa về Báo cáo xem Thực chi (WarehousePrepNotice), không còn là việc của khách.
            { done: r.bought, hideBar: true }, // nhập kho thử 1 món, app nhập nốt phần còn lại
        ],
    },
]
