import type { MouseEvent, ReactNode } from 'react'
import type { Row, UUID } from '../../types/domain'
import { useMonetizationEnabled } from '../../hooks/useEntitlement'
import { computeSubscriptionStatus, expiryTone } from '../../utils/subscriptionStatus'

/**
 * Trạng thái gói cước của 1 address card — 1 dòng chấm màu + chữ. Ẩn hẳn khi monetization OFF.
 *
 * Thứ tự ưu tiên:
 *   - không bán hàng hôm nay (hasActivity=false) → "Không hoạt động", che mọi nhánh khác
 *     (gate chỉ có mở/khoá báo cáo; trial/pending/paid chỉ là LÝ DO)
 *   - chưa có gói (0 row) → "Chưa đăng ký"; hết trial/ân hạn → "Hết dùng thử"
 *   - có gói → "Đang dùng thử" (note='trial'|'grace') | "Đã đăng ký" + còn X ngày. Lấy dòng valid_to muộn nhất
 *     làm gói hiệu lực nên paid nối tiếp trial hiện "Đã đăng ký". Chấm: ≤3 đỏ, ≤7 vàng, còn lại xanh.
 *
 * loading = rows thật chưa về (lúc này rỗng nên sẽ sai thành "Chưa đăng ký") → không render; ẩn
 * hẳn thay vì skeleton để footer không nhảy chiều cao.
 * rows lấy 1 lần cho TẤT CẢ địa chỉ ở AddressStatsContext (tránh N+1 request).
 * Render bằng <span role="button"> vì có thể nằm trong button cha (button lồng button gây hydration error).
 */
interface Props {
    addressId?: UUID | null
    rows?: Row[] | null
    hasActivity?: boolean
    loading?: boolean
    onRenewClick?: () => void
}

export default function SubscriptionBadge({ addressId, rows, hasActivity, loading, onRenewClick }: Props) {
    const { enabled } = useMonetizationEnabled()

    // Monetization OFF, hoặc chưa có addressId, hoặc rows thật chưa về → không render
    if (!enabled || !addressId || loading) return null

    const handleClick = (e: MouseEvent) => { e.stopPropagation(); onRenewClick?.() }

    if (!hasActivity) {
        return (
            <StatusLine
                id={`sub-badge-inactive-${addressId}`}
                onClick={handleClick}
                dotClass="bg-text-secondary"
                textClass="text-text-secondary"
            >
                Không hoạt động
            </StatusLine>
        )
    }

    const { status, daysLeft = 0, trialEnded } = computeSubscriptionStatus(rows)

    if (status === 'none') {
        return (
            <StatusLine
                id={`sub-badge-locked-${addressId}`}
                onClick={handleClick}
                dotClass="bg-primary"
                textClass="text-primary"
            >
                {trialEnded ? 'Hết dùng thử' : 'Chưa đăng ký'}
            </StatusLine>
        )
    }

    const tone = expiryTone(daysLeft)
    const dotClass = { danger: 'bg-danger', warning: 'bg-warning', success: 'bg-success' }[tone]
    // Chữ trầm (subtitle) cho trạng thái bình thường; chỉ đỏ lên khi gấp (≤3 ngày).
    const textClass = tone === 'danger' ? 'text-danger' : 'text-text-secondary'

    return (
        <StatusLine
            id={`sub-badge-status-${addressId}`}
            onClick={handleClick}
            dotClass={dotClass}
            textClass={textClass}
            right={`còn ${daysLeft} ngày`}
        >
            {status === 'trial' ? 'Đang dùng thử' : 'Đã đăng ký'}
        </StatusLine>
    )
}

// `right` (vd "Còn X ngày") tách hẳn sang lề phải hàng — chỉ nhánh trial/paid có, các nhánh
// còn lại (Không hoạt động/Chưa đăng ký) không truyền thì layout co lại
// bám trái như cũ.
function StatusLine({ id, onClick, dotClass, textClass, right, children }: { id: string; onClick: (e: MouseEvent) => void; dotClass: string; textClass: string; right?: string; children: ReactNode }) {
    return (
        <span
            id={id}
            role="button"
            tabIndex={0}
            onClick={onClick}
            className="w-full flex items-center justify-between gap-2 text-[12px] font-bold cursor-pointer active:opacity-70 transition-opacity"
        >
            <span className="inline-flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
                <span className={textClass}>{children}</span>
            </span>
            {right && <span className={textClass}>{right}</span>}
        </span>
    )
}
