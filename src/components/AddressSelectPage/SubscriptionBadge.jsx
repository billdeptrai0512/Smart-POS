import { useMonetizationEnabled } from '../../hooks/useEntitlement'
import { computeSubscriptionStatus } from '../../utils/subscriptionStatus'

/**
 * SubscriptionBadge — hiển thị trạng thái gói cước cho từng address card.
 *
 * Khi monetization OFF → không render gì (ẩn hoàn toàn).
 *
 * 1 dòng status mảnh dưới tên quán (subtitle) — chấm màu + chữ:
 *   - đã trả      → ● Đã đăng ký · còn X ngày
 *   - trial       → ● Đang dùng thử · còn X ngày
 *   - chưa có gói → ● Chưa đăng ký   (click → /subscription)
 * Chấm đổi màu theo độ gấp: ≤3 đỏ, ≤14 vàng, còn lại xanh.
 *
 * Trial = dòng note='trial'. Lấy dòng valid_to muộn nhất làm gói hiệu lực → paid
 * nối tiếp trial thì hiện "Đã đăng ký".
 *
 * `pending` = địa chỉ CHƯA từng chốt ca full lần nào (0 row address_subscriptions)
 * → đang free tạm, không đếm ngược (mỗi địa chỉ độc lập, không giới hạn theo SĐT —
 * xem docs/MONETIZATION.md §1 Trial + migration 20260717_trial_4_per_address_not_per_phone.sql).
 * Hiện "Đang dùng thử" giống trial thật nhưng KHÔNG có "· còn X ngày" (chưa có gì để đếm).
 *
 * ⚠️ Render bằng <span> (không phải <button>) vì badge nằm BÊN TRONG button card
 *    của BranchGrid — button lồng button gây hydration error. span + onClick hợp lệ.
 *
 * Props:
 *   addressId: UUID
 *   rows: [{valid_from, valid_to, note}] — address_subscriptions rows của address này,
 *     fetch 1 lần cho TẤT CẢ địa chỉ ở AddressStatsContext (không tự fetch per-card,
 *     tránh N+1 request khi danh sách có nhiều chi nhánh).
 *   pending: bool — từ subscriptionStatusMap[addressId] === 'pending' (suy ra
 *     trực tiếp từ rows rỗng trong fetchSubscriptionStatuses, không cần RPC riêng).
 *   loading: bool — chưa có kết quả fetch thật → không render (rows lúc này luôn
 *     rỗng/undefined nên nếu vẫn render sẽ sai thành "Chưa đăng ký"). Ẩn hẳn thay vì
 *     skeleton để nút "Thao tác khác" đứng một mình trong hàng flex justify-between
 *     → tự dạt về sát trái, không nhảy vị trí khi badge xuất hiện.
 *   onRenewClick: () => void   — điều hướng tới /subscription (passed from parent)
 */
export default function SubscriptionBadge({ addressId, rows, pending, loading, onRenewClick }) {
    const { enabled } = useMonetizationEnabled()

    // Monetization OFF, hoặc chưa có addressId, hoặc rows thật chưa về → không render
    if (!enabled || !addressId || loading) return null

    const handleClick = (e) => { e.stopPropagation(); onRenewClick?.() }
    const { status, daysLeft } = computeSubscriptionStatus(rows)

    if (status === 'none' && pending) {
        return (
            <StatusLine
                id={`sub-badge-pending-${addressId}`}
                onClick={handleClick}
                dotClass="bg-success"
                textClass="text-text-secondary"
            >
                Đang dùng thử
            </StatusLine>
        )
    }

    if (status === 'none') {
        return (
            <StatusLine
                id={`sub-badge-locked-${addressId}`}
                onClick={handleClick}
                dotClass="bg-primary"
                textClass="text-primary"
            >
                Chưa đăng ký
            </StatusLine>
        )
    }

    const dotClass = daysLeft <= 3 ? 'bg-danger' : daysLeft <= 14 ? 'bg-warning' : 'bg-success'
    // Chữ trầm (subtitle) cho trạng thái bình thường; chỉ đỏ lên khi gấp (≤3 ngày).
    const textClass = daysLeft <= 3 ? 'text-danger' : 'text-text-secondary'

    return (
        <StatusLine
            id={`sub-badge-status-${addressId}`}
            onClick={handleClick}
            dotClass={dotClass}
            textClass={textClass}
        >
            {status === 'trial' ? 'Đang dùng thử' : 'Đã đăng ký'} · còn {daysLeft} ngày
        </StatusLine>
    )
}

function StatusLine({ id, onClick, dotClass, textClass, children }) {
    return (
        <span
            id={id}
            role="button"
            tabIndex={0}
            onClick={onClick}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold cursor-pointer active:opacity-70 transition-opacity"
        >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
            <span className={textClass}>{children}</span>
        </span>
    )
}
