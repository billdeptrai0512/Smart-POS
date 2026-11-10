import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useMonetizationEnabled } from '../../hooks/useEntitlement'
import { fetchSubscriptionStatuses } from '../../services/authService'
import { computeAccessGate } from '../../utils/subscriptionStatus'
import { onTabReturn } from '../../utils/tabVisibility'

const RECHECK_MS = 10 * 60_000

// Cổng /addresses chỉ chạy lúc bấm vào địa chỉ; app để mở qua đêm hoặc mở thẳng /pos từ cache thì không
// qua đó. Guard kiểm tra lại (dữ liệu mới, không cache) lúc vào / mỗi 10 phút / khi quay lại tab:
// khoá cứng → về /addresses. Lỗi mạng → bỏ qua (fail-open).
export default function SubscriptionGuard() {
    const { addressId } = useAddress()
    const { isAdmin, isGuest } = useAuth()
    const { enabled } = useMonetizationEnabled()
    const navigate = useNavigate()

    useEffect(() => {
        if (!enabled || isAdmin || isGuest || !addressId) return // addressId null = "Mẫu mặc định"
        let cancelled = false
        const check = async () => {
            const res = await fetchSubscriptionStatuses([addressId])
            if (cancelled || !res) return
            if (computeAccessGate(res.rowsMap[addressId]).level === 'hard') navigate('/addresses', { replace: true })
        }
        check()
        const id = setInterval(check, RECHECK_MS)
        const offTabReturn = onTabReturn(check)
        return () => { cancelled = true; clearInterval(id); offTabReturn() }
    }, [enabled, isAdmin, isGuest, addressId, navigate])

    return null
}
