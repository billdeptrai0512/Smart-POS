// Monetization flag (app_config) — cache theo trạng thái đăng nhập.
// Nguồn: src/hooks/useEntitlement.js (loadServerFlag)
//
// Guest đọc bằng anon key → RLS trả rỗng → false. Guest đăng ký/đăng nhập ngay trong tab
// (không reload) mà dùng lại cache false đó thì badge gói biến mất khỏi mọi card ở
// /addresses tới khi F5 — bug đã tái diễn nhiều lần.

import { it, expect, vi } from 'vitest'

let authed = false
const maybeSingle = vi.fn(() => Promise.resolve({ data: authed ? { value: 'true' } : null, error: null }))
vi.mock('../../src/lib/supabaseClient', () => ({
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({}) }))
vi.mock('../../src/contexts/AddressContext', () => ({ useAddress: () => ({}) }))

const { loadServerFlag } = await import('../../src/hooks/useEntitlement')

it('guest → đăng nhập cùng tab: đọc lại thay vì dùng cache false của anon', async () => {
    expect(await loadServerFlag(false)).toBe(false)
    expect(await loadServerFlag(false)).toBe(false)
    expect(maybeSingle).toHaveBeenCalledTimes(1) // cùng trạng thái đăng nhập → dùng cache

    authed = true
    expect(await loadServerFlag(true)).toBe(true)
    expect(maybeSingle).toHaveBeenCalledTimes(2)
})
