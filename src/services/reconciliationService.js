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
