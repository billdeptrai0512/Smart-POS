import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAddress } from '../contexts/AddressContext'

// ─── Kill switch (build-time constant) ───────────────────────────────────────
const MONETIZATION_ENABLED = import.meta.env.VITE_MONETIZATION_ENABLED === 'true'

// ─── Feature matrix ───────────────────────────────────────────────────────────
const FEATURE_MATRIX = {
    reports:   ['basic'],         // Daily/Range report, Cash flow, Finance cards
    lossAudit: ['pro'],           // RangeLossCard, InventoryRefillCard audit tab
}

/**
 * Kiểm tra xem các gói cước đang kích hoạt có bao gồm feature không.
 * @param {string[]} activeModules - Mảng các module đang active, vd: ['basic', 'pro']
 * @param {string} feature         - key trong FEATURE_MATRIX
 * @returns {boolean}
 */
export function hasFeature(activeModules, feature) {
    if (!Array.isArray(activeModules)) return false
    return FEATURE_MATRIX[feature]?.some(t => activeModules.includes(t)) ?? false
}

/**
 * Hook trả về entitlement hiện tại của address đang chọn.
 *
 * Khi MONETIZATION_ENABLED=false (Phase 0 — dev):
 *   → trả về { tier: 'pro', validTo: '2099-12-31', loading: false, enabled: false }
 *   → toàn bộ gate/upsell ẩn, không query DB
 *
 * Khi MONETIZATION_ENABLED=true:
 *   → query RPC get_address_entitlement
 *   → tier = null nếu không có sub active
 *
 * ⚠️ Rules of Hooks: hooks LUÔN được gọi — kill switch chỉ bỏ qua effect logic,
 *    KHÔNG return sớm trước hooks.
 */
export function useEntitlement() {
    const { selectedAddress } = useAddress()

    const [state, setState] = useState({
        activeModules: MONETIZATION_ENABLED ? [] : ['basic', 'pro'],
        validToByModule: MONETIZATION_ENABLED ? {} : { basic: '2099-12-31', pro: '2099-12-31' },
        loading: MONETIZATION_ENABLED,   // false ngay khi flag OFF
    })

    useEffect(() => {
        // Kill switch: không query DB khi monetization tắt
        if (!MONETIZATION_ENABLED) return

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
                    setState({ activeModules: ['basic', 'pro'], validToByModule: {}, loading: false })
                    return
                }
                const rows = Array.isArray(data) ? data : (data ? [data] : [])
                const activeModules = rows.map(r => r.tier)
                const validToByModule = rows.reduce((acc, r) => ({ ...acc, [r.tier]: r.valid_to }), {})
                setState({
                    activeModules,
                    validToByModule,
                    loading: false,
                })
            })
    }, [selectedAddress?.id])

    return { ...state, enabled: MONETIZATION_ENABLED }
}

/**
 * Hằng số xuất để component biết monetization đang ON/OFF.
 */
export const MONETIZATION_ENABLED_FLAG = MONETIZATION_ENABLED
