// Chẩn đoán ngày có >1 phiếu chốt ca (gây double-count báo cáo Tuần/Tháng).
// Cần đăng nhập manager để vượt RLS. Cách chạy:
//   SB_EMAIL=manager@... SB_PASSWORD=... node scratch/diag_dup_closings.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`${k}=(.*)`)) || [])[1]?.trim()

const sb = createClient(get('VITE_SUPABASE_URL'), get('VITE_SUPABASE_ANON_KEY'))

const email = process.env.SB_EMAIL
const password = process.env.SB_PASSWORD
if (!email || !password) {
  console.error('Thiếu SB_EMAIL / SB_PASSWORD (tài khoản manager).')
  process.exit(1)
}
const { error: authErr } = await sb.auth.signInWithPassword({ email, password })
if (authErr) { console.error('Đăng nhập lỗi:', authErr.message); process.exit(1) }

const { data, error } = await sb
  .from('shift_closings')
  .select('id, address_id, closed_at, actual_cash, actual_transfer')
if (error) { console.error('Query lỗi:', error.message); process.exit(1) }

// Gom theo (address_id, ngày VN)
const vnDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const byKey = new Map()
for (const r of data) {
  const key = `${r.address_id}|${vnDate(r.closed_at)}`
  if (!byKey.has(key)) byKey.set(key, [])
  byKey.get(key).push(r)
}

let dupDays = 0, cashOver = 0, transferOver = 0
const details = []
for (const [key, rows] of byKey) {
  if (rows.length <= 1) continue
  dupDays++
  rows.sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at)) // mới nhất trước
  const latest = rows[0]
  const sumCash = rows.reduce((s, r) => s + (r.actual_cash || 0), 0)
  const sumTransfer = rows.reduce((s, r) => s + (r.actual_transfer || 0), 0)
  const cashDiff = sumCash - (latest.actual_cash || 0)
  const transferDiff = sumTransfer - (latest.actual_transfer || 0)
  cashOver += cashDiff
  transferOver += transferDiff
  const [addr, d] = key.split('|')
  details.push({ addr, date: d, n: rows.length, sumCash, latestCash: latest.actual_cash || 0, cashDiff, sumTransfer, latestTransfer: latest.actual_transfer || 0, transferDiff })
}

console.log(`Tổng số (address, ngày): ${byKey.size}`)
console.log(`Số ngày có >1 phiếu     : ${dupDays}`)
console.log(`Tiền mặt bị cộng dư      : ${cashOver.toLocaleString('vi-VN')} đ`)
console.log(`Chuyển khoản bị cộng dư  : ${transferOver.toLocaleString('vi-VN')} đ`)
if (details.length) {
  console.log('\nChi tiết ngày trùng:')
  console.table(details)
}
