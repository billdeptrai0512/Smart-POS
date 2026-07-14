import { supabase } from '../lib/supabaseClient'

// 1 RPC tổng hợp toàn bộ số liệu cho /admin/dashboard (revenue, subscription
// health, danh sách cần chú ý, hoạt động gần đây) — admin_dashboard_overview
// tự chặn non-admin (RAISE EXCEPTION), đây chỉ gọi thẳng không cache vì trang
// chỉ có 1 nơi dùng và luôn muốn số mới nhất khi mở/refresh.
export async function fetchAdminDashboard() {
    const { data, error } = await supabase.rpc('admin_dashboard_overview')
    if (error) throw error
    return data
}
