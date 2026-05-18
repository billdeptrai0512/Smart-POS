import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { MONETIZATION_ENABLED_FLAG } from '../../hooks/useEntitlement'
import { startOfDayVN } from '../../utils/dateVN'

/**
 * SubscriptionBadge — hiển thị trạng thái gói cước cho từng address card.
 *
 * Khi MONETIZATION_ENABLED=false → không render gì (ẩn hoàn toàn).
 *
 * Trạng thái hiển thị theo §6.C của MONETIZATION.md:
 *   - tier=pro/basic, còn > 3 ngày → "Pro · còn X ngày" (mờ, nhỏ)
 *   - còn ≤ 3 ngày               → "Pro · còn X ngày — Gia hạn" (warning, click → upsell)
 *   - hết hạn (tier=null)        → "Hết hạn — Gia hạn ngay" (danger, nổi bật)
 *   - trial active               → "Dùng thử · còn X ngày" (primary)
 *
 * Props:
 *   addressId: UUID
 *   onRenewClick: () => void   — mở UpsellSheet (passed from parent)
 */
export default function SubscriptionBadge({ addressId, onRenewClick }) {
    const [activeTiers, setActiveTiers] = useState([])
    const [loaded, setLoaded] = useState(false)

    // Không fetch gì khi kill switch OFF
    useEffect(() => {
        if (!MONETIZATION_ENABLED_FLAG || !addressId) {
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
    }, [addressId])

    // Kill switch OFF hoặc chưa load xong → không render
    if (!MONETIZATION_ENABLED_FLAG || !loaded) return null

    // ── Tính số ngày còn lại ────────────────────────────────────────────────────
    const today = startOfDayVN()

    if (activeTiers.length === 0) {
        return (
            <button
                id={`sub-badge-expired-${addressId}`}
                onClick={(e) => { e.stopPropagation(); onRenewClick?.() }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger/15 border border-danger/25 hover:bg-danger/25 active:scale-95 transition-all"
            >
                <span className="text-[10px] font-black text-danger">Hết hạn — Gia hạn ngay</span>
            </button>
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

    const hasBasic = activeTiers.some(t => t.tier === 'basic')
    const hasPro = activeTiers.some(t => t.tier === 'pro')
    let tierLabel = 'Chưa có'
    if (hasBasic && hasPro) tierLabel = 'Full'
    else if (hasBasic) tierLabel = 'Basic'
    else if (hasPro) tierLabel = 'Pro'

    // ── Còn ≤ 3 ngày → warning + gia hạn ────────────────────────────────────
    if (minDaysLeft <= 3) {
        return (
            <button
                id={`sub-badge-expiring-${addressId}`}
                onClick={(e) => { e.stopPropagation(); onRenewClick?.() }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 border border-warning/25 hover:bg-warning/20 active:scale-95 transition-all"
            >
                <span className="text-[10px] font-black text-warning">
                    {tierLabel} · còn {minDaysLeft} ngày — Gia hạn
                </span>
            </button>
        )
    }

    // ── Active, còn > 3 ngày → hiển thị nhỏ, mờ ────────────────────────────
    return (
        <span
            id={`sub-badge-active-${addressId}`}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-light"
        >
            <span className="text-[10px] font-medium text-text-dim">{tierLabel} · còn {minDaysLeft} ngày</span>
        </span>
    )
}
