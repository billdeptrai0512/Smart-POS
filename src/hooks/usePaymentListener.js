import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { MONETIZATION_ENABLED_FLAG } from './useEntitlement'

/**
 * usePaymentListener — Realtime listener xác nhận thanh toán tự động.
 *
 * Trình duyệt KHÔNG nhận webhook SePay trực tiếp. SePay → Edge Function
 * (sepay-webhook) → confirm_payment RPC → INSERT address_subscriptions.
 * Hook này lắng nghe INSERT trên `address_subscriptions` qua Supabase Realtime;
 * khi có sub mới cho 1 trong các chi nhánh đang theo dõi → gọi onConfirmed.
 *
 * Chạy khi component (SubscriptionScreen/Panel) render; tự huỷ khi unmount.
 * Bỏ qua khi: monetization OFF, guest, không có chi nhánh nào.
 *
 * @param {object}   opts
 * @param {string[]} opts.addressIds - chi nhánh cần theo dõi
 * @param {(row:object)=>void} opts.onConfirmed - callback khi nhận sub mới
 * @param {boolean}  [opts.enabled=true]
 */
export function usePaymentListener({ addressIds = [], onConfirmed, enabled = true }) {
    const { isGuest } = useAuth()
    // Giữ callback mới nhất mà không phải re-subscribe mỗi lần nó đổi tham chiếu.
    const onConfirmedRef = useRef(onConfirmed)
    useEffect(() => { onConfirmedRef.current = onConfirmed }, [onConfirmed])

    // Key ổn định để effect chỉ chạy lại khi tập chi nhánh thực sự đổi.
    const key = [...addressIds].sort().join(',')

    useEffect(() => {
        if (!enabled || !MONETIZATION_ENABLED_FLAG || isGuest) return
        if (!supabase || !key) return

        const watched = new Set(key.split(','))

        const channel = supabase
            .channel(`subpay-${key}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'address_subscriptions' },
                (payload) => {
                    const row = payload.new
                    if (row && watched.has(row.address_id)) {
                        onConfirmedRef.current?.(row)
                    }
                }
            )
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [key, enabled, isGuest])
}
