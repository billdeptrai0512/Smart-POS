import { supabase } from '../lib/supabaseClient'

// Định danh ẩn danh do client tự sinh, CHỈ dùng cho phễu onboarding ở /admin/dashboard.
// Cố tình KHÔNG dùng lại:
//   - DEMO_ADDRESS_ID (localRepository.ts) — literal cố định dùng chung mọi trình duyệt khách,
//     đếm theo nó thì mọi khách gom về đúng 1 dòng.
//   - onboarding_v4_<addressId> (onboardingStorage.js) — theo địa chỉ, không phải theo người.
const VISITOR_ID_KEY = 'guest_funnel_visitor_id'

function getOrCreateVisitorId() {
    try {
        let id = localStorage.getItem(VISITOR_ID_KEY)
        if (!id) {
            id = crypto.randomUUID()
            localStorage.setItem(VISITOR_ID_KEY, id)
        }
        return id
    } catch {
        return null // private mode / hết quota → bỏ qua tracking, không ảnh hưởng gì tới app
    }
}

// Chỉ ĐỌC, không mint: người đăng ký thẳng (chưa từng bấm "Dùng thử miễn phí") không có id,
// và cũng không được tạo id mới — nếu không sẽ đếm họ như một khách dùng thử đã chuyển đổi.
function readVisitorId() {
    try {
        return localStorage.getItem(VISITOR_ID_KEY)
    } catch {
        return null
    }
}

// Chung 1 lối gọi cho cả 2 RPC: fire-and-forget, nuốt cả lỗi trả về lẫn lỗi reject (mất mạng).
function fireAndForget(fn, args) {
    try {
        if (!supabase) return
        supabase.rpc(fn, args).then(
            ({ error }) => { if (error) console.warn(`[funnel] ${fn} failed:`, error.message) },
            (err) => console.warn(`[funnel] ${fn} rejected:`, err),
        )
    } catch (err) {
        console.warn(`[funnel] ${fn} threw:`, err)
    }
}

// Fire-and-forget: KHÔNG bao giờ throw, KHÔNG await, KHÔNG chặn luồng của khách. RPC có thể chưa
// tồn tại (migration 20260801_guest_onboarding_funnel.sql apply tay) → lỗi ở đây phải im lặng.
// Gọi lại cùng 1 stage là vô hại: RPC upsert bằng GREATEST nên không đếm trùng, không lùi số.
export function trackGuestOnboardingStage(stage) {
    const visitorId = getOrCreateVisitorId()
    if (!visitorId) return
    fireAndForget('track_guest_onboarding_stage', { p_visitor_id: visitorId, p_stage: stage })
}

// Mốc cuối của phễu: khách dùng thử đã đăng ký tài khoản thật. Gọi sau khi signUp thành công
// (AuthContext), TRƯỚC clearGuestData() cho chắc — hiện clearGuestData chỉ xoá KEYS của
// localRepository nên visitor id vẫn sống, nhưng không đáng phụ thuộc vào chi tiết đó.
// Không có visitor id = đăng ký thẳng, không đi qua dùng thử → không đếm.
export function markGuestFunnelSignup() {
    const visitorId = readVisitorId()
    if (!visitorId) return
    fireAndForget('mark_guest_funnel_signup', { p_visitor_id: visitorId })
}
