import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { UUID, Row } from '../types/domain'

// Tiêu hao từng ngày đã lưu (daily_ingredient_usage, migration 20261006) trong [fromDay, toDay)
// → { 'YYYY-MM-DD': { ingredient: số } }. Lỗi / bảng chưa có → {} để caller tính lại từ đơn:
// trang tồn kho không được hỏng vì bảng này.
export async function fetchStoredUsage(addressId: UUID, fromDay: string, toDay: string): Promise<Record<string, Row>> {
    if (localRepo.isGuest()) return {}
    const { data, error } = await supabase.from('daily_ingredient_usage').select('day, usage')
        .eq('address_id', addressId).gte('day', fromDay).lt('day', toDay)
    if (error) { console.error('fetchStoredUsage', error); return {} }
    return Object.fromEntries((data || []).map((r: Row) => [r.day, r.usage]))
}

// Ghi các ngày vừa tính. ON CONFLICT DO NOTHING (chỉ cần quyền INSERT): ngày đã lưu giữ nguyên,
// 2 máy cùng tính thì máy tới trước thắng. Lỗi chỉ log — số vẫn dùng được cho lần hiển thị này.
export async function saveUsageDays(addressId: UUID, usageByDay: Record<string, Row>) {
    if (localRepo.isGuest()) return
    const rows = Object.entries(usageByDay).map(([day, usage]) => ({ address_id: addressId, day, usage }))
    if (!rows.length) return
    const { error } = await supabase.from('daily_ingredient_usage')
        .upsert(rows, { onConflict: 'address_id,day', ignoreDuplicates: true })
    if (error) console.error('saveUsageDays', error)
}
