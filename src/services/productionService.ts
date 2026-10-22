import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { UUID, Row } from '../types/domain'
import type { ProductionRow } from '../utils/production'

// Các mẻ sản xuất còn hiệu lực từ 00:00 VN của `fromDay` ('YYYY-MM-DD') tới nay. Lỗi / bảng chưa migrate (20261027) → []:
// trang tồn kho không được hỏng vì tính năng này. withCancelled: Nhật ký còn hiện cả mẻ đã hủy (mờ) để có dấu vết.
export async function fetchProduction(addressId: UUID, fromDay: string, withCancelled = false): Promise<(ProductionRow & Row)[]> {
    if (localRepo.isGuest()) return []
    let q = supabase.from('production_batches')
        .select('id, product_id, created_at, output_ingredient, batches, output_qty, inputs, staff_name, cancelled_at')
        .eq('address_id', addressId)
    if (!withCancelled) q = q.is('cancelled_at', null)
    const { data, error } = await q
        .gte('created_at', new Date(`${fromDay}T00:00:00+07:00`).toISOString())
        .order('created_at', { ascending: false })
    if (error) { console.error('fetchProduction', error); return [] }
    return data as (ProductionRow & Row)[]
}

/** Ghi 1 lần sản xuất: thành phẩm cộng số mẻ × sản lượng mẻ, nguyên liệu gốc trừ số mẻ × công thức mẻ. */
export async function produceBatch(addressId: UUID, productId: UUID, outputIngredient: string, batches: number, staffName: string | null) {
    const { error } = await supabase.rpc('produce_batch', {
        p_address_id: addressId, p_product_id: productId, p_output_ingredient: outputIngredient, p_batches: batches, p_staff_name: staffName,
    })
    if (error) throw error
}

export async function cancelProductionBatch(id: UUID) {
    const { error } = await supabase.rpc('cancel_production_batch', { p_id: id })
    if (error) throw error
}
