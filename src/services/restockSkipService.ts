import { supabase } from '../lib/supabaseClient'
import type { UUID } from '../types/domain'

// "Bỏ qua" của Việc cần làm lưu trên server (migration 20261033) để mọi thiết bị cùng thấy; chỉ có hiệu lực trong ngày.
// → { [addressId]: { [ingredient]: true } }. Lỗi (chưa migrate / mất mạng) trả null để caller giữ số đang có.
export async function fetchRestockSkips(addressIds: UUID[]): Promise<Record<string, Record<string, boolean>> | null> {
    const { data, error } = await supabase.rpc('get_restock_skips', { p_address_ids: addressIds })
    if (error) console.error('fetchRestockSkips', error)
    if (error || !data) return null
    const out: Record<string, Record<string, boolean>> = {}
    for (const r of data as { address_id: string; ingredient: string }[]) (out[r.address_id] ??= {})[r.ingredient] = true
    return out
}

export async function setRestockSkip(addressId: UUID, ingredient: string, skipped: boolean) {
    const { error } = await supabase.rpc('set_restock_skip', { p_address_id: addressId, p_ingredient: ingredient, p_skipped: skipped })
    if (error) throw error
}
