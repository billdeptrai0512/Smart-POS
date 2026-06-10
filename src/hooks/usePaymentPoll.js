import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'

const POLL_MS = 4000

/**
 * usePaymentPoll — poll-while-pending (MONETIZATION.md §7.1).
 *
 * Lưới an toàn cho realtime: nếu mất kết nối đúng lúc webhook bắn, client vẫn
 * bắt được trạng thái 'paid' ở lần poll sau (realtime mất event khi rớt mạng).
 * RLS payment_intent_select cho manager đọc intent của chi nhánh mình.
 *
 * Poll CHỈ khi đang có intent pending (reference) và chưa confirmed.
 * Dừng khi: paid (→ onPaid) | trạng thái terminal khác (→ onExpired) | unmount.
 * Tab ẩn → bỏ qua tick (tiết kiệm, CK xong quay lại tab là bắt kịp).
 *
 * @param {object}   opts
 * @param {string}   opts.reference  - reference của payment_intent đang chờ
 * @param {boolean}  [opts.enabled=true]
 * @param {()=>void} opts.onPaid
 * @param {(status:string)=>void} [opts.onExpired] - expired/cancelled/manual_review
 */
export function usePaymentPoll({ reference, enabled = true, onPaid, onExpired }) {
    // Giữ callback mới nhất mà không re-subscribe interval.
    const onPaidRef = useRef(onPaid)
    const onExpiredRef = useRef(onExpired)
    useEffect(() => {
        onPaidRef.current = onPaid
        onExpiredRef.current = onExpired
    }, [onPaid, onExpired])

    useEffect(() => {
        if (!enabled || !reference || !supabase) return
        let stopped = false

        const tick = async () => {
            if (stopped || document.visibilityState === 'hidden') return
            const { data, error } = await supabase
                .from('payment_intents')
                .select('status')
                .eq('reference', reference)
                .maybeSingle()
            if (stopped || error || !data) return
            if (data.status === 'paid') {
                stopped = true
                clearInterval(id)
                onPaidRef.current?.()
            } else if (data.status !== 'pending') {
                stopped = true
                clearInterval(id)
                onExpiredRef.current?.(data.status)
            }
        }

        const id = setInterval(tick, POLL_MS)
        return () => { stopped = true; clearInterval(id) }
    }, [reference, enabled])
}
