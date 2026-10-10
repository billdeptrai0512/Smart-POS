import { supabase } from '../lib/supabaseClient'
import type { UUID } from '../types/domain'

// Các RPC admin/billing mà UI từng gọi thẳng supabase.rpc — gom về service để component không
// biết tên RPC/tham số. Mọi hàm ném lỗi Supabase nguyên bản; caller tự hiển thị.

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) throw error
    return data as T
}

export const wipeAddressSalesData = (addressId: UUID) =>
    rpc('admin_wipe_address_sales_data', { p_address_id: addressId })

export const setMonetizationEnabled = (enabled: boolean) =>
    rpc('admin_set_app_config', { p_key: 'monetization_enabled', p_value: enabled ? 'true' : 'false' })

// Ném lỗi thay vì coi lỗi RLS/mạng là "đang tắt" — caller tự quyết fallback.
export async function fetchMonetizationEnabled(): Promise<boolean> {
    const { data, error } = await supabase.from('app_config').select('value').eq('key', 'monetization_enabled').maybeSingle()
    if (error) throw error
    return data?.value === 'true'
}

// note='trial' → RPC tự dùng 7 ngày cố định, bỏ qua months (20260709_admin_mock_trial_grant.sql).
export const grantSubscription = (addressIds: UUID[], modules: string[], months: number, amountPaid: number, note: string) =>
    rpc('admin_set_subscription', { p_address_ids: addressIds, p_modules: modules, p_months: months, p_amount_paid: amountPaid, p_note: note })

// modules = null → xoá hết.
export const resetSubscription = (addressIds: UUID[], modules: string[] | null = null) =>
    rpc('admin_reset_subscription', { p_address_ids: addressIds, p_modules: modules })

export const createPaymentIntent = (addressIds: UUID[], months: number, amount: number) =>
    rpc<string>('create_payment_intent', { p_address_ids: addressIds, p_months: months, p_amount: amount })
