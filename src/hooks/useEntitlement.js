import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'

// ─── Client kill switch (build-time) ─────────────────────────────────────────
//   Master capability. Build với false → monetization TẮT CỨNG, không hỏi server.
//   Build với true  → bật/tắt thực tế do SERVER quyết (app_config.monetization_enabled).
//   → Hiệu lực = client(build) AND server(runtime). Khớp rollout phases (MONETIZATION.md §9).
const CLIENT_MONETIZATION_ENABLED = import.meta.env.VITE_MONETIZATION_ENABLED === 'true'

// ─── 1 gói all-access (xem docs/MONETIZATION.md §1) ──────────────────────────
//   'all' → mở khoá CẢ 3 view báo cáo: Dòng tiền + Lợi nhuận + Tồn kho.
export const MODULES = ['all']

/**
 * Kiểm tra address đang chọn có quyền truy cập báo cáo không.
 * @param {string[]} activeModules - vd: ['all']
 * @param {string}   [module='all']
 * @returns {boolean}
 */
export function hasModule(activeModules, module = 'all') {
    return Array.isArray(activeModules) && activeModules.includes(module)
}

// ─── Server kill switch (runtime, app_config) ────────────────────────────────
//   Đọc 1 lần, cache module-level → mọi hook share chung 1 request (không spam DB).
//   _serverFlag: undefined = chưa đọc; true/false = đã rõ.
//   Lỗi đọc config → false (fail-open: KHÔNG gate ai, tránh khoá nhầm khách đã trả
//   khi mạng/DB chập chờn). Flip ON/OFF = UPDATE app_config, KHÔNG cần redeploy.
let _serverFlag
let _serverFlagPromise = null
function loadServerFlag() {
    if (_serverFlagPromise) return _serverFlagPromise
    _serverFlagPromise = supabase
        .from('app_config')
        .select('value')
        .eq('key', 'monetization_enabled')
        .maybeSingle()
        .then(({ data, error }) => {
            _serverFlag = !error && data?.value === 'true'
            return _serverFlag
        })
        .catch(() => { _serverFlag = false; return _serverFlag })
    return _serverFlagPromise
}

/**
 * Trạng thái bật/tắt monetization HIỆU LỰC = client(build) AND server(app_config).
 * Dùng cho mọi quyết định hiển thị gate/badge/route monetization.
 * @returns {{ enabled: boolean, loading: boolean }}
 */
export function useMonetizationEnabled() {
    const [flag, setFlag] = useState(CLIENT_MONETIZATION_ENABLED ? _serverFlag : false)

    useEffect(() => {
        if (!CLIENT_MONETIZATION_ENABLED) return
        // loadServerFlag() trả promise đã cache → nếu đã đọc xong, .then resolve ngay
        // với giá trị cũ (React bỏ qua nếu không đổi). Không setState đồng bộ trong effect.
        let cancelled = false
        loadServerFlag().then(v => { if (!cancelled) setFlag(v) })
        return () => { cancelled = true }
    }, [])

    const loading = CLIENT_MONETIZATION_ENABLED && flag === undefined
    const enabled = CLIENT_MONETIZATION_ENABLED && flag === true
    return { enabled, loading }
}

/**
 * Hook trả về entitlement hiện tại của address đang chọn.
 *
 * Bypass (trả đủ module, không query entitlement) khi:
 *   - monetization OFF (client build OFF hoặc server app_config OFF), HOẶC
 *   - đang ở guest mode (Khách ghé thăm xem full tính năng)
 *
 * Khi ON + không guest:
 *   → query RPC get_address_entitlement
 *   → activeModules = các module còn hạn (rỗng nếu hết hạn / chưa mua)
 *
 * Trong lúc còn đọc server flag (configLoading) → trả loading:true (coi như có
 * quyền) để KHÔNG nháy gate trước khi biết trạng thái thật.
 *
 * ⚠️ Rules of Hooks: hooks LUÔN được gọi — bypass chỉ bỏ qua effect logic,
 *    KHÔNG return sớm trước hooks.
 */
export function useEntitlement() {
    const { selectedAddress } = useAddress()
    const { isGuest } = useAuth()
    const { enabled, loading: configLoading } = useMonetizationEnabled()

    const bypass = !enabled || isGuest

    const [state, setState] = useState({ activeModules: [], validToByModule: {}, loading: true })

    useEffect(() => {
        // Không query khi bypass, hoặc khi chưa biết server flag (tránh query thừa).
        if (bypass || configLoading) return

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
    }, [bypass, configLoading, selectedAddress?.id])

    // Bypass (monetization OFF hoặc guest) → đủ module.
    // Khi đang load server flag → loading:true để KHÔNG nháy gate.
    if (bypass) {
        return {
            activeModules: [...MODULES],
            validToByModule: Object.fromEntries(MODULES.map(m => [m, '2099-12-31'])),
            loading: configLoading,
            enabled,
        }
    }

    return { ...state, enabled }
}

/**
 * Hằng số build-time client flag (KHÔNG phản ánh server runtime).
 * ⚠️ Ưu tiên dùng useMonetizationEnabled() / useEntitlement().enabled để quyết định
 *    gate — chúng phản ánh đúng cả server kill switch. Giữ export cho tương thích.
 */
export const MONETIZATION_ENABLED_FLAG = CLIENT_MONETIZATION_ENABLED
