import { supabase } from '../lib/supabaseClient'

// Gửi góp ý app (SupportModal) — không cần localRepo/guest fallback vì
// rating gắn với user_id thật, RLS chặn insert nếu không phải chủ tài khoản.
export async function insertRating(userId: string | null | undefined, comment: string) {
    if (!userId) throw new Error('Cần đăng nhập để đánh giá')
    const { error } = await supabase.from('app_ratings').insert({
        user_id: userId,
        comment: comment.trim(),
    })
    if (error) throw error
}
