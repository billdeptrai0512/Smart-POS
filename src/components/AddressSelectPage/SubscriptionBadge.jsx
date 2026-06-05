import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { MONETIZATION_ENABLED_FLAG } from '../../hooks/useEntitlement'
import { startOfDayVN } from '../../utils/dateVN'

/**
 * SubscriptionBadge — hiển thị trạng thái gói cước cho từng address card.
 *
 * Khi MONETIZATION_ENABLED=false → không render gì (ẩn hoàn toàn).
 *
 * Mô hình 3 module (cashflow/inventory/finance) — xem MONETIZATION.md §6.B:
 *   - đủ 3 module, còn > 3 ngày  → "Trọn bộ · còn X ngày" (mờ, nhỏ)
 *   - 1–2 module, còn > 3 ngày   → "N/3 gói · còn X ngày" (mờ, nhỏ)
 *   - còn ≤ 3 ngày               → "… · còn X ngày — Gia hạn" (warning, click → /subscription)
 *   - không còn gói nào          → "Mở khoá báo cáo" (primary, click → /subscription)
 *
 * ⚠️ Render bằng <span> (không phải <button>) vì badge nằm BÊN TRONG button card
 *    của BranchGrid — button lồng button gây hydration error. span + onClick hợp lệ.
 *
 * Props:
 *   addressId: UUID
 *   onRenewClick: () => void   — điều hướng tới /subscription (passed from parent)
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

    const count = activeTiers.length
    const tierLabel = count >= 3 ? 'Trọn bộ' : `${count}/3 gói`

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
                    {tierLabel} · còn {minDaysLeft} ngày — Gia hạn
                </span>
            </span>
        )
    }

    // ── Active, còn > 3 ngày → hiển thị nhỏ, mờ ────────────────────────────
    return (
        <span
            id={`sub-badge-active-${addressId}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-light"
        >
            <span className="text-[10px] font-medium text-text-dim">{tierLabel} · còn {minDaysLeft} ngày</span>
        </span>
    )
}
