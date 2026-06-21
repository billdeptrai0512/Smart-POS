import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useMonetizationEnabled } from '../../hooks/useEntitlement'
import { startOfDayVN } from '../../utils/dateVN'

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
 * Trial = dòng note='trial'. Đọc trực tiếp address_subscriptions (RLS addr_sub_select
 * cho phép) vì RPC get_address_entitlement không trả `note`. Lấy dòng valid_to muộn
 * nhất làm gói hiệu lực → paid nối tiếp trial thì hiện "Đã đăng ký".
 *
 * ⚠️ Render bằng <span> (không phải <button>) vì badge nằm BÊN TRONG button card
 *    của BranchGrid — button lồng button gây hydration error. span + onClick hợp lệ.
 *
 * Props:
 *   addressId: UUID
 *   onRenewClick: () => void   — điều hướng tới /subscription (passed from parent)
 */
// Cache entitlement rows theo addressId (module-level). Badge bị unmount/mount lại
// mỗi lần mở/đóng menu "thao tác khác" của card → không cache thì mỗi lần mount lại
// phải fetch, nháy trống chờ load. Gói cước gần như không đổi trong 1 phiên.
const entitlementCache = new Map()

export default function SubscriptionBadge({ addressId, onRenewClick }) {
    const { enabled } = useMonetizationEnabled()
    const [rows, setRows] = useState(() => entitlementCache.get(addressId) ?? [])
    const [loaded, setLoaded] = useState(() => entitlementCache.has(addressId))

    // Không fetch gì khi monetization OFF (client build hoặc server app_config)
    useEffect(() => {
        if (!enabled || !addressId) {
            // Intentional: nothing to fetch, mark loaded so render resolves.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLoaded(true)
            return
        }
        // Đã có cache (vd vừa đóng menu thao tác) → initializer đã seed sẵn, khỏi fetch lại.
        if (entitlementCache.has(addressId)) return

        supabase
            .from('address_subscriptions')
            .select('valid_from, valid_to, note')
            .eq('address_id', addressId)
            .then(({ data }) => {
                const r = Array.isArray(data) ? data : []
                entitlementCache.set(addressId, r)
                setRows(r)
            })
            .finally(() => setLoaded(true))
    }, [addressId, enabled])

    // Monetization OFF hoặc chưa load xong → không render
    if (!enabled || !loaded) return null

    const today = startOfDayVN()
    const handleClick = (e) => { e.stopPropagation(); onRenewClick?.() }

    // Dòng còn hiệu lực hôm nay (valid_from ≤ today ≤ valid_to).
    const active = rows.filter(r => {
        const from = startOfDayVN(new Date(r.valid_from))
        const to = startOfDayVN(new Date(r.valid_to))
        return from <= today && today <= to
    })

    if (active.length === 0) {
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

    // Gói hiệu lực = dòng valid_to muộn nhất (valid_to là 'YYYY-MM-DD' → so sánh chuỗi
    // = so sánh ngày). Paid nối tiếp trial → dòng muộn nhất là paid.
    const dominant = active.reduce((a, b) => (b.valid_to > a.valid_to ? b : a))
    const isTrial = dominant.note === 'trial'
    const daysLeft = Math.round((startOfDayVN(new Date(dominant.valid_to)) - today) / 86400000)

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
            {isTrial ? 'Đang dùng thử' : 'Đã đăng ký'} · còn {daysLeft} ngày
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
