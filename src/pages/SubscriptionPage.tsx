import { useLocation, useNavigate, Navigate } from 'react-router-dom'
import SubscriptionScreen from '../components/common/SubscriptionScreen'
import { useMonetizationEnabled } from '../hooks/useEntitlement'
import { useAddress } from '../contexts/AddressContext'
import { useAddressStats } from '../contexts/AddressStatsContext'
import { useAuth } from '../contexts/AuthContext'
import { computeAccessGate } from '../utils/subscriptionStatus'

/**
 * SubscriptionPage — route /subscription. Vỏ mỏng đọc nav state rồi render
 * <SubscriptionScreen> (UI đăng ký gói dùng chung). Dùng cho luồng từ
 * SubscriptionBadge, cổng gói ở AddressSelectPage và trang báo cáo bị khoá.
 *
 * Nav state: { preselectAddressId, from, locked?, skipTo?, skipState? }
 *   "Bỏ qua" (và "Xong" sau khi trả tiền) → vào địa chỉ preselect, tới skipTo (mặc định /pos).
 *   Khoá cứng (tính tại chỗ từ rows, không tin nav state) → "Bỏ qua" bị disable. Admin luôn bỏ qua được.
 */
export default function SubscriptionPage() {
    const location = useLocation()
    const navigate = useNavigate()
    const { addresses, setSelectedAddress } = useAddress()
    const { subscriptionRowsMap } = useAddressStats()
    const { isAdmin } = useAuth()
    const { enabled, loading } = useMonetizationEnabled()

    // Đang đọc server flag → chờ (tránh redirect nhầm trước khi biết trạng thái).
    if (loading) return null
    const { preselectAddressId, from, locked, skipTo = '/pos', skipState } = location.state || {}
    // Monetization OFF (client build hoặc server app_config) → không có trang đăng ký: đi tiếp tới đích (vd Danh mục
    // của địa chỉ vừa tạo, đã chọn sẵn) thay vì /pos.
    if (!enabled) return <Navigate to={skipTo} replace state={skipState} />
    const addr = addresses.find(a => a.id === preselectAddressId)
    const enter = addr
        ? () => { setSelectedAddress(addr); navigate(skipTo, { replace: skipTo === '/pos', state: skipState }) }
        : undefined
    // locked (từ cổng /addresses) chỉ làm chặt hơn, không nới được → nav state giả cũng không lách được.
    const hard = !isAdmin && (locked || computeAccessGate(subscriptionRowsMap[preselectAddressId]) === 'hard')

    return (
        <SubscriptionScreen
            backTo={from || '/addresses'}
            preselectAddressId={preselectAddressId}
            onSkip={hard ? undefined : enter} // hard: chỉ vào được sau khi trả tiền (onDone)
            onDone={enter}
        />
    )
}
