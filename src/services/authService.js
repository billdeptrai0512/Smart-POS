import { supabase } from '../lib/supabaseClient'
import { isGuest } from './localRepository'
import { startOfDayVN } from '../utils/dateVN'

// Formats username to a dummy email for Supabase Auth
const formatUsernameToEmail = (username) => {
    // Remove spaces and convert to lowercase for the dummy email
    const safeUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')
    return `${safeUsername}@coffee.local`
}

// Sign in with username and password via Supabase Auth
export async function signIn(username, password) {
    if (!supabase) throw new Error('No Supabase connection')
    const email = formatUsernameToEmail(username)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
}

// Sign up: creates manager Auth user + profile row.
// `email` is required for password recovery — auth still uses username via fake email.
export async function signUp(username, password, name, email) {
    if (!supabase) throw new Error('No Supabase connection')

    const trimmedEmail = (email || '').trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
        throw new Error('Email không hợp lệ. Email cần thiết cho khôi phục mật khẩu.')
    }

    const authEmail = formatUsernameToEmail(username)

    // 1. Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({ email: authEmail, password })
    if (authError) throw authError

    let authUser = authData.user
    if (!authUser) throw new Error('Đăng ký thất bại')

    // Lỗi vi phạm RLS (Row Level Security) khi insert user profile thường là do
    // Supabase chưa trả về Session (chưa thực sự logged in) ngay lúc gọi hàm signUp.
    if (!authData.session) {
        const { data: signData, error: signError } = await supabase.auth.signInWithPassword({ email: authEmail, password })
        if (signError) throw new Error('Tài khoản đã tạo nhưng không thể tự động đăng nhập: ' + signError.message)
        authUser = signData.user
    }

    // 2. Create profile row linked to auth user
    const { data: profile, error: profileError } = await supabase
        .from('users')
        .insert({ auth_id: authUser.id, name, role: 'manager', manager_id: null, email: trimmedEmail })
        .select()
        .single()

    if (profileError) throw profileError
    return { user: authUser, profile }
}

// Validate an invite token — returns { valid, tokenId, managerId, managerName, role, error }
//
// IMPORTANT: invitee opens this URL while UNAUTHENTICATED. The previous version
// embedded `users(name)` into the invite_tokens select to fetch the inviting
// manager's name. That join hits RLS on `users`, which calls `is_admin_auth()` —
// a function whose EXECUTE was revoked from `anon` in migration 20260505. Result:
// every anonymous signup link returned "permission denied for function
// is_admin_auth" → UI showed "Link không hợp lệ". Bug affected BOTH staff and
// co-manager invites (same code path).
//
// Fix: query invite_tokens alone (RLS permits anon `invite_read USING (true)`),
// then attempt to read the manager name in a separate query and SWALLOW any
// permission error — name is purely cosmetic.
export async function validateInviteToken(token) {
    if (!supabase) return { valid: false, error: 'No connection' }

    // Sanitize the token: decode url-encoded characters, extract the segment before
    // any slash/query/hash, and keep only hex characters to handle trailing slashes
    // or tracking parameters appended by third-party in-app browsers (Zalo, FB, etc.).
    let decodedToken = ''
    try {
        decodedToken = decodeURIComponent(token || '')
    } catch {
        decodedToken = token || ''
    }
    const rawSegment = decodedToken.trim().split(/[?#/]/)[0]
    const cleanToken = rawSegment.replace(/[^a-fA-F0-9]/g, '').toLowerCase()

    const { data, error } = await supabase
        .from('invite_tokens')
        .select('id, manager_id, role, expires_at, used_at')
        .eq('token', cleanToken)
        .maybeSingle()

    if (error || !data) return { valid: false, error: 'Link không hợp lệ' }
    if (data.used_at) return { valid: false, error: 'Link này đã được sử dụng' }
    if (new Date(data.expires_at) < new Date()) return { valid: false, error: 'Link đã hết hạn' }

    // Best-effort fetch of manager name. Anonymous role can't read users (RLS calls
    // is_admin_auth which anon lacks EXECUTE on); we ignore that failure.
    let managerName
    try {
        const { data: managerRow } = await supabase
            .from('users')
            .select('name')
            .eq('id', data.manager_id)
            .maybeSingle()
        managerName = managerRow?.name
    } catch { /* RLS blocked — leave name undefined */ }

    return { valid: true, tokenId: data.id, managerId: data.manager_id, managerName, role: data.role || 'staff' }
}

// Create an invite token for a manager (role = 'staff' | 'co-manager')
export async function createInviteToken(managerId, role = 'staff') {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase
        .from('invite_tokens')
        .insert({ manager_id: managerId, role })
        .select('token, expires_at')
        .single()
    if (error) throw error
    return data
}

// Sign up staff via invite token
export async function signUpWithInvite(token, username, password, name) {
    if (!supabase) throw new Error('No Supabase connection')

    const validation = await validateInviteToken(token)
    if (!validation.valid) throw new Error(validation.error)

    const email = formatUsernameToEmail(username)

    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })
    if (authError) throw authError

    let authUser = authData.user
    if (!authUser) throw new Error('Đăng ký thất bại')

    if (!authData.session) {
        const { data: signData, error: signError } = await supabase.auth.signInWithPassword({ email, password })
        if (signError) throw new Error('Tài khoản đã tạo nhưng không thể tự động đăng nhập: ' + signError.message)
        authUser = signData.user
    }

    // co-manager → role 'manager' with manager_id pointing to the original manager
    const userRole = validation.role === 'co-manager' ? 'manager' : 'staff'
    const { data: profile, error: profileError } = await supabase
        .from('users')
        .insert({ auth_id: authUser.id, name, role: userRole, manager_id: validation.managerId })
        .select()
        .single()
    if (profileError) throw profileError

    // Mark token as used
    await supabase
        .from('invite_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', validation.tokenId)

    return { user: authUser, profile }
}

// Fetch staff and co-managers belonging to a manager
export async function fetchStaffByManager(managerId) {
    if (isGuest()) return []
    if (!supabase) return []
    const { data, error } = await supabase
        .from('users')
        .select('id, name, role')
        .in('role', ['staff', 'manager'])
        .eq('manager_id', managerId)
        .order('name')
    if (error) {
        console.error('fetchStaffByManager error:', error)
        return []
    }
    return data
}

// Promote (staff → manager) or demote (manager → staff) a team member.
// Authorization is enforced server-side by the set_team_member_role RPC.
export async function setTeamMemberRole(userId, role) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.rpc('set_team_member_role', { p_user_id: userId, p_role: role })
    if (error) throw error
}

// Hard-delete a team member's profile. Authorization is enforced server-side
// by the remove_team_member RPC.
export async function removeTeamMember(userId) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.rpc('remove_team_member', { p_user_id: userId })
    if (error) throw error
}


// Sign out
export async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) throw error
}

// Get the current session
export async function getSession() {
    if (!supabase) return null
    const { data: { session } } = await supabase.auth.getSession()
    return session
}

// Lưu SĐT cho tài khoản đang đăng nhập (RPC set_my_phone — chuẩn hoá +84,
// lần đầu nhập sẽ bind/cấp trial theo quy tắc 1 SĐT = 1 trial).
// Trả 'trial_granted' khi vừa kích hoạt 7 ngày dùng thử, ngược lại 'ok'.
export async function setMyPhone(phone) {
    const { data, error } = await supabase.rpc('set_my_phone', { p_phone: phone })
    if (error) throw error
    return data
}

// Fetch user profile by Supabase Auth user ID
export async function fetchProfileByAuthId(authId) {
    if (!supabase) return null
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', authId)
        .maybeSingle()
    if (error) {
        console.error('fetchProfileByAuthId error:', error)
        return null
    }
    return data
}

// Fetch addresses for a manager
// Returns { data, error } — caller decides how to surface failures.
export async function fetchAddresses(managerId) {
    if (!supabase) return { data: [], error: null }

    let query = supabase.from('addresses').select('*').order('created_at')

    if (managerId !== 'ALL') {
        query = query.eq('manager_id', managerId)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchAddresses error:', error)
        return { data: [], error }
    }
    return { data, error: null }
}

// Translate Postgres unique-violation (23505) into a user-facing message.
function rethrowAddressError(error, name) {
    if (error?.code === '23505') {
        const e = new Error(`Địa chỉ "${name}" đã tồn tại`)
        e.code = '23505'
        throw e
    }
    throw error
}

// Create a new address for a manager
export async function createAddress(managerId, name) {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase
        .from('addresses')
        .insert({ manager_id: managerId, name })
        .select()
        .single()
    if (error) rethrowAddressError(error, name)
    return data
}

// Update an address for a manager
export async function updateAddress(addressId, name) {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase
        .from('addresses')
        .update({ name })
        .eq('id', addressId)
        .select()
        .single()
    if (error) rethrowAddressError(error, name)
    return data
}

// Delete an address
export async function deleteAddress(id) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.from('addresses').delete().eq('id', id)
    if (error) throw error
    return true
}

// Update ingredient sort order for an address.
// addressId === null targets the global default template, persisted in app_settings.
export async function updateAddressIngredientSort(addressId, sortOrderArray) {
    if (!supabase) throw new Error('No Supabase connection')
    if (addressId) {
        const { error } = await supabase
            .from('addresses')
            .update({ ingredient_sort_order: sortOrderArray })
            .eq('id', addressId)
        if (error) throw error
        return true
    }
    // Default template — write to app_settings (admin-only RLS).
    const { error } = await supabase
        .from('app_settings')
        .upsert({ key: 'default_ingredient_sort_order', value: sortOrderArray, updated_at: new Date().toISOString() })
    if (error) throw error
    return true
}

// Fetch the default-template ingredient sort order (publicly readable so guests can
// inherit it during playground init). Returns [] when missing.
export async function fetchDefaultIngredientSort() {
    if (!supabase) return []
    const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'default_ingredient_sort_order')
        .maybeSingle()
    if (error) {
        // Table may not exist yet (migration not deployed) — fail open.
        if (error.code !== '42P01' && error.code !== 'PGRST116') {
            console.warn('fetchDefaultIngredientSort:', error)
        }
        return []
    }
    return Array.isArray(data?.value) ? data.value : []
}

// =============================================
// Active Sessions (staff presence tracking)
// =============================================

// Upsert active session when user enters POS
export async function upsertSession(userId, addressId) {
    if (isGuest()) return  // guest is local-only — never write active_sessions (non-UUID ids)
    if (!supabase) return
    const { error } = await supabase
        .from('active_sessions')
        .upsert(
            { user_id: userId, address_id: addressId, last_seen: new Date().toISOString() },
            { onConflict: 'user_id' }
        )
    if (error) console.error('upsertSession error:', error)
}

// Remove session on signout
export async function removeSession(userId) {
    if (isGuest()) return  // guest is local-only — never touch active_sessions
    if (!supabase) return
    const { error } = await supabase
        .from('active_sessions')
        .delete()
        .eq('user_id', userId)
    if (error) console.error('removeSession error:', error)
}

// Fetch active sessions for a list of address IDs (last_seen within 10 minutes).
//
// Avoid the embedded `users(name)` join — it triggers RLS on users which calls
// is_admin_auth, a function whose EXECUTE was revoked from anon in migration
// 20260505. If this ever gets reached from an unauthenticated context (e.g.
// future guest/demo mode), the join would fail with `permission denied`.
// Same root cause as the invite-link bug — see validateInviteToken.
//
// Fix: fetch sessions alone, then resolve names in a separate best-effort query.
export async function fetchActiveSessions(addressIds) {
    if (isGuest()) return []
    if (!supabase || !addressIds?.length) return []
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data, error } = await supabase
        .from('active_sessions')
        .select('user_id, address_id, last_seen')
        .in('address_id', addressIds)
        .gte('last_seen', cutoff)
    if (error) {
        console.error('fetchActiveSessions error:', error)
        return []
    }
    if (!data?.length) return []

    // Best-effort name lookup. Authenticated managers/staff can read users via RLS;
    // anonymous contexts can't and we silently degrade to undefined names.
    const userIds = [...new Set(data.map(s => s.user_id))]
    let nameById = {}
    try {
        const { data: usersData } = await supabase
            .from('users')
            .select('id, name')
            .in('id', userIds)
        if (usersData) {
            for (const u of usersData) nameById[u.id] = u.name
        }
    } catch { /* RLS blocked — leave names undefined */ }

    return data.map(s => ({ ...s, users: { name: nameById[s.user_id] } }))
}

// Fetch today's cup count + revenue for multiple addresses in one RPC call.
// Returns { cupsMap, revenueMap } so AddressSelectPage can render both in a
// single round-trip. Falls back to two legacy queries if the RPC isn't
// deployed yet.
export async function fetchBranchesTodayStats(addressIds) {
    if (isGuest()) return { cupsMap: {}, revenueMap: {} }
    if (!supabase || !addressIds?.length) return { cupsMap: {}, revenueMap: {} }

    const { data, error } = await supabase.rpc('get_branches_today_stats', { p_address_ids: addressIds })
    if (!error && Array.isArray(data)) {
        const cupsMap = {}, revenueMap = {}
        for (const row of data) {
            cupsMap[row.address_id] = Number(row.cups || 0)
            revenueMap[row.address_id] = Number(row.revenue || 0)
        }
        return { cupsMap, revenueMap }
    }

    if (error && error.code !== 'PGRST202' && error.code !== '42883') {
        console.error('fetchBranchesTodayStats RPC error:', error)
    }

    // Fallback: single query selecting both total + order_items (was two parallel
    // queries hitting the same orders rows with overlapping filters).
    const today = startOfDayVN()

    const { data: ordersData } = await supabase
        .from('orders')
        .select('address_id, total, order_items(quantity, products(count_as_cup))')
        .in('address_id', addressIds)
        .gte('created_at', today.toISOString())

    const cupsMap = {}, revenueMap = {}
    ;(ordersData || []).forEach(order => {
        const qty = (order.order_items || []).reduce((s, i) => {
            if (i.products?.count_as_cup === false) return s
            return s + i.quantity
        }, 0)
        cupsMap[order.address_id] = (cupsMap[order.address_id] || 0) + qty
        revenueMap[order.address_id] = (revenueMap[order.address_id] || 0) + (order.total || 0)
    })
    return { cupsMap, revenueMap }
}
