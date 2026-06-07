import { useLocation, Navigate } from 'react-router-dom'
import SubscriptionScreen from '../components/common/SubscriptionScreen'
import { MONETIZATION_ENABLED_FLAG } from '../hooks/useEntitlement'

/**
 * SubscriptionPage — route /subscription. Vỏ mỏng đọc nav state rồi render
 * <SubscriptionScreen> (UI đăng ký gói dùng chung). Dùng cho luồng từ
 * SubscriptionBadge ở AddressSelectPage.
 *
 * Nav state: { preselectModule, preselectAddressId, from }
 */
export default function SubscriptionPage() {
    const location = useLocation()

    if (!MONETIZATION_ENABLED_FLAG) {
        return <Navigate to="/pos" replace />
    }

    return (
        <SubscriptionScreen
            backTo={location.state?.from || '/addresses'}
            preselectModule={location.state?.preselectModule}
            preselectAddressId={location.state?.preselectAddressId}
        />
    )
}
