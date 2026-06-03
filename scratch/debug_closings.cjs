const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://cnkvscwmdfkajhotcijl.supabase.co/';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNua3ZzY3dtZGZrYWpob3RjaWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NTM1ODcsImV4cCI6MjA5MDMyOTU4N30.D_Rj0_Z_FU6XX_1Vd5koKXzfxet600sR4TKt9u2lCVI';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
    const { data, error } = await supabase.from('shift_closings').select('*').limit(5);
    console.log('Error:', error);
    console.log('Data:', data);
}
run();
