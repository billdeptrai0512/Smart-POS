import { supabase } from '../lib/supabaseClient'
import type { UUID } from '../types/domain'
import type { TransferItem } from '../utils/warehouseTransfer'

// Phiếu soạn kho nội bộ của nhóm kho chung (migration 20261011_warehouse_transfers). 1 phiếu = (nhóm, ngày dùng).
// Trả { status, items: [{ address_id, ingredient, unit, qty }] } hoặc null nếu chưa có phiếu. Ném khi lỗi
// (vd. migration chưa apply) — caller phân biệt được với "chưa có phiếu".
export async function fetchWarehouseTransfer(groupId: UUID, forDate: string) {
    const { data, error } = await supabase
        .from('warehouse_transfers')
        .select('status, warehouse_transfer_items(address_id, ingredient, unit, qty, packed_at)')
        .eq('group_id', groupId)
        .eq('for_date', forDate)
        .maybeSingle()
    if (error) throw error
    return data && { status: data.status, items: data.warehouse_transfer_items || [] }
}

// Hàng kho tổng đã chốt chia cho MỘT chi nhánh vào ngày `forDate` (chỉ phiếu 'issued'; nháp là việc của quản lý) →
// { [ingredient]: { qty, packed } }. Địa chỉ ngoài nhóm kho chung / chưa có phiếu = {}. Ném khi lỗi (caller tự nuốt).
export async function fetchTransferToAddress(addressId: UUID, forDate: string) {
    const { data, error } = await supabase
        .from('warehouse_transfer_items')
        .select('ingredient, qty, packed_at, warehouse_transfers!inner(for_date, status)')
        .eq('address_id', addressId)
        .eq('warehouse_transfers.for_date', forDate)
        .eq('warehouse_transfers.status', 'issued')
    if (error) throw error
    return Object.fromEntries((data || []).map(i => [i.ingredient, { qty: Number(i.qty), packed: !!i.packed_at }]))
}

// Tick "đã soạn" 1 dòng — chỉ làm bằng chứng, không đụng tồn kho. Trả mốc tick (null = đã bỏ tick).
export async function setWarehouseTransferPacked(groupId: UUID, forDate: string, addressId: UUID, ingredient: string, packed: boolean) {
    const { data, error } = await supabase.rpc('set_warehouse_transfer_packed', {
        p_group_id: groupId, p_for_date: forDate, p_address_id: addressId, p_ingredient: ingredient, p_packed: packed,
    })
    if (error) throw error
    return data as string | null
}

// Ghi đè toàn bộ dòng của phiếu (nhóm, ngày). status: 'draft' | 'issued'. Trả transfer id.
export async function saveWarehouseTransfer(groupId: UUID, forDate: string, items: TransferItem[], status: 'draft' | 'issued') {
    const { data, error } = await supabase.rpc('save_warehouse_transfer', {
        p_group_id: groupId, p_for_date: forDate, p_items: items, p_status: status,
    })
    if (error) throw error
    return data
}
