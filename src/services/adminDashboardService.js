import { supabase } from '../lib/supabaseClient'

// 1 RPC tổng hợp toàn bộ số liệu cho /admin/dashboard (revenue, subscription
// health, danh sách cần chú ý, hoạt động gần đây) — admin_dashboard_overview
// tự chặn non-admin (RAISE EXCEPTION), đây chỉ gọi thẳng không cache vì trang
// chỉ có 1 nơi dùng và luôn muốn số mới nhất khi mở/refresh.
//
// Phễu onboarding khách dùng thử là RPC RIÊNG (xem 20260801_guest_onboarding_funnel.sql) —
// không nhét vào admin_dashboard_overview vì hàm đó body 378 dòng, quy ước CREATE OR REPLACE
// nguyên body, sửa vào là rủi ro không đáng. Gọi song song, và lỗi của nó KHÔNG được làm hỏng
// cả dashboard (vd migration chưa apply) → nuốt lỗi, trả null, card tự ẩn.
export async function fetchAdminDashboard() {
    const [overview, funnel] = await Promise.all([
        supabase.rpc('admin_dashboard_overview'),
        supabase.rpc('guest_onboarding_funnel_stats').then(
            ({ data, error }) => (error ? { data: null } : { data }),
            () => ({ data: null }),
        ),
    ])
    if (overview.error) throw overview.error
    return { ...overview.data, onboarding_funnel: funnel.data ?? null }
}
