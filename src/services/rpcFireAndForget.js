import { supabase } from '../lib/supabaseClient'

// Chung 1 lối gọi cho các RPC không cần chờ kết quả: fire-and-forget, nuốt cả lỗi trả về lẫn
// lỗi reject (mất mạng). KHÔNG bao giờ throw, KHÔNG await, KHÔNG chặn luồng của caller.
export function fireAndForget(fn, args, logPrefix) {
    try {
        if (!supabase) return
        supabase.rpc(fn, args).then(
            ({ error }) => { if (error) console.warn(`[${logPrefix}] ${fn} failed:`, error.message) },
            (err) => console.warn(`[${logPrefix}] ${fn} rejected:`, err),
        )
    } catch (err) {
        console.warn(`[${logPrefix}] ${fn} threw:`, err)
    }
}
