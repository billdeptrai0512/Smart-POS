import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'; // try passing it if possible
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'dummy';

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function run() {
    const { data, error } = await supabase.from('products').select('*').limit(1);
    console.log('Error:', error);
    console.log('Data:', data);
}

run();
