import { supabase } from '../lib/supabaseClient'
import type { UUID } from '../types/domain'

// Phiếu soạn kho nội bộ của nhóm kho chung (migration 20261011_warehouse_transfers). 1 phiếu = (nhóm, ngày dùng).
// Trả { status, items: [{ address_id, ingredient, unit, qty, packed_at }] } hoặc null nếu chưa có phiếu. Ném khi lỗi
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

// "Soạn cho ngày mai": xác nhận (confirmed=true, ghi số đã xác nhận) / bỏ xác nhận 1 dòng (địa chỉ, nguyên liệu, ngày). Chỉ là bằng chứng,
// không đụng tồn kho. Trả mốc xác nhận (null = đã bỏ).
export async function setTomorrowPrepConfirmed(groupId: UUID, forDate: string, addressId: UUID, ingredient: string, unit: string, qty: number, confirmed: boolean) {
    const { data, error } = await supabase.rpc('set_tomorrow_prep_confirmed', {
        p_group_id: groupId, p_for_date: forDate, p_address_id: addressId, p_ingredient: ingredient, p_unit: unit, p_qty: qty, p_confirmed: confirmed,
    })
    if (error) throw error
    return data as string | null
}
