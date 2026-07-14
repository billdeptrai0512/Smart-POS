import { supabase } from '../lib/supabaseClient'

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
