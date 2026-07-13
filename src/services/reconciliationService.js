import { supabase } from '../lib/supabaseClient'

// Ngưỡng pending bị coi là nghi webhook miss (xem docs/MONETIZATION.md §7 edge cases).
export const STALE_PENDING_MINUTES = 30

// payment_intents cần admin chú ý: manual_review (lệch tiền, hệ thống chủ động
// không tự cộng) HOẶC pending quá STALE_PENDING_MINUTES phút (nghi webhook miss).
export async function fetchIntentsNeedingAttention() {
    const staleSince = new Date(Date.now() - STALE_PENDING_MINUTES * 60_000).toISOString()
    const { data, error } = await supabase
        .from('payment_intents')
        .select('id, address_id, address_ids, amount, months, status, reference, created_at, sepay_tx_id, address:addresses!payment_intents_address_id_fkey(name)')
        .or(`status.eq.manual_review,and(status.eq.pending,created_at.lt.${staleSince})`)
        .order('created_at', { ascending: true })
    if (error) throw error
    return data || []
}

// Cấp gói thủ công (đã đối soát sao kê) hoặc bỏ qua (đóng, không cấp).
export async function resolvePaymentIntent(intentId, grant) {
    const { data, error } = await supabase.rpc('admin_resolve_payment_intent', {
        p_intent_id: intentId,
        p_grant: grant,
    })
    if (error) throw error
    return data
}

// Địa chỉ đã nhận thưởng referral (+1 tháng khi người được mời trả tiền lần đầu — §11).
export async function fetchReferralRewards() {
    const { data, error } = await supabase
        .from('addresses')
        .select('id, name, referral_rewarded_at, referrer:addresses!referred_from_address_id(name)')
        .not('referral_rewarded_at', 'is', null)
        .order('referral_rewarded_at', { ascending: false })
    if (error) throw error
    return data || []
}
