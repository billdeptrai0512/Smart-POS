import { supabase } from '../lib/supabaseClient'

// 1 RPC tổng hợp toàn bộ số liệu cho /admin/dashboard (revenue, subscription
// health, danh sách cần chú ý, hoạt động gần đây) — admin_dashboard_overview
// tự chặn non-admin (RAISE EXCEPTION), đây chỉ gọi thẳng không cache vì trang
// chỉ có 1 nơi dùng và luôn muốn số mới nhất khi mở/refresh.
//
// Phễu onboarding khách dùng thử là RPC RIÊNG (guest_onboarding_funnel_stats,
// xem onboardingFunnelService.ts) — OnboardingFunnelCard tự fetch lấy, KHÔNG
// gộp vào đây, vì hàm đó body 378 dòng và quy ước CREATE OR REPLACE nguyên
// body, sửa vào chỉ để thêm 1 số liệu không liên quan là rủi ro không đáng.
export async function fetchAdminDashboard() {
    const { data, error } = await supabase.rpc('admin_dashboard_overview')
    if (error) throw error
    return data
}


// group = tên nhóm kho chung của địa chỉ (null = kho riêng).
export interface StageAddress { name: string; group: string | null }
// Các key số = số địa chỉ mỗi nhóm; lists[nhóm] = địa chỉ trong nhóm (migration 20261026).
export type BranchStages = Record<string, any> & { lists?: Record<string, StageAddress[]> } // eslint-disable-line @typescript-eslint/no-explicit-any

// Số chi nhánh theo giai đoạn (admin_branch_stages, migration 20261020). RPC RIÊNG vì cùng lý do như
// trên. Ném lỗi để caller tự ẩn thẻ khi chưa apply.
export async function fetchAdminBranchStages() {
    const { data, error } = await supabase.rpc('admin_branch_stages')
    if (error) throw error
    return data as BranchStages
}
