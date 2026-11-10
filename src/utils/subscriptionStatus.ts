import { startOfDayVN } from './dateVN'
import type { Row } from '../types/domain'

// Gói hiệu lực = dòng valid_to muộn nhất trong các dòng còn hạn hôm nay.
// Paid nối tiếp trial → dòng muộn nhất là paid → status 'paid'.
// Dùng chung giữa SubscriptionBadge (hiển thị) và fetchSubscriptionStatuses (sort danh sách).
// Độ gấp theo số ngày còn lại — dùng chung chấm của SubscriptionBadge và pill trong sheet chọn địa chỉ.
export const expiryTone = (daysLeft: number) => daysLeft <= 3 ? 'danger' : daysLeft <= RENEW_WARN_DAYS ? 'warning' : 'success'

// Cổng vào địa chỉ: nhắc gia hạn khi còn ≤ RENEW_WARN_DAYS (cũng là mốc chấm vàng của badge); hết hạn thì
// vẫn "Bỏ qua" được EXPIRED_GRACE_DAYS ngày, sau đó khoá cứng.
// ⚠️ EXPIRED_GRACE_DAYS phải khớp `valid_to + 3` trong get_address_entitlement (20261044).
export const RENEW_WARN_DAYS = 7
const EXPIRED_GRACE_DAYS = 3

// remind = mở paywall nhưng còn "Bỏ qua" được (sắp hết hạn, hoặc trong ân hạn sau hết hạn).
export type AccessGate = 'ok' | 'remind' | 'hard'

// rows == null (chưa tải / lỗi mạng) → 'ok': fail-open. [] = chưa từng đăng ký → 'hard'.
export function computeAccessGate(rows?: Row[] | null): AccessGate {
    if (!rows) return 'ok'
    if (rows.length === 0) return 'hard'
    const s = computeSubscriptionStatus(rows)
    if (s.status !== 'none') return s.daysLeft! <= RENEW_WARN_DAYS ? 'remind' : 'ok'
    const latest = rows.reduce((a, b) => (b.valid_to > a.valid_to ? b : a))
    const days = Math.round((startOfDayVN().getTime() - startOfDayVN(new Date(latest.valid_to)).getTime()) / 86400000)
    return days <= EXPIRED_GRACE_DAYS ? 'remind' : 'hard'
}

export function computeSubscriptionStatus(rows?: Row[] | null) {
    const today = startOfDayVN()
    const active = (rows || []).filter(r => {
        const from = startOfDayVN(new Date(r.valid_from))
        const to = startOfDayVN(new Date(r.valid_to))
        return from <= today && today <= to
    })
    if (active.length === 0) {
        // Không dòng nào còn hạn: 0 dòng = chưa đăng ký; dòng muộn nhất là trial/grace = hết dùng thử.
        const latest = (rows || []).reduce<Row | null>((a, b) => (!a || b.valid_to > a.valid_to ? b : a), null)
        return { status: 'none', validTo: null, trialEnded: latest?.note === 'trial' || latest?.note === 'grace' }
    }
    const dominant = active.reduce((a, b) => (b.valid_to > a.valid_to ? b : a))
    return {
        // 'grace' = ân hạn chuyển đổi 3 ngày (20261044) → hiển thị như dùng thử.
        status: dominant.note === 'trial' || dominant.note === 'grace' ? 'trial' : 'paid',
        daysLeft: Math.round((startOfDayVN(new Date(dominant.valid_to)).getTime() - today.getTime()) / 86400000),
        validTo: dominant.valid_to,
    }
}
