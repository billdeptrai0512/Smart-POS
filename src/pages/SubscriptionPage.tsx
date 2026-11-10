import { useLocation, useNavigate, Navigate } from 'react-router-dom'
import SubscriptionScreen from '../components/common/SubscriptionScreen'
import { useMonetizationEnabled } from '../hooks/useEntitlement'
import { useAddress } from '../contexts/AddressContext'
import { EXPIRED_GRACE_DAYS, type AccessGate } from '../utils/subscriptionStatus'

// Dòng nhắc theo trạng thái cổng (AddressSelectPage → computeAccessGate).
function gateNotice({ level, days }: AccessGate) {
    if (level === 'warn') return days <= 0 ? 'Gói hết hạn hôm nay.' : `Gói còn ${days} ngày.`
    if (level === 'hard') return 'Đăng ký gói để tiếp tục sử dụng.'
    const remain = EXPIRED_GRACE_DAYS - days
    return `Gói đã hết hạn ${days} ngày. ${remain > 0 ? `Sau ${remain} ngày nữa sẽ bị khoá.` : 'Đây là ngày cuối được bỏ qua.'}`
}

/**
 * SubscriptionPage — route /subscription. Vỏ mỏng đọc nav state rồi render
 * <SubscriptionScreen> (UI đăng ký gói dùng chung). Dùng cho luồng từ
 * SubscriptionBadge và cổng gói ở AddressSelectPage.
 *
 * Nav state: { preselectAddressId, from, gate?, skipTo?, skipState? }
 *   gate + skipTo (cổng gói): hiện dòng nhắc; level ≠ 'hard' thì có nút "Bỏ qua" (và "Xong" sau
 *   khi trả tiền) đưa vào địa chỉ → skipTo. 'hard' không có đường vào, chỉ có back.
 */
export default function SubscriptionPage() {
    const location = useLocation()
    const navigate = useNavigate()
    const { addresses, setSelectedAddress } = useAddress()
    const { enabled, loading } = useMonetizationEnabled()

    // Đang đọc server flag → chờ (tránh redirect nhầm trước khi biết trạng thái).
    if (loading) return null
    // Monetization OFF (client build hoặc server app_config) → không có trang đăng ký.
    if (!enabled) {
        return <Navigate to="/pos" replace />
    }

    const { preselectAddressId, from, gate, skipTo, skipState } = location.state || {}
    const addr = addresses.find(a => a.id === preselectAddressId)
    const enter = skipTo && addr
        ? () => { setSelectedAddress(addr); navigate(skipTo, { replace: skipTo === '/pos', state: skipState }) }
        : undefined

    return (
        <SubscriptionScreen
            backTo={from || '/addresses'}
            preselectAddressId={preselectAddressId}
            notice={gate ? gateNotice(gate) : undefined}
            onSkip={gate?.level === 'hard' ? undefined : enter} // hard: chỉ vào được sau khi trả tiền (onDone)
            onDone={enter}
        />
    )
}
