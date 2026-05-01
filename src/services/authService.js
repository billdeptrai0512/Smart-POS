import { supabase } from '../lib/supabaseClient'

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
export async function validateInviteToken(token) {
    if (!supabase) return { valid: false, error: 'No connection' }
    const { data, error } = await supabase
        .from('invite_tokens')
        .select('id, manager_id, role, expires_at, used_at, users(name)')
        .eq('token', token)
        .maybeSingle()

    if (error || !data) return { valid: false, error: 'Link không hợp lệ' }
    if (data.used_at) return { valid: false, error: 'Link này đã được sử dụng' }
    if (new Date(data.expires_at) < new Date()) return { valid: false, error: 'Link đã hết hạn' }

    return { valid: true, tokenId: data.id, managerId: data.manager_id, managerName: data.users?.name, role: data.role || 'staff' }
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

// Fetch all managers (for staff signup selection)
export async function fetchManagers() {
    if (!supabase) return []
    const { data, error } = await supabase
        .from('users')
        .select('id, name')
        .eq('role', 'manager')
        .order('name')
    if (error) {
        console.error('fetchManagers error:', error)
        return []
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

// Update ingredient sort order for an address
export async function updateAddressIngredientSort(addressId, sortOrderArray) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('addresses')
        .update({ ingredient_sort_order: sortOrderArray })
        .eq('id', addressId)
    if (error) throw error
    return true
}

// =============================================
// Active Sessions (staff presence tracking)
// =============================================

// Upsert active session when user enters POS
export async function upsertSession(userId, addressId) {
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
    if (!supabase) return
    const { error } = await supabase
        .from('active_sessions')
        .delete()
        .eq('user_id', userId)
    if (error) console.error('removeSession error:', error)
}

// Fetch active sessions for a list of address IDs (last_seen within 10 minutes)
export async function fetchActiveSessions(addressIds) {
    if (!supabase || !addressIds?.length) return []
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data, error } = await supabase
        .from('active_sessions')
        .select('user_id, address_id, last_seen, users(name)')
        .in('address_id', addressIds)
        .gte('last_seen', cutoff)
    if (error) {
        console.error('fetchActiveSessions error:', error)
        return []
    }
    return data
}

// Fetch today's cup count + revenue for multiple addresses in one RPC call.
// Returns { cupsMap, revenueMap } so AddressSelectPage can render both in a
// single round-trip. Falls back to two legacy queries if the RPC isn't
// deployed yet.
export async function fetchBranchesTodayStats(addressIds) {
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

    // Fallback: two legacy queries
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [{ data: cupsData }, { data: revData }] = await Promise.all([
        supabase
            .from('orders')
            .select('address_id, order_items(quantity, products(count_as_cup))')
            .in('address_id', addressIds)
            .gte('created_at', today.toISOString()),
        supabase
            .from('orders')
            .select('address_id, total')
            .in('address_id', addressIds)
            .gte('created_at', today.toISOString())
    ])

    const cupsMap = {}, revenueMap = {}
    ;(cupsData || []).forEach(order => {
        const qty = (order.order_items || []).reduce((s, i) => {
            if (i.products?.count_as_cup === false) return s
            return s + i.quantity
        }, 0)
        cupsMap[order.address_id] = (cupsMap[order.address_id] || 0) + qty
    })
    ;(revData || []).forEach(order => {
        revenueMap[order.address_id] = (revenueMap[order.address_id] || 0) + (order.total || 0)
    })
    return { cupsMap, revenueMap }
}
