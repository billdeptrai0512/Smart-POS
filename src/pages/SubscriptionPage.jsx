import { useLocation } from 'react-router-dom'
import SubscriptionScreen from '../components/common/SubscriptionScreen'

/**
 * SubscriptionPage — route /subscription. Vỏ mỏng đọc nav state rồi render
 * <SubscriptionScreen> (UI đăng ký gói dùng chung). Dùng cho luồng từ
 * SubscriptionBadge ở AddressSelectPage.
 *
 * Nav state: { preselectModule, preselectAddressId, from }
 */
export default function SubscriptionPage() {
    const location = useLocation()
    return (
        <SubscriptionScreen
            backTo={location.state?.from || '/addresses'}
            preselectModule={location.state?.preselectModule}
            preselectAddressId={location.state?.preselectAddressId}
        />
    )
}
