import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cnkvscwmdfkajhotcijl.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNua3ZzY3dtZGZrYWpob3RjaWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NTM1ODcsImV4cCI6MjA5MDMyOTU4N30.D_Rj0_Z_FU6XX_1Vd5koKXzfxet600sR4TKt9u2lCVI'

const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
    const { data, error } = await supabase
        .from('orders')
        .select('id, total, created_at, order_items(quantity, product_id)')
        .order('created_at', { ascending: false })
        .limit(5)

    if (error) console.error(error)
    else console.dir(data, { depth: null })
}

run()
