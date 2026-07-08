// Test logic TỒN KHO ở tầng SQL (WAC nhập hàng, cash_phase, owing NCC, cancel/edit phiếu)
// — chạy trên Supabase STAGING.
//
// Đây là tiền của NGUYÊN LIỆU/NHẬP KHO (process_ingredient_restock và họ hàng), không phải
// tiền BÁN HÀNG — xem scripts/test-money-staging.mjs cho phần đó (bulk_create_orders).
//
// Vì WAC/cascade sống trong RPC Postgres, không có JS để unit-test. Script này gọi RPC thật
// qua supabase-js (service_role) rồi assert kết quả trả về + đọc lại state.
//
// Cần: .env.staging.local với STAGING_SUPABASE_URL + STAGING_SUPABASE_SECRET, và đã chạy
// scripts/staging-inventory-schema.sql lên staging (tạo 7 bảng + 6 hàm).
//
//   node scripts/test-inventory-staging.mjs      (hoặc: npm run test:inventory)
//
// KHÔNG trỏ prod — prod-guard chặn cứng theo project-ref.

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const PROD_REF = 'cnkvscwmdfkajhotcijl' // prod — CẤM
const env = Object.fromEntries(
  readFileSync(new URL('../.env.staging.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const URL_ = env.STAGING_SUPABASE_URL, KEY = env.STAGING_SUPABASE_SECRET
if (!URL_ || !KEY) { console.error('Thiếu STAGING_SUPABASE_URL / STAGING_SUPABASE_SECRET trong .env.staging.local'); process.exit(1) }
if (URL_.includes(PROD_REF)) { console.error('❌ URL trỏ PROD — abort.'); process.exit(1) }

const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

// Fixed test fixtures (re-runnable: seed() dọn sạch trước mỗi case).
const MANAGER_ID = '00000000-0000-4000-8000-000000000001'
const ADDRESS_ID = '00000000-0000-4000-8000-000000000002'
const ING = 'test_ing_ca_phe'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}
async function expectError(name, promise) {
  const { error } = await promise
  check(name, !!error, error ? '' : '(không raise error như mong đợi)')
}

// Xoá sạch data test-address rồi seed lại user + address + ingredient_costs(0).
// UPDATE ingredient_costs trong RPC chỉ ăn nếu row đã tồn tại → phải seed sẵn.
async function seed() {
  await sb.from('expenses').delete().eq('address_id', ADDRESS_ID)       // cascade → expense_payments
  await sb.from('shift_closings').delete().eq('address_id', ADDRESS_ID)
  await sb.from('ingredient_costs').delete().eq('address_id', ADDRESS_ID)
  await sb.from('users').upsert({ id: MANAGER_ID, name: 'Test Manager', role: 'manager' })
  await sb.from('addresses').upsert({ id: ADDRESS_ID, manager_id: MANAGER_ID, name: 'Test Staging' })
  await sb.from('ingredient_costs').insert({ ingredient: ING, unit_cost: 0, unit: 'g', address_id: ADDRESS_ID })
}

const restock = (p) => sb.rpc('process_ingredient_restock', {
  p_address_id: ADDRESS_ID, p_ingredient: ING, p_staff_name: 't',
  p_payment_method: 'cash', p_cash_phase: 'in_shift', ...p,
})
const unitCost = async () => (await sb.from('ingredient_costs').select('unit_cost')
  .eq('address_id', ADDRESS_ID).eq('ingredient', ING).single()).data?.unit_cost
const paidTotal = async (expId) => ((await sb.from('expense_payments').select('amount')
  .eq('expense_id', expId)).data || []).reduce((s, r) => s + Number(r.amount), 0)
const expenseRow = async (expId) => (await sb.from('expenses').select('amount, metadata')
  .eq('id', expId).single()).data

async function main() {
  // ── Case 1: nhập lần đầu → WAC = amountDue/qty, owing = amountDue − paid ─────
  console.log('\nCase 1 — nhập lần đầu: WAC = amountDue/qty')
  await seed()
  {
    const { data, error } = await restock({ p_qty: 1000, p_subtotal: 100000, p_initial_payment: 100000 })
    if (error) throw error
    check('amount = 100000', data.amount == 100000)
    check('owing = 0 (trả đủ)', data.owing == 0)
    check('new_unit_cost = 100 (=100000/1000)', data.new_unit_cost == 100)
    check('after_stock = 1000', data.after_stock == 1000)
    check('ingredient_costs.unit_cost đã ghi = 100', (await unitCost()) == 100)
  }

  // ── Case 2: nhập lần 2 giá khác (có tồn đếm) → WAC moving-average ────────────
  console.log('\nCase 2 — WAC moving-average trên tồn đã đếm')
  await seed()
  await sb.from('ingredient_costs').update({ unit_cost: 100 }).eq('address_id', ADDRESS_ID).eq('ingredient', ING)
  // shift_closing với remaining=500 → v_current_stock=500 cho WAC.
  await sb.from('shift_closings').insert({ address_id: ADDRESS_ID, inventory_report: [{ ingredient: ING, remaining: 500, restock: 0 }] })
  {
    const { data, error } = await restock({ p_qty: 500, p_subtotal: 150000, p_initial_payment: 150000 })
    if (error) throw error
    // ROUND((500*100 + 150000) / (500+500)) = ROUND(200000/1000) = 200
    check('old_unit_cost = 100', data.old_unit_cost == 100)
    check('new_unit_cost = 200 (moving-average)', data.new_unit_cost == 200, `got ${data.new_unit_cost}`)
  }

  // ── Case 3: discount + extra_cost → amountDue = subtotal − discount + extra ───
  console.log('\nCase 3 — amountDue = subtotal − discount + extra')
  await seed()
  {
    const { data, error } = await restock({ p_qty: 100, p_subtotal: 60000, p_discount: 10000, p_extra_cost: 5000 })
    if (error) throw error
    check('amount = 55000 (60000−10000+5000)', data.amount == 55000, `got ${data.amount}`)
    check('new_unit_cost = 550 (=55000/100)', data.new_unit_cost == 550, `got ${data.new_unit_cost}`)
    check('owing = 0 (paid mặc định = amountDue)', data.owing == 0)
  }

  // ── Case 4: trả một phần → owing đúng; record_invoice_payment → owing 0; overpay bị chặn ─
  console.log('\nCase 4 — trả nợ NCC: partial → record_invoice_payment → owing 0; chặn overpay')
  await seed()
  {
    const { data, error } = await restock({ p_qty: 100, p_subtotal: 100000, p_initial_payment: 40000 })
    if (error) throw error
    check('owing = 60000 sau khi trả 40000', data.owing == 60000, `got ${data.owing}`)
    const { error: e2 } = await sb.rpc('record_invoice_payment', { p_expense_id: data.expense_id, p_amount: 60000, p_cash_phase: 'post_close' })
    check('record_invoice_payment 60000 thành công', !e2, e2?.message)
    check('Σ payments = 100000 (owing về 0)', (await paidTotal(data.expense_id)) == 100000)
    await expectError('trả thêm 1đ → chặn overpay', sb.rpc('record_invoice_payment', { p_expense_id: data.expense_id, p_amount: 1 }))
  }

  // ── Case 5: cash_phase lưu đúng trên phiếu + trên payment ────────────────────
  console.log('\nCase 5 — cash_phase (in_shift vs post_close) lưu đúng')
  await seed()
  {
    const { data } = await restock({ p_qty: 10, p_subtotal: 10000, p_initial_payment: 5000, p_cash_phase: 'in_shift' })
    const row = await expenseRow(data.expense_id)
    check("metadata.cash_phase = 'in_shift' trên phiếu", row?.metadata?.cash_phase === 'in_shift')
    await sb.rpc('record_invoice_payment', { p_expense_id: data.expense_id, p_amount: 5000, p_cash_phase: 'post_close' })
    const pay = (await sb.from('expense_payments').select('cash_phase').eq('expense_id', data.expense_id).eq('amount', 5000)).data
    check("payment trả nợ có cash_phase = 'post_close'", pay?.some(p => p.cash_phase === 'post_close'))
  }

  // ── Case 6: cancel_restock → zero-out + cờ cancelled + hoàn tiền (xoá payments) ─
  console.log('\nCase 6 — cancel_restock: đảo phiếu (amount 0, cancelled, payments xoá)')
  await seed()
  {
    const { data } = await restock({ p_qty: 100, p_subtotal: 100000, p_initial_payment: 100000 })
    const { error } = await sb.rpc('cancel_restock', { p_address_id: ADDRESS_ID, p_expense_id: data.expense_id })
    check('cancel_restock không lỗi', !error, error?.message)
    const row = await expenseRow(data.expense_id)
    check('metadata.cancelled = true', row?.metadata?.cancelled === true)
    check('amount về 0', row?.amount == 0, `got ${row?.amount}`)
    check('payments đã xoá (Σ = 0)', (await paidTotal(data.expense_id)) == 0)
  }

  // ── Case 7: guard — discount âm bị từ chối ─────────────────────────────────
  console.log('\nCase 7 — guard: discount âm bị RAISE')
  await seed()
  await expectError('discount = −1 → error', restock({ p_qty: 10, p_subtotal: 10000, p_discount: -1 }))

  // Dọn sau cùng.
  await sb.from('expenses').delete().eq('address_id', ADDRESS_ID)
  await sb.from('shift_closings').delete().eq('address_id', ADDRESS_ID)
  await sb.from('ingredient_costs').delete().eq('address_id', ADDRESS_ID)

  console.log(`\n${'─'.repeat(48)}\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}  ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error('\n💥 Lỗi chạy:', e.message || e); process.exit(1) })
