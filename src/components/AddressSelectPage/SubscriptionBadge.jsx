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
            <span
                id={`sub-badge-locked-${addressId}`}
                role="button"
                tabIndex={0}
                onClick={handleClick}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 hover:bg-primary/25 active:scale-95 transition-all cursor-pointer"
            >
                <span className="text-[10px] font-black text-primary">Mở khoá báo cáo</span>
            </span>
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
            <span
                id={`sub-badge-expiring-${addressId}`}
                role="button"
                tabIndex={0}
                onClick={handleClick}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 border border-warning/25 hover:bg-warning/20 active:scale-95 transition-all cursor-pointer"
            >
                <span className="text-[10px] font-black text-warning">
                    Còn {minDaysLeft} ngày — Gia hạn
                </span>
            </span>
        )
    }

    // ── Active, còn > 3 ngày → hiển thị nhỏ, mờ (vẫn bấm vào /subscription để quản lý) ──
    return (
        <span
            id={`sub-badge-active-${addressId}`}
            role="button"
            tabIndex={0}
            onClick={handleClick}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-light hover:bg-border/40 active:scale-95 transition-all cursor-pointer"
        >
            <span className="text-[10px] font-medium text-text-dim">Đã đăng ký · còn {minDaysLeft} ngày</span>
        </span>
    )
}
