import { useLocation, Navigate } from 'react-router-dom'
import SubscriptionScreen from '../components/common/SubscriptionScreen'
import { useMonetizationEnabled } from '../hooks/useEntitlement'

/**
 * SubscriptionPage — route /subscription. Vỏ mỏng đọc nav state rồi render
 * <SubscriptionScreen> (UI đăng ký gói dùng chung). Dùng cho luồng từ
 * SubscriptionBadge ở AddressSelectPage.
 *
 * Nav state: { preselectAddressId, from }
 */
export default function SubscriptionPage() {
    const location = useLocation()
    const { enabled, loading } = useMonetizationEnabled()

    // Đang đọc server flag → chờ (tránh redirect nhầm trước khi biết trạng thái).
    if (loading) return null
    // Monetization OFF (client build hoặc server app_config) → không có trang đăng ký.
    if (!enabled) {
        return <Navigate to="/pos" replace />
    }

    return (
        <SubscriptionScreen
            backTo={location.state?.from || '/addresses'}
            preselectAddressId={location.state?.preselectAddressId}
        />
    )
}
