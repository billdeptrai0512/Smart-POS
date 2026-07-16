import { startOfDayVN } from './dateVN'

// Gói hiệu lực = dòng valid_to muộn nhất trong các dòng còn hạn hôm nay.
// Paid nối tiếp trial → dòng muộn nhất là paid → status 'paid'.
// Dùng chung giữa SubscriptionBadge (hiển thị) và fetchSubscriptionStatuses (sort danh sách).
export function computeSubscriptionStatus(rows) {
    const today = startOfDayVN()
    const active = (rows || []).filter(r => {
        const from = startOfDayVN(new Date(r.valid_from))
        const to = startOfDayVN(new Date(r.valid_to))
        return from <= today && today <= to
    })
    if (active.length === 0) return { status: 'none', validTo: null }
    const dominant = active.reduce((a, b) => (b.valid_to > a.valid_to ? b : a))
    return {
        status: dominant.note === 'trial' ? 'trial' : 'paid',
        daysLeft: Math.round((startOfDayVN(new Date(dominant.valid_to)) - today) / 86400000),
        validTo: dominant.valid_to,
    }
}
