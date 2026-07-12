import { supabase } from '../lib/supabaseClient'

// Gửi đánh giá app (SupportModal) — không cần localRepo/guest fallback vì
// rating gắn với user_id thật, RLS chặn insert nếu không phải chủ tài khoản.
export async function insertRating(userId, rating, comment) {
    if (!supabase) throw new Error('Không có kết nối')
    if (!userId) throw new Error('Cần đăng nhập để đánh giá')
    const { error } = await supabase.from('app_ratings').insert({
        user_id: userId,
        rating,
        comment: comment?.trim() || null,
    })
    if (error) throw error
}
