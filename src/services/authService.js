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

// Sign up: creates Auth user + profile row in one step
export async function signUp(username, password, name, role = 'staff', managerId = null) {
    if (!supabase) throw new Error('No Supabase connection')

    const email = formatUsernameToEmail(username)

    // 1. Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })
    if (authError) throw authError

    let authUser = authData.user
    if (!authUser) throw new Error('Đăng ký thất bại')

    // Lỗi vi phạm RLS (Row Level Security) khi insert user profile thường là do 
    // Supabase chưa trả về Session (chưa thực sự logged in) ngay lúc gọi hàm signUp.
    // Chúng ta bắt buộc phải ép hệ thống Login lấy Session trước khi ghi data vào bảng users.
    if (!authData.session) {
        const { data: signData, error: signError } = await supabase.auth.signInWithPassword({ email, password })
        if (signError) throw new Error('Tài khoản đã tạo nhưng không thể tự động đăng nhập (Có thể Supabase vẫn đòi xác nhận Email): ' + signError.message)
        authUser = signData.user
    }

    // 2. Create profile row linked to auth user
    const profileData = {
        auth_id: authUser.id,
        name,
        role,
        manager_id: role === 'staff' ? managerId : null
    }

    const { data: profile, error: profileError } = await supabase
        .from('users')
        .insert(profileData)
        .select()
        .single()

    if (profileError) throw profileError
    return { user: authUser, profile }
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
export async function fetchAddresses(managerId) {
    if (!supabase) return []

    let query = supabase.from('addresses').select('*').order('created_at')

    if (managerId !== 'ALL') {
        query = query.eq('manager_id', managerId)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchAddresses error:', error)
        return []
    }
    return data
}

// Create a new address for a manager
export async function createAddress(managerId, name) {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase
        .from('addresses')
        .insert({ manager_id: managerId, name })
        .select()
        .single()
    if (error) throw error
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
    if (error) throw error
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

// Fetch today's cup count for multiple addresses in one query
export async function fetchBranchTodayCups(addressIds) {
    if (!supabase || !addressIds?.length) return {}
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Fetch all today's orders across those addresses
    const { data: orders, error: ordErr } = await supabase
        .from('orders')
        .select('id, address_id')
        .in('address_id', addressIds)
        .gte('created_at', today.toISOString())

    if (ordErr || !orders?.length) return {}

    const orderIds = orders.map(o => o.id)

    // Fetch all items for those orders
    const { data: items, error: itemErr } = await supabase
        .from('order_items')
        .select('order_id, quantity')
        .in('order_id', orderIds)

    if (itemErr) {
        console.error('fetchBranchTodayCups items error:', itemErr)
        return {}
    }

    // Map order_id -> address_id
    const orderAddrMap = {}
    orders.forEach(o => { orderAddrMap[o.id] = o.address_id })

    // Sum quantities per address
    const result = {}
    items.forEach(item => {
        const addrId = orderAddrMap[item.order_id]
        result[addrId] = (result[addrId] || 0) + item.quantity
    })
    return result
}
