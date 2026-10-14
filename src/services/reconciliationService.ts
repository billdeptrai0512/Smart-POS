import { supabase } from '../lib/supabaseClient'

// Cấp gói thủ công (đã đối soát sao kê) hoặc bỏ qua (đóng, không cấp).
export async function resolvePaymentIntent(intentId: string, grant: boolean) {
    const { data, error } = await supabase.rpc('admin_resolve_payment_intent', {
        p_intent_id: intentId,
        p_grant: grant,
    })
    if (error) throw error
    return data
}

// Ẩn 1 dòng "Cần chú ý" (vd 'trial_missing') — chỉ ẩn khỏi danh sách, không đụng gói/trial của chi nhánh.
export async function dismissAttention(addressId: string, reason: string) {
    const { error } = await supabase.rpc('admin_dismiss_attention', { p_address_id: addressId, p_reason: reason })
    if (error) throw error
}
