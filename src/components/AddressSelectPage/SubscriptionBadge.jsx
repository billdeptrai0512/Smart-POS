import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useMonetizationEnabled } from '../../hooks/useEntitlement'
import { startOfDayVN } from '../../utils/dateVN'

/**
 * SubscriptionBadge — hiển thị trạng thái gói cước cho từng address card.
 *
 * Khi monetization OFF → không render gì (ẩn hoàn toàn).
 *
 * 1 gói all-access (xem MONETIZATION.md §6.B):
 *   - active, còn > 3 ngày  → "Đã đăng ký · còn X ngày" (mờ, nhỏ, click → /subscription)
 *   - active, còn ≤ 3 ngày  → "Còn X ngày — Gia hạn" (warning, click → /subscription)
 *   - chưa có gói           → "Mở khoá báo cáo" (primary, click → /subscription)
 *
 * ⚠️ Render bằng <span> (không phải <button>) vì badge nằm BÊN TRONG button card
 *    của BranchGrid — button lồng button gây hydration error. span + onClick hợp lệ.
 *
 * Props:
 *   addressId: UUID
 *   onRenewClick: () => void   — điều hướng tới /subscription (passed from parent)
 */
export default function SubscriptionBadge({ addressId, onRenewClick }) {
    const { enabled } = useMonetizationEnabled()
    const [activeTiers, setActiveTiers] = useState([])
    const [loaded, setLoaded] = useState(false)

    // Không fetch gì khi monetization OFF (client build hoặc server app_config)
    useEffect(() => {
        if (!enabled || !addressId) {
            // Intentional: nothing to fetch, mark loaded so render resolves.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLoaded(true)
            return
        }

        supabase
            .rpc('get_address_entitlement', { p_address_id: addressId })
            .then(({ data }) => {
                const rows = Array.isArray(data) ? data : (data ? [data] : [])
                setActiveTiers(rows)
            })
            .finally(() => setLoaded(true))
    }, [addressId, enabled])

    // Monetization OFF hoặc chưa load xong → không render
    if (!enabled || !loaded) return null

    // ── Tính số ngày còn lại ────────────────────────────────────────────────────
    const today = startOfDayVN()

    const handleClick = (e) => { e.stopPropagation(); onRenewClick?.() }

    if (activeTiers.length === 0) {
        return (
            <div className="flex items-baseline gap-1.5 text-sm">
                <span className="text-text-secondary shrink-0">Trạng thái:</span>
                <span
                    id={`sub-badge-locked-${addressId}`}
                    role="button"
                    tabIndex={0}
                    onClick={handleClick}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25 active:scale-95 transition-all cursor-pointer"
                >
                    Chưa đăng ký
                </span>
            </div>
        )
    }

    let minDaysLeft = Infinity;
    activeTiers.forEach(t => {
        if (t.valid_to) {
            const expiry = startOfDayVN(new Date(t.valid_to))
            const daysLeft = Math.round((expiry - today) / (1000 * 60 * 60 * 24))
            minDaysLeft = Math.min(minDaysLeft, daysLeft)
        }
    })

    // ── Còn ≤ 3 ngày → warning + gia hạn ────────────────────────────────────
    if (minDaysLeft <= 3) {
        return (
            <div className="flex items-baseline gap-1.5 text-sm">
                <span className="text-text-secondary shrink-0">Trạng thái:</span>
                <span
                    id={`sub-badge-expiring-${addressId}`}
                    role="button"
                    tabIndex={0}
                    onClick={handleClick}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-warning/10 border border-warning/25 text-warning hover:bg-warning/20 active:scale-95 transition-all cursor-pointer"
                >
                    Còn {minDaysLeft} ngày — Gia hạn
                </span>
            </div>
        )
    }

    // ── Active, còn > 3 ngày → hiển thị nhỏ, mờ (vẫn bấm vào /subscription để quản lý) ──
    return (
        <div className="flex items-baseline gap-1.5 text-sm">
            <span className="text-text-secondary shrink-0">Trạng thái:</span>
            <span
                id={`sub-badge-active-${addressId}`}
                role="button"
                tabIndex={0}
                onClick={handleClick}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-success/10 border border-success/25 text-success hover:bg-success/20 active:scale-95 transition-all cursor-pointer"
            >
                Còn {minDaysLeft} ngày
            </span>
        </div>
    )
}
