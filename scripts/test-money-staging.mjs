// Test logic TIỀN BÁN HÀNG ở tầng SQL (bulk_create_orders: giá bán + giá vốn tự tính
// server-side, không tin số client gửi) — chạy trên Supabase STAGING.
//
// Đây là tiền của ĐƠN HÀNG (bán ra) — xem scripts/test-inventory-staging.mjs cho tiền
// NHẬP KHO (process_ingredient_restock và họ hàng).
//
// Bối cảnh: trước 20260708_bulk_create_orders_server_pricing.sql, client tự tính total/
// unit_cost rồi gửi thẳng lên RPC — bất kỳ session nhân viên nào (kể cả tự gọi RPC qua
// DevTools) đều có thể ghi total sai lệch. Giờ RPC tự tính từ products/product_extras
// (giá bán) và recipes/extra_ingredients/ingredient_costs (giá vốn), client chỉ khai
// product_id + quantity + extra_ids. Script này assert đúng điều đó bằng RPC thật, không
// phải chỉ đọc code.
//
// Cần: .env.staging.local với STAGING_SUPABASE_URL + STAGING_SUPABASE_SECRET, và đã chạy
// scripts/staging-order-schema.sql lên staging.
//
//   node scripts/test-money-staging.mjs      (hoặc: npm run test:money)
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

// Fixed test fixtures, tách khỏi test-inventory-staging.mjs (...0001x thay vì ...0001)
// để 2 script chạy trên cùng staging DB không đụng nhau.
const MANAGER_ID = '00000000-0000-4000-8000-000000000011'
const ADDRESS_ID = '00000000-0000-4000-8000-000000000012'
const OTHER_ADDRESS_ID = '00000000-0000-4000-8000-000000000013' // cho case cross-tenant
const ING_MAIN = 'test_ing_tra'
const ING_EXTRA = 'test_ing_duong'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}
async function expectError(name, promise) {
  const { error } = await promise
  check(name, !!error, error ? '' : '(không raise error như mong đợi)')
}

let PRODUCT_ID, EXTRA_ID, OTHER_PRODUCT_ID, OTHER_EXTRA_ID

async function seed() {
  await sb.from('orders').delete().eq('address_id', ADDRESS_ID)          // cascade → order_items
  await sb.from('orders').delete().eq('address_id', OTHER_ADDRESS_ID)
  await sb.from('products').delete().eq('owner_address_id', ADDRESS_ID)  // cascade → product_extras → extra_ingredients, recipes
  await sb.from('products').delete().eq('owner_address_id', OTHER_ADDRESS_ID)
  await sb.from('ingredient_costs').delete().eq('address_id', ADDRESS_ID)

  await sb.from('users').upsert({ id: MANAGER_ID, name: 'Test Manager', role: 'manager' })
  await sb.from('addresses').upsert({ id: ADDRESS_ID, manager_id: MANAGER_ID, name: 'Test Staging Order' })
  await sb.from('addresses').upsert({ id: OTHER_ADDRESS_ID, manager_id: MANAGER_ID, name: 'Test Staging Order — địa chỉ khác' })

  // "Trà sữa" giá 25000, công thức 10 đơn vị nguyên liệu chính @ 50đ/đv = 500đ giá vốn.
  const { data: prod } = await sb.from('products')
    .insert({ name: 'Trà sữa test', price: 25000, owner_address_id: ADDRESS_ID })
    .select('id').single()
  PRODUCT_ID = prod.id

  const { data: extra } = await sb.from('product_extras')
    .insert({ product_id: PRODUCT_ID, address_id: ADDRESS_ID, name: 'Size L test', price: 5000 })
    .select('id').single()
  EXTRA_ID = extra.id

  await sb.from('ingredient_costs').insert([
    { ingredient: ING_MAIN, unit_cost: 50, unit: 'g', address_id: ADDRESS_ID },
    { ingredient: ING_EXTRA, unit_cost: 20, unit: 'g', address_id: ADDRESS_ID },
  ])
  await sb.from('recipes').insert({ product_id: PRODUCT_ID, ingredient: ING_MAIN, amount: 10, address_id: ADDRESS_ID })
  await sb.from('extra_ingredients').insert({ extra_id: EXTRA_ID, ingredient: ING_EXTRA, amount: 5 })

  // Sản phẩm + extra ở ĐỊA CHỈ KHÁC — dùng cho case cross-tenant / extra sai product.
  const { data: otherProd } = await sb.from('products')
    .insert({ name: 'Trà sữa địa chỉ khác', price: 99999, owner_address_id: OTHER_ADDRESS_ID })
    .select('id').single()
  OTHER_PRODUCT_ID = otherProd.id
  const { data: otherExtra } = await sb.from('product_extras')
    .insert({ product_id: OTHER_PRODUCT_ID, address_id: OTHER_ADDRESS_ID, name: 'Extra địa chỉ khác', price: 1 })
    .select('id').single()
  OTHER_EXTRA_ID = otherExtra.id
}

const bulkCreate = (order) => sb.rpc('bulk_create_orders', { orders_payload: [order] })
const orderRow = async (id) => (await sb.from('orders').select('*').eq('id', id).single()).data
const itemRows = async (orderId) => (await sb.from('order_items').select('*').eq('order_id', orderId)).data

async function main() {
  // ── Case 1: giá bán + giá vốn tự tính từ DB, client chỉ khai product_id/quantity/extra_ids ──
  console.log('\nCase 1 — server tự tính total/unit_cost, không cần client gửi giá')
  await seed()
  const orderId1 = '00000000-0000-4000-8000-0000000000a1'
  {
    const { error } = await bulkCreate({
      id: orderId1, address_id: ADDRESS_ID, staff_name: 't', discount_amount: 0,
      items: [{ product_id: PRODUCT_ID, quantity: 2, extra_ids: [EXTRA_ID] }],
    })
    if (error) throw error
    const row = await orderRow(orderId1)
    check('orders.id = id do client sinh (identity, không phải gen_random_uuid)', row?.id === orderId1)
    check('total = 60000 (=(25000+5000)*2, KHÔNG do client gửi)', row?.total === 60000, `got ${row?.total}`)
    check('total_cost = 1200 (=(10*50 + 5*20)*2)', row?.total_cost === 1200, `got ${row?.total_cost}`)
    const items = await itemRows(orderId1)
    check('order_items có 1 dòng, quantity=2', items?.length === 1 && items[0].quantity === 2)
    check('order_items.unit_cost = 600 (giá vốn/đơn vị, chưa nhân quantity)', items?.[0]?.unit_cost === 600, `got ${items?.[0]?.unit_cost}`)
    check('order_items.options tự build = "Size L test" (server, không phải client)', items?.[0]?.options === 'Size L test')
  }

  // ── Case 2: client cố gửi total/unit_cost giả trong payload → RPC bỏ qua, vẫn tính đúng ──
  console.log('\nCase 2 — client gửi total giả bị bỏ qua (không tin client)')
  await seed()
  const orderId2 = '00000000-0000-4000-8000-0000000000a2'
  {
    const { error } = await bulkCreate({
      id: orderId2, address_id: ADDRESS_ID, staff_name: 't', discount_amount: 0,
      total: 1, total_cost: 1, // giả mạo — RPC không đọc field này
      items: [{ product_id: PRODUCT_ID, quantity: 1, extra_ids: [], unit_cost: 1 }],
    })
    if (error) throw error
    const row = await orderRow(orderId2)
    check('total thật = 25000, KHÔNG phải total=1 client gửi', row?.total === 25000, `got ${row?.total}`)
  }

  // ── Case 3: product thuộc địa chỉ KHÁC → RAISE (chặn cross-tenant) ──────────────
  console.log('\nCase 3 — guard: product của địa chỉ khác bị từ chối')
  await seed()
  await expectError('product_id thuộc OTHER_ADDRESS_ID nhưng order gắn ADDRESS_ID → lỗi',
    bulkCreate({
      address_id: ADDRESS_ID, staff_name: 't', discount_amount: 0,
      items: [{ product_id: OTHER_PRODUCT_ID, quantity: 1, extra_ids: [] }],
    }))

  // ── Case 4: extra thuộc product/địa chỉ khác → RAISE ────────────────────────────
  console.log('\nCase 4 — guard: extra không thuộc product này bị từ chối')
  await seed()
  await expectError('extra_ids chứa extra của product khác → lỗi',
    bulkCreate({
      address_id: ADDRESS_ID, staff_name: 't', discount_amount: 0,
      items: [{ product_id: PRODUCT_ID, quantity: 1, extra_ids: [OTHER_EXTRA_ID] }],
    }))

  // ── Case 5: discount_amount trừ đúng vào total đã tính ──────────────────────────
  console.log('\nCase 5 — discount_amount trừ vào total server-computed')
  await seed()
  const orderId5 = '00000000-0000-4000-8000-0000000000a5'
  {
    const { error } = await bulkCreate({
      id: orderId5, address_id: ADDRESS_ID, staff_name: 't', discount_amount: 10000,
      items: [{ product_id: PRODUCT_ID, quantity: 1, extra_ids: [] }],
    })
    if (error) throw error
    const row = await orderRow(orderId5)
    check('total = 15000 (=25000-10000)', row?.total === 15000, `got ${row?.total}`)
  }

  // ── Case 6: retry cùng id (mất response sau khi server đã commit) → không nhân đôi ──
  console.log('\nCase 6 — gọi RPC 2 lần cùng id → chỉ 1 đơn hàng tồn tại (ON CONFLICT DO NOTHING)')
  await seed()
  const orderId6 = '00000000-0000-4000-8000-0000000000a6'
  {
    const order = {
      id: orderId6, address_id: ADDRESS_ID, staff_name: 't', discount_amount: 0,
      items: [{ product_id: PRODUCT_ID, quantity: 3, extra_ids: [EXTRA_ID] }],
    }
    const { error: err1 } = await bulkCreate(order)
    if (err1) throw err1
    const { error: err2 } = await bulkCreate(order) // retry — giống hệt lần gọi trước
    check('retry không raise lỗi (no-op thay vì duplicate-key)', !err2, err2?.message)

    const { count } = await sb.from('orders').select('id', { count: 'exact', head: true }).eq('id', orderId6)
    check('chỉ 1 order tồn tại với id này', count === 1, `got ${count}`)

    const items = await itemRows(orderId6)
    check('order_items chỉ có 1 dòng (không bị insert lại lần retry)', items?.length === 1, `got ${items?.length}`)

    const row = await orderRow(orderId6)
    check('total giữ nguyên đúng từ lần commit đầu = 90000 (=(25000+5000)*3)', row?.total === 90000, `got ${row?.total}`)
  }

  // Dọn sau cùng.
  await sb.from('orders').delete().eq('address_id', ADDRESS_ID)
  await sb.from('orders').delete().eq('address_id', OTHER_ADDRESS_ID)
  await sb.from('products').delete().eq('owner_address_id', ADDRESS_ID)
  await sb.from('products').delete().eq('owner_address_id', OTHER_ADDRESS_ID)
  await sb.from('ingredient_costs').delete().eq('address_id', ADDRESS_ID)

  console.log(`\n${'─'.repeat(48)}\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}  ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error('\n💥 Lỗi chạy:', e.message || e); process.exit(1) })
