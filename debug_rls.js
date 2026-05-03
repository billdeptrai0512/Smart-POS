import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing credentials')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    console.log('--- USERS ---')
    const { data: users, error: err1 } = await supabase.from('users').select('id, auth_id, name, role, manager_id').neq('role', 'admin')
    if (err1) console.error('Error fetching users', err1)
    else console.table(users)

    console.log('--- ADDRESSES ---')
    const { data: addresses, error: err2 } = await supabase.from('addresses').select('id, manager_id, name')
    if (err2) console.error('Error fetching addresses', err2)
    else console.table(addresses)

    console.log('--- USER_ADDRESS_ACCESS ---')
    const { data: uaa, error: err3 } = await supabase.from('user_address_access').select('*')
    if (err3) console.error('Error fetching uaa', err3)
    else console.table(uaa)
    
    // Check if the user_owner_id function works properly
    console.log('--- FIX FUNCTION TEST ---')
    const { data: rpcTest, error: err4 } = await supabase.rpc('user_owner_id', { p_user_id: '00000000-0000-0000-0000-000000000000' })
    console.log('RPC test (expect null or error):', rpcTest, err4?.message)
}

run()
