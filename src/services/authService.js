import { supabase } from '../lib/supabaseClient'
import { isGuest } from './localRepository'
import { startOfDayVN } from '../utils/dateVN'
import { computeSubscriptionStatus } from '../utils/subscriptionStatus'

// Canonical login username: lowercase, only [a-z0-9_.-]. This is what the user
// actually types to log in, so it's also what we persist to users.username.
const sanitizeUsername = (username) => username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')

// Formats username to a dummy email for Supabase Auth
const formatUsernameToEmail = (username) => `${sanitizeUsername(username)}@coffee.local`

// Sign in with username and password via Supabase Auth
export async function signIn(username, password) {
    if (!supabase) throw new Error('No Supabase connection')
    const email = formatUsernameToEmail(username)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
}

// Sign up: creates manager Auth user + profile row.
// Email tuỳ chọn — đăng nhập dùng username (→ email giả), chưa có flow reset
// password qua email. Chỉ validate khi có nhập.
export async function signUp(username, password, name, email) {
    if (!supabase) throw new Error('No Supabase connection')

    const trimmedEmail = (email || '').trim()
    if (trimmedEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(trimmedEmail)) {
            throw new Error('Email không hợp lệ')
        }
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
        .insert({ auth_id: authUser.id, name, role: 'manager', manager_id: null, email: trimmedEmail || null, username: sanitizeUsername(username) })
        .select()
        .single()

    if (profileError) throw profileError
    return { user: authUser, profile }
}

// Create a team member directly via Edge Function
export async function createTeamMember(name, username, password, role) {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase.functions.invoke('create-team-member', {
        body: { name, username, password, role },
    })
    if (error) {
        // FunctionsHttpError wraps the response; dig out our JSON message.
        let msg = error.message
        try { const ctx = await error.context?.json(); if (ctx?.error) msg = ctx.error } catch { /* keep msg */ }
        throw new Error(msg)
    }
    // Edge Function trả { error: "..." } với status 4xx/5xx nhưng supabase-js
    // vẫn có thể đặt vào data thay vì error tuỳ phiên bản SDK.
    if (data?.error) {
        throw new Error(data.error)
    }
    return data
}

// Fetch staff and co-managers belonging to a manager
export async function fetchStaffByManager(managerId) {
    if (isGuest()) return []
    if (!supabase) return []
    const { data, error } = await supabase
        .from('users')
        .select('id, name, role, username')
        .in('role', ['staff', 'manager'])
        .eq('manager_id', managerId)
        .order('name')
    if (error) {
        console.error('fetchStaffByManager error:', error)
        return []
    }
    return data
}

// Lần hoạt động gần nhất của từng thành viên — GREATEST(auth.users.last_sign_in_at,
// active_sessions.last_seen) qua RPC vì client không query thẳng schema auth được.
// Trả về Map<userId, ISOString|null>.
export async function fetchStaffLastLogins(userIds) {
    if (isGuest() || !supabase || !userIds.length) return new Map()
    const { data, error } = await supabase.rpc('get_staff_last_logins', { p_user_ids: userIds })
    if (error) {
        console.error('fetchStaffLastLogins error:', error)
        return new Map()
    }
    return new Map((data || []).map(r => [r.user_id, r.last_sign_in_at]))
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

// Rename a team member. Authorization enforced server-side by set_team_member_name RPC.
export async function setTeamMemberName(userId, name) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.rpc('set_team_member_name', { p_user_id: userId, p_name: name })
    if (error) throw error
}

// Prefetch the whole team's revoked rows in one query so opening a member panel is
// instant (no per-open round trip). RLS scopes the result to the caller's team.
// Returns rows [{ user_id, address_id }].
export async function fetchTeamRevokedAddresses() {
    if (!supabase) return []
    const { data, error } = await supabase
        .from('user_address_revoked')
        .select('user_id, address_id')
    if (error) {
        console.error('fetchTeamRevokedAddresses error:', error)
        return []
    }
    return data
}

// Branch visibility uses a REVOKE model (default = see all). Returns the set of
// address IDs this staff member is BLOCKED from. RLS lets only their manager read.
export async function fetchStaffRevokedAddresses(userId) {
    if (!supabase) return []
    const { data, error } = await supabase
        .from('user_address_revoked')
        .select('address_id')
        .eq('user_id', userId)
    if (error) {
        console.error('fetchStaffRevokedAddresses error:', error)
        return []
    }
    return data.map(r => r.address_id)
}

// Toggle one branch's visibility for one staff member (p_allowed: true = can see).
export async function setStaffAddressAccess(userId, addressId, allowed) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.rpc('set_staff_address_access', {
        p_user_id: userId, p_address_id: addressId, p_allowed: allowed,
    })
    if (error) throw error
}

// Reset a team member's login password — manager-only, via Edge Function (needs
// service_role; the browser SDK can only change the current user's own password).
export async function setStaffPassword(userId, password) {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase.functions.invoke('set-staff-password', {
        body: { user_id: userId, password },
    })
    if (error) {
        // functions.invoke wraps a non-2xx response in FunctionsHttpError; dig out our JSON message.
        let msg = error.message
        try { const ctx = await error.context?.json(); if (ctx?.error) msg = ctx.error } catch { /* keep msg */ }
        throw new Error(msg)
    }
    return data
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

// Trạng thái gói ('trial'|'paid'|'none') + rows thô cho từng address — 1 query
// duy nhất dùng chung cho sort BranchGrid, SubscriptionBadge (badge từng card) và
// SubscriptionPanel (chip Đã mở/Chưa mở) — trước đây 3 nơi tự fetch riêng (N+1).
export async function fetchSubscriptionStatuses(addressIds) {
    if (isGuest() || !supabase || !addressIds.length) return { statusMap: {}, rowsMap: {} }
    const { data, error } = await supabase
        .from('address_subscriptions')
        .select('address_id, valid_from, valid_to, note')
        .in('address_id', addressIds)
    if (error) {
        console.error('fetchSubscriptionStatuses error:', error)
        return { statusMap: {}, rowsMap: {} }
    }
    const rowsMap = {}
    ;(data || []).forEach(r => { (rowsMap[r.address_id] ??= []).push(r) })
    const statusMap = {}
    addressIds.forEach(id => {
        // 0 row = địa chỉ chưa từng full-close lần nào → đang free tạm chờ ca full
        // đầu tiên (trial không còn giới hạn theo SĐT, xem 20260717_trial_4_
        // per_address_not_per_phone.sql) → luôn là 'pending', không có case nào
        // khác nữa nên không cần RPC riêng để phân biệt.
        statusMap[id] = rowsMap[id]?.length ? computeSubscriptionStatus(rowsMap[id]).status : 'pending'
    })
    return { statusMap, rowsMap }
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

// Kho tổng dùng chung nhiều địa chỉ — nhóm thuộc về 1 manager (RLS lọc theo manager_id/user_address_access).
export async function fetchWarehouseGroups(managerId) {
    if (!supabase) return { data: [], error: null }
    const { data, error } = await supabase
        .from('warehouse_groups')
        .select('*')
        .eq('manager_id', managerId)
        .order('created_at')
    if (error) {
        console.error('fetchWarehouseGroups error:', error)
        return { data: [], error }
    }
    return { data: data || [], error: null }
}

// p_group_id null → tạo nhóm mới; có giá trị → đổi tên. Trả về group id.
export async function upsertWarehouseGroup(groupId, name) {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase.rpc('upsert_warehouse_group', { p_group_id: groupId, p_name: name })
    if (error) throw error
    return data
}

export async function deleteWarehouseGroup(groupId) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.rpc('delete_warehouse_group', { p_group_id: groupId })
    if (error) throw error
    return true
}

// p_group_id null → rời nhóm (kho tổng độc lập trở lại).
export async function setAddressWarehouseGroup(addressId, groupId) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.rpc('set_address_warehouse_group', { p_address_id: addressId, p_group_id: groupId })
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
// Avoid the embedded `users(name)` join — it triggers RLS on users which now
// scopes reads to the caller's own team (20260711 fix). If this ever gets
// reached from an unauthenticated context (e.g. future guest/demo mode), the
// join would fail with `permission denied`.
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
    let userById = {}
    try {
        const { data: usersData } = await supabase
            .from('users')
            .select('id, name, role')
            .in('id', userIds)
        if (usersData) {
            for (const u of usersData) userById[u.id] = { name: u.name, role: u.role }
        }
    } catch { /* RLS blocked — leave names undefined */ }

    return data.map(s => ({ ...s, users: userById[s.user_id] || {} }))
}

// Count active sessions for a SINGLE address (last_seen within 10 minutes). Used
// to gate the orders-realtime channel in POSContext: a 1-device shift has nothing
// to sync cross-device, so the channel only opens when this returns >= 2. Same
// cutoff/window as fetchActiveSessions, just scoped to one address and returning
// a count instead of rows (no need for the name-lookup join here).
export async function countActiveSessions(addressId) {
    if (isGuest()) return 0
    if (!supabase || !addressId) return 0
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { count, error } = await supabase
        .from('active_sessions')
        .select('user_id', { count: 'exact', head: true })
        .eq('address_id', addressId)
        .gte('last_seen', cutoff)
    if (error) {
        console.error('countActiveSessions error:', error)
        return 0
    }
    return count || 0
}

// Group fetchActiveSessions rows into { addressId: [{ name, role }] } — dùng làm
// fallback khi RPC gộp sessions chưa deploy (see 20260703_branches_stats_include_sessions).
async function legacySessionsMap(addressIds) {
    const sessions = await fetchActiveSessions(addressIds)
    const grouped = {}
    for (const s of sessions) {
        if (!grouped[s.address_id]) grouped[s.address_id] = []
        grouped[s.address_id].push({ name: s.users?.name || 'Unknown', role: s.users?.role })
    }
    return grouped
}

// Fetch today's cup count + revenue + active sessions (kèm tên/role) for multiple
// addresses in ONE RPC round-trip (was 3 sequential queries at login). Returns
// { cupsMap, revenueMap, sessionsMap }. Falls back to legacy queries if the
// updated RPC isn't deployed yet.
export async function fetchBranchesTodayStats(addressIds) {
    const empty = { cupsMap: {}, revenueMap: {}, prevRevenueMap: {}, prevCupsMap: {}, sessionsMap: {} }
    if (isGuest()) return empty
    if (!supabase || !addressIds?.length) return empty

    const { data, error } = await supabase.rpc('get_branches_today_stats', { p_address_ids: addressIds })
    if (!error && Array.isArray(data)) {
        const cupsMap = {}, revenueMap = {}, prevRevenueMap = {}, prevCupsMap = {}, sessionsMap = {}
        for (const row of data) {
            cupsMap[row.address_id] = Number(row.cups || 0)
            revenueMap[row.address_id] = Number(row.revenue || 0)
            prevRevenueMap[row.address_id] = Number(row.prev_revenue || 0)
            prevCupsMap[row.address_id] = Number(row.prev_cups || 0)
            sessionsMap[row.address_id] = (row.sessions || []).map(s => ({ name: s.name || 'Unknown', role: s.role }))
        }
        // RPC bản cũ chưa có cột sessions (hoặc trả rỗng vì chưa migrate) → lấy rời như trước.
        const hasSessions = data.length > 0 && data[0].sessions !== undefined
        return { cupsMap, revenueMap, prevRevenueMap, prevCupsMap, sessionsMap: hasSessions ? sessionsMap : await legacySessionsMap(addressIds) }
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
    // Legacy fallback không tính prev — thiếu delta thì card chỉ ẩn phần ↑/↓%.
    return { cupsMap, revenueMap, prevRevenueMap: {}, prevCupsMap: {}, sessionsMap: await legacySessionsMap(addressIds) }
}
