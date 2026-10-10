import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { startOfDayVN } from '../utils/dateVN'
import { inflightCache } from './cache'
import type { UUID, Row, SupabaseError } from '../types/domain'

// Stock numbers are stored as floats (WAC math can produce arbitrary precision).
// Card UI rounds to 1 decimal; persist the same precision so historical reads
// don't reveal accumulated float noise. Also used by restockService for the
// same before/after-stock snapshots.
export function roundStock(x: number) {
    return Math.round(x * 10) / 10
}

// current_stock = warehouse_stock + counter_stock, trong đó:
//   warehouse_stock = Σ refill (đi chợ qua /ingredient) − Σ restock chỉ tính từ shift_closings xảy ra
//                     SAU lần refill đầu tiên của nguyên liệu đó (restock trước đó là tồn pre-system, bỏ qua).
//   counter_stock   = remaining từ shift_closing gần nhất; nếu nguyên liệu CHƯA từng có remaining
//                     (chưa qua lần chốt ca nào) thì fallback về opening gần nhất — cho phép nhập
//                     tồn quầy lúc setup ban đầu (trước khi có phiếu chốt ca nào) vẫn hiện ra ngay.
// Nếu chưa có refill nào → warehouse=0; chưa có shift_closing → counter=0.
//
// RPC `get_ingredient_stocks_v2` aggregate server-side (1 round-trip).
// Trang + dải notice + hook kiểm kê mount cùng lúc đều gọi hàm này → chung 1 round-trip (xem inflightCache).
export const fetchIngredientStocks = (addressId: UUID | null) =>
    inflightCache.through([addressId, 'ingredientStocks'], () => fetchIngredientStocksUncached(addressId))

async function fetchIngredientStocksUncached(addressId: UUID | null) {
    if (localRepo.isGuest()) return localRepo.fetchLocalIngredientStocks(addressId)

    // Default address (addressId=null) = global playground template. Anon callers can't
    // read expenses/shift_closings directly (RLS), so use a SECURITY DEFINER RPC that
    // returns aggregated stock for address_id IS NULL.
    const isDefault = !addressId
    // *_set: true/false phân biệt "chưa nhập" với "đã nhập = 0". get_ingredient_stocks_v2 trả
    // cờ thật; get_default_ingredient_stocks không có cờ nên suy
    // luận lại từ số lượng (> 0) ngay tại đây — caller luôn nhận boolean thật, khỏi cần biết
    // RPC nào đang phục vụ request.
    const mapRow = (row: Row) => {
        const warehouse_stock = Number(row.warehouse_stock) || 0
        const counter_stock = Number(row.counter_stock) || 0
        return {
            ingredient: row.ingredient,
            current_stock: Number(row.current_stock) || 0,
            restocked_qty: Number(row.restocked_qty) || 0,
            warehouse_stock,
            counter_stock,
            warehouse_stock_set: row.warehouse_stock_set ?? (warehouse_stock > 0),
            counter_stock_set: row.counter_stock_set ?? (counter_stock > 0),
            // Mốc đếm cuối (migration 20261005); path không có cột này (default template) → null = không ước tính.
            counter_counted_on: (row.counter_counted_on ?? null) as string | null,
            restock_since_count: Number(row.restock_since_count) || 0,
            // Lần đếm gần nhất TRƯỚC hôm nay (migration 20261007) — để Đầu kỳ hôm nay tính lại được kể cả khi NVL vừa được đếm hôm nay.
            prior_counter_stock: row.prior_counter_stock == null ? null : Number(row.prior_counter_stock),
            prior_counted_on: (row.prior_counted_on ?? null) as string | null,
            prior_restock_since: Number(row.prior_restock_since) || 0
        }
    }

    const { data, error } = isDefault
        ? await supabase.rpc('get_default_ingredient_stocks')
        : await supabase.rpc('get_ingredient_stocks_v2', { p_address_id: addressId })
    if (error || !data) {
        console.error('ingredient stocks RPC error:', error)
        return []
    }
    return data.map(mapRow)
}

// Per-ingredient daily metrics for /inventory expand-on-click context (Task 3.8).
// Returns map ingredient → { today_refill, today_restock }. Combine with current
// warehouse_stock (from fetchIngredientStocks) to derive:
//   warehouse_end_of_today   = current warehouse_stock
//   warehouse_start_of_today = warehouse_end + today_restock − today_refill
export async function fetchIngredientDailyContext(addressId: UUID | null) {
    const startISO = startOfDayVN().toISOString()
    if (localRepo.isGuest()) {
        const startMs = new Date(startISO).getTime()
        const result: Record<string, { today_refill: number; today_restock: number }> = {}
        const expenses = localRepo.fetchAllLocalExpenses(addressId)
        for (const e of expenses) {
            if (!e.is_refill || !e.metadata?.ingredient) continue
            if (new Date(e.created_at).getTime() < startMs) continue
            const ing = e.metadata.ingredient
            result[ing] = result[ing] || { today_refill: 0, today_restock: 0 }
            result[ing].today_refill += Number(e.metadata.qty || 0)
        }
        const closings = localRepo.fetchAllLocalShiftClosings(addressId)
        for (const sc of closings) {
            if (new Date(sc.created_at).getTime() < startMs) continue
            for (const item of (sc.inventory_report || [])) {
                if (!item.ingredient) continue
                result[item.ingredient] = result[item.ingredient] || { today_refill: 0, today_restock: 0 }
                result[item.ingredient].today_restock += Number(item.restock || 0)
            }
        }
        return result
    }
    const isDefault = !addressId
    const apply = (q: any) => isDefault ? q.is('address_id', null) : q.eq('address_id', addressId)
    const [refillsRes, closingsRes] = await Promise.all([
        apply(supabase.from('expenses').select('metadata')).eq('is_refill', true).gte('created_at', startISO),
        apply(supabase.from('shift_closings').select('inventory_report')).gte('created_at', startISO)
    ])
    const result: Record<string, { today_refill: number; today_restock: number }> = {}
    for (const e of refillsRes.data || []) {
        const ing = e.metadata?.ingredient
        if (!ing) continue
        result[ing] = result[ing] || { today_refill: 0, today_restock: 0 }
        result[ing].today_refill += Number(e.metadata?.qty || 0)
    }
    for (const sc of closingsRes.data || []) {
        for (const item of (sc.inventory_report || [])) {
            if (!item.ingredient) continue
            result[item.ingredient] = result[item.ingredient] || { today_refill: 0, today_restock: 0 }
            result[item.ingredient].today_restock += Number(item.restock || 0)
        }
    }
    return result
}

// Lượt "rút từ kho ra quầy" của 1 nguyên liệu trong khoảng thời gian — chính là số
// "Nhập thêm" (restock) ghi trong phiếu chốt ca (shift_closings.inventory_report).
// Nhật ký NVL hiển thị mỗi phiếu có restock > 0 thành 1 card riêng (chuyển kho nội
// bộ, không có tiền).
//
// Snapshot "Tồn kho trước → sau" được DỰNG LẠI bằng replay toàn bộ lịch sử của
// nguyên liệu (mọi phiếu nhập/hiệu chỉnh + mọi lượt rút, không chỉ tháng đang xem)
// — cùng quy tắc với fetchIngredientStocks: rút TRƯỚC lần nhập kho đầu tiên không
// trừ kho (snapshot để null). Vì vậy phải fetch full-history thay vì chỉ cửa sổ tháng.
//
// NEO theo snapshot (chống trôi số): mỗi phiếu nhập/hiệu chỉnh có `after_stock` lưu
// sẵn = "chốt số kho" tại thời điểm đó. Replay RESET kho về after_stock thay vì cộng
// dồn qty → một lần kiểm kê/sửa kho đóng vai trò mốc tuyệt đối, không bị cộng đôi và
// không tích lũy sai số do kho âm/hiệu chỉnh trước đó. Phiếu cũ (trước migration
// 20260529, after_stock null) vẫn cộng dồn qty như cũ.
//
// staff_name = người TẠO phiếu chốt ca (closed_by) — phiếu được người khác sửa
// sau đó thì không có dấu vết, đành chịu (DB không ghi ai update).
// Trả về [{ id, created_at, qty, before_stock, after_stock, staff_name }] DESC.
// addressIds: mảng — 1 phần tử cho địa chỉ độc lập, nhiều phần tử khi thuộc 1 warehouse group
// (kho tổng dùng chung). Khi nhóm (>1 phần tử), replay KHÔNG được dùng mốc neo after_stock (chỉ
// đúng trên timeline 1 địa chỉ) — luôn cộng dồn qty thuần, khớp anchor_cte trong
// get_ingredient_stocks_v2. RLS tự giới hạn kết quả theo quyền của người gọi (xem ghi chú ở
// fetchIngredientRestockHistory).
export async function fetchIngredientWithdrawals(addressIds: UUID[] | UUID | null, ingredient: string, fromDate: string | Date, toDate: string | Date) {
    const ids = (Array.isArray(addressIds) ? addressIds : [addressIds]).filter(Boolean) as UUID[]
    const isGrouped = ids.length > 1
    const replay = (refills: Row[], closings: Row[]) => {
        const events = []
        for (const e of refills || []) {
            if (e.metadata?.ingredient !== ingredient) continue
            // FIX: bỏ qua phiếu cancelled — snapshot "chết" không nên tham gia replay
            if (e.metadata?.cancelled) continue
            const after = Number(e.metadata?.after_stock)
            events.push({
                t: new Date(e.created_at).getTime(),
                kind: 'refill',
                qty: Number(e.metadata?.qty) || 0,
                // Có snapshot → mốc neo tuyệt đối; null (phiếu cũ) hoặc đang ở nhóm → cộng dồn qty.
                anchor: (!isGrouped && Number.isFinite(after)) ? after : null,
            })
        }
        for (const c of closings || []) {
            const report = Array.isArray(c.inventory_report) ? c.inventory_report : []
            const item = report.find(i => i?.ingredient === ingredient)
            const qty = Number(item?.restock) || 0
            if (qty <= 0) continue
            events.push({
                t: new Date(c.created_at).getTime(),
                kind: 'withdrawal',
                qty,
                id: c.id || c.created_at,
                created_at: c.created_at,
                staff_name: c.closer?.name || null,
                address_id: c.address_id,
            })
        }
        // Cùng timestamp (hiếm): cho refill chạy trước để kho không âm giả.
        events.sort((a, b) => a.t - b.t
            || (a.kind === b.kind ? 0 : a.kind === 'refill' ? -1 : 1))

        const fromMs = new Date(fromDate).getTime()
        const toMs = new Date(toDate).getTime()
        const out = []
        let warehouse = 0
        let started = false
        for (const ev of events) {
            if (ev.kind === 'refill') {
                // Snapshot có sẵn (chỉ khi KHÔNG grouped) → neo kho về after_stock. Còn lại cộng dồn.
                if (ev.anchor != null) warehouse = ev.anchor
                else warehouse += ev.qty
                started = true
                continue
            }
            let before = null, after = null
            if (started) {
                before = roundStock(warehouse)
                warehouse -= ev.qty
                after = roundStock(warehouse)
            }
            if (ev.t >= fromMs && ev.t <= toMs) {
                out.push({
                    id: ev.id, created_at: ev.created_at, qty: ev.qty,
                    before_stock: before, after_stock: after,
                    staff_name: ev.staff_name, address_id: ev.address_id,
                })
            }
        }
        return out.reverse()
    }

    if (localRepo.isGuest()) {
        const addressId = ids[0] // guest không hỗ trợ nhóm kho tổng
        return replay(
            localRepo.fetchAllLocalExpenses(addressId).filter((e: Row) => e.is_refill),
            localRepo.fetchAllLocalShiftClosings(addressId),
        )
    }
    if (!ids.length) return []
    const sb = supabase
    const closingsQuery = async (sel: string) => await sb
        .from('shift_closings')
        .select<string, Row>(sel)
        .in('address_id', ids)
    const [refillsRes, closingsRes] = await Promise.all([
        sb
            .from('expenses')
            .select('created_at, metadata')
            .in('address_id', ids)
            .eq('is_refill', true),
        closingsQuery('id, address_id, created_at, inventory_report, closer:users!closed_by(name)'),
    ])
    if (refillsRes.error) {
        console.error('fetchIngredientWithdrawals refills error:', refillsRes.error)
        return []
    }
    let closings = closingsRes.data
    if (closingsRes.error) {
        // Join users thất bại (RLS/FK đổi tên) → fallback không có tên người chốt.
        const retry = await closingsQuery('id, address_id, created_at, inventory_report')
        if (retry.error) {
            console.error('fetchIngredientWithdrawals closings error:', retry.error)
            return []
        }
        closings = retry.data
    }
    return replay((refillsRes.data || []) as Row[], closings || [])
}

// Compute raw warehouse balance per ingredient (Σ refill_qty − Σ restock_post_first_refill).
// Without the `max(0, ...)` clamp that fetchIngredientStocks applies. Negative values mean
// staff over-reported restock OR bought outside the system — `/ingredients` surfaces these
// as a "kho lệch sổ sách" banner so manager can reconcile via the Kiểm kê & reset flow.
export async function fetchIngredientDeficits(addressIds: (UUID | null)[] | UUID | null) {
    const ids = Array.isArray(addressIds) ? addressIds : [addressIds]
    if (localRepo.isGuest()) {
        const addressId = ids[0] // guest không hỗ trợ nhóm kho tổng
        const expenses = localRepo.fetchAllLocalExpenses(addressId).filter((e: Row) => e.is_refill && e.metadata?.ingredient)
        const closings = localRepo.fetchAllLocalShiftClosings(addressId)
        return computeDeficits(expenses, closings)
    }
    const isDefault = ids.length === 1 && !ids[0]
    const applyAddrFilter = (q: any) => isDefault ? q.is('address_id', null) : q.in('address_id', ids)
    const [refillsRes, closingsRes] = await Promise.all([
        applyAddrFilter(supabase.from('expenses').select('created_at, metadata')).eq('is_refill', true),
        applyAddrFilter(supabase.from('shift_closings').select('created_at, inventory_report'))
    ])
    return computeDeficits(refillsRes.data || [], closingsRes.data || [])
}

function computeDeficits(refills: Row[], closings: Row[]) {
    // Group refills: Σ qty + earliest created_at per ingredient
    const totalRefill: Record<string, number> = {}
    const firstRefillAt: Record<string, number> = {}
    for (const e of refills) {
        const ing = e.metadata?.ingredient
        if (!ing) continue
        totalRefill[ing] = (totalRefill[ing] || 0) + (Number(e.metadata?.qty) || 0)
        const t = new Date(e.created_at).getTime()
        if (firstRefillAt[ing] === undefined || t < firstRefillAt[ing]) firstRefillAt[ing] = t
    }
    // Σ restock per ingredient, only counting closings on/after that ingredient's first refill
    const totalRestock: Record<string, number> = {}
    for (const sc of closings) {
        const report = Array.isArray(sc.inventory_report) ? sc.inventory_report : []
        const t = new Date(sc.created_at).getTime()
        for (const item of report) {
            const ing = item.ingredient
            if (!ing) continue
            const start = firstRefillAt[ing]
            if (start === undefined || t < start) continue
            totalRestock[ing] = (totalRestock[ing] || 0) + (Number(item.restock) || 0)
        }
    }
    const deficits: Row[] = []
    for (const ing of Object.keys(totalRefill)) {
        const raw = totalRefill[ing] - (totalRestock[ing] || 0)
        if (raw < 0) deficits.push({ ingredient: ing, refill: totalRefill[ing], restock: totalRestock[ing] || 0, deficit: raw })
    }
    return deficits
}
