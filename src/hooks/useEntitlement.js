import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'

// ─── Kill switch (build-time constant) ───────────────────────────────────────
const MONETIZATION_ENABLED = import.meta.env.VITE_MONETIZATION_ENABLED === 'true'

// ─── 2 module độc lập (xem docs/MONETIZATION.md §1) ──────────────────────────
//   cashflow  → "Dòng tiền": mở khoá CẢ view Dòng tiền LẪN view Lợi nhuận (P&L)
//   inventory → "Tồn kho": nhập/tồn + hao hụt/Loss Audit + gợi ý đi chợ
export const MODULES = ['cashflow', 'inventory']

/**
 * Kiểm tra address đang chọn có sở hữu 1 module cụ thể không.
 * @param {string[]} activeModules - vd: ['cashflow', 'inventory']
 * @param {string}   module        - 'cashflow' | 'inventory'
 * @returns {boolean}
 */
export function hasModule(activeModules, module) {
    return Array.isArray(activeModules) && activeModules.includes(module)
}

/**
 * Hook trả về entitlement hiện tại của address đang chọn.
 *
 * Bypass (trả đủ 3 module, không query DB) khi:
 *   - MONETIZATION_ENABLED=false (Phase 0 — dev), HOẶC
 *   - đang ở guest mode (Khách ghé thăm xem full tính năng)
 *
 * Khi ON + không guest:
 *   → query RPC get_address_entitlement
 *   → activeModules = các module còn hạn (rỗng nếu hết hạn / chưa mua)
 *
 * ⚠️ Rules of Hooks: hooks LUÔN được gọi — bypass chỉ bỏ qua effect logic,
 *    KHÔNG return sớm trước hooks.
 */
export function useEntitlement() {
    const { selectedAddress } = useAddress()
    const { isGuest } = useAuth()

    const bypass = !MONETIZATION_ENABLED || isGuest

    const [state, setState] = useState({ activeModules: [], validToByModule: {}, loading: true })

    useEffect(() => {
        // Bypass: không query DB khi monetization tắt hoặc đang guest.
        // State trả về được tính dẫn xuất ở cuối hook (không setState ở đây).
        if (bypass) return

        if (!selectedAddress?.id) {
            setState({ activeModules: [], validToByModule: {}, loading: false })
            return
        }

        setState(prev => ({ ...prev, loading: true }))

        supabase
            .rpc('get_address_entitlement', { p_address_id: selectedAddress.id })
            .then(({ data, error }) => {
                if (error) {
                    console.error('[useEntitlement] RPC error:', error)
                    // Fail-open: lỗi mạng → không gate user (không phạt oan)
                    setState({ activeModules: [...MODULES], validToByModule: {}, loading: false })
                    return
                }
                // RPC trả về rows { tier, valid_to } — cột `tier` lưu giá trị module
                const rows = Array.isArray(data) ? data : (data ? [data] : [])
                const activeModules = rows.map(r => r.tier)
                const validToByModule = rows.reduce((acc, r) => ({ ...acc, [r.tier]: r.valid_to }), {})
                setState({ activeModules, validToByModule, loading: false })
            })
    }, [bypass, selectedAddress?.id])

    // Bypass → đủ 3 module (tính dẫn xuất, đúng cả khi isGuest đổi runtime).
    if (bypass) {
        return {
            activeModules: [...MODULES],
            validToByModule: Object.fromEntries(MODULES.map(m => [m, '2099-12-31'])),
            loading: false,
            enabled: MONETIZATION_ENABLED,
        }
    }

    return { ...state, enabled: MONETIZATION_ENABLED }
}

/**
 * Hằng số xuất để component biết monetization đang ON/OFF.
 */
export const MONETIZATION_ENABLED_FLAG = MONETIZATION_ENABLED
