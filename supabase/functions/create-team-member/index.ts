// ============================================================
// create-team-member — manager tạo trực tiếp tài khoản nhân sự/quản lý.
//
// Browser → POST { name, username, password, role } + Authorization: Bearer <session jwt>.
//
// Xác thực:
//   1. getUser(jwt) → caller là ai.
//   2. caller phải role manager/admin.
//
// Deploy:  supabase functions deploy create-team-member
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
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

    const name = String(payload.name ?? '').trim()
    const username = String(payload.username ?? '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')
    const password = String(payload.password ?? '')
    const role = String(payload.role ?? 'staff') // 'staff' or 'manager'

    if (!name) return json({ error: 'Vui lòng nhập tên' }, 400)
    if (!username) return json({ error: 'Vui lòng nhập tài khoản' }, 400)
    if (username.length < 3) return json({ error: 'Tài khoản ít nhất 3 ký tự' }, 400)

    if (role !== 'staff' && role !== 'manager') {
        return json({ error: 'Vai trò không hợp lệ' }, 400)
    }

    if (role === 'manager') {
        const hasLetter = /[a-zA-Z]/.test(password)
        const hasNumber = /[0-9]/.test(password)
        if (password.length < 8 || !hasLetter || !hasNumber) {
            return json({ error: 'Mật khẩu quản lý yêu cầu ít nhất 8 ký tự, bao gồm cả chữ và số' }, 400)
        }
    } else {
        if (!/^[0-9]{6}$/.test(password)) {
            return json({ error: 'Mật khẩu nhân viên phải là mã PIN gồm đúng 6 chữ số' }, 400)
        }
    }

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
        return json({ error: 'Chỉ quản lý mới có quyền tạo tài khoản' }, 403)
    }
    const ownerId = callerRow.manager_id ?? callerRow.id

    // 3) Tạo user auth
    const email = `${username}@coffee.local`
    const { data: authData, error: authError } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    })

    if (authError) {
        if (authError.message.includes('already exists') || authError.message.includes('unique constraint')) {
            return json({ error: 'Tên đăng nhập đã tồn tại trong hệ thống' }, 400)
        }
        return json({ error: authError.message }, 500)
    }

    const authUser = authData.user
    if (!authUser) return json({ error: 'Đăng ký thất bại' }, 500)

    // 4) Tạo profile row
    const { data: profile, error: profileError } = await service
        .from('users')
        .insert({
            auth_id: authUser.id,
            name,
            role,
            manager_id: ownerId,
            username
        })
        .select()
        .single()

    if (profileError) {
        // Rollback auth user
        await service.auth.admin.deleteUser(authUser.id)
        return json({ error: profileError.message }, 500)
    }

    return json({ ok: true, profile }, 200)
})
