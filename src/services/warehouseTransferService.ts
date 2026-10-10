import { supabase } from '../lib/supabaseClient'
import type { UUID } from '../types/domain'
import type { TransferItem } from '../utils/warehouseTransfer'

// Phiếu soạn kho nội bộ của nhóm kho chung (migration 20261011_warehouse_transfers). 1 phiếu = (nhóm, ngày dùng).
// Trả { status, items: [{ address_id, ingredient, unit, qty }] } hoặc null nếu chưa có phiếu. Ném khi lỗi
// (vd. migration chưa apply) — caller phân biệt được với "chưa có phiếu".
export async function fetchWarehouseTransfer(groupId: UUID, forDate: string) {
    const { data, error } = await supabase
        .from('warehouse_transfers')
        .select('status, warehouse_transfer_items(address_id, ingredient, unit, qty)')
        .eq('group_id', groupId)
        .eq('for_date', forDate)
        .maybeSingle()
    if (error) throw error
    return data && { status: data.status, items: data.warehouse_transfer_items || [] }
}

// Ghi đè toàn bộ dòng của phiếu (nhóm, ngày). status: 'draft' | 'issued'. Trả transfer id.
export async function saveWarehouseTransfer(groupId: UUID, forDate: string, items: TransferItem[], status: 'draft' | 'issued') {
    const { data, error } = await supabase.rpc('save_warehouse_transfer', {
        p_group_id: groupId, p_for_date: forDate, p_items: items, p_status: status,
    })
    if (error) throw error
    return data
}
