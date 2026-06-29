// ============================================================
// set-staff-password — manager đặt lại mật khẩu cho nhân viên trong team.
//
// Browser → POST { user_id, password } + Authorization: Bearer <session jwt>.
// Đổi mật khẩu người KHÁC cần auth.admin (service_role) → không làm được
// client-side, nên gom vào Edge Function này.
//
// Xác thực:
//   1. getUser(jwt) → caller là ai.
//   2. caller phải role manager/admin.
//   3. target.manager_id phải = owner của caller (admin bỏ qua).
//
// Deploy:  supabase functions deploy set-staff-password
//   (giữ verify_jwt mặc định — chỉ user đã đăng nhập gọi được)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY có sẵn trong runtime, không cần set thêm.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    })
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'missing auth' }, 401)

    let payload: Record<string, unknown>
    try { payload = await req.json() } catch { return json({ error: 'bad json' }, 400) }

    const userId = String(payload.user_id ?? '')
    const password = String(payload.password ?? '')
    if (!userId) return json({ error: 'thiếu user_id' }, 400)
    if (password.length < 6) return json({ error: 'Mật khẩu tối thiểu 6 ký tự' }, 400)

    const service = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1) Ai đang gọi?
    const { data: { user: caller }, error: callerErr } = await service.auth.getUser(token)
    if (callerErr || !caller) return json({ error: 'phiên đăng nhập không hợp lệ' }, 401)

    // 2) Caller là manager/admin?
    const { data: callerRow } = await service
        .from('users').select('id, role, manager_id').eq('auth_id', caller.id).maybeSingle()
    if (!callerRow || (callerRow.role !== 'manager' && callerRow.role !== 'admin')) {
        return json({ error: 'Chỉ quản lý mới đổi được mật khẩu' }, 403)
    }
    const ownerId = callerRow.manager_id ?? callerRow.id

    // 3) Target thuộc team?
    const { data: target } = await service
        .from('users').select('auth_id, manager_id').eq('id', userId).maybeSingle()
    if (!target) return json({ error: 'Không tìm thấy nhân viên' }, 404)
    if (callerRow.role !== 'admin' && target.manager_id !== ownerId) {
        return json({ error: 'Nhân viên không thuộc team của bạn' }, 403)
    }
    if (!target.auth_id) return json({ error: 'Nhân viên chưa có tài khoản đăng nhập' }, 400)

    // 4) Đổi mật khẩu
    const { error: updErr } = await service.auth.admin.updateUserById(target.auth_id, { password })
    if (updErr) return json({ error: updErr.message }, 500)

    return json({ ok: true }, 200)
})
