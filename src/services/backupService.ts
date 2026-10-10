import { supabase } from '../lib/supabaseClient'
import { cacheKey as buildCacheKey } from '../constants/storageKeys'
import type { UUID, Row } from '../types/domain'

// Hình dạng JSON của address_config_snapshot — các mảng row giữ id nguồn.
interface Snapshot {
    products?: Row[]; recipes?: Row[]; extras?: Row[]; extra_ingredients?: Row[]
    ingredient_groups?: Row[]; ingredient_sort_order?: string[]; costs?: Row[]
    toppings?: Row[]; topping_ingredients?: Row[]; product_toppings?: Row[]
    discount_programs?: Row[]; discount_program_products?: Row[]; expense_categories?: Row[]
    source_address_id?: UUID | null
}
interface CloneOptions {
    menu?: boolean; recipes?: boolean; extras?: boolean; ingredients?: boolean
    toppings?: boolean; discounts?: boolean; expenseCategories?: boolean
}
type CloneProgress = (p: { phase: string; count: number }) => void

/**
 * Clone full address setup from source → target (NEW address only).
 *
 * Data model (per commit 43af730 "new design of database product on address"):
 *   - products.owner_address_id is the per-address identity (each address has its own clone of every product)
 *   - product_prices and address_products tables are no longer used
 *   - recipes / product_extras / toppings / discount_programs link to products by id, so cloning requires an old→new product id map
 *
 * Strategy: client-generate UUIDs so the id map is known *before* the INSERT, then batch-insert
 * everything in one round-trip per table. Avoids the per-row INSERT...RETURNING dance and the fact
 * that PostgreSQL doesn't guarantee RETURNING preserves input order.
 *
 * Two entry points share the same READ (address_config_snapshot, SQL) and WRITE (`applySnapshot`) path:
 *   - cloneAddressConfig — same-account: get_address_config RPC (ownership guard).
 *   - cloneFromShareCode — cross-account: get_shared_config RPC (authorized by share code).
 *
 * options = { menu, recipes, extras, ingredients, toppings, discounts, expenseCategories }   (all default true)
 * onProgress = ({ phase, count }) => void   (phase: tên option ở trên)
 */

// Snapshot = JSON của address_config_snapshot (supabase/migrations/20261010_clone_full_config.sql),
// source ids preserved so id-map logic works on write:
//   products, recipes, extras, extra_ingredients, ingredient_groups, ingredient_sort_order,
//   costs (MỌI cột ingredient_costs trừ id/address_id — cột thêm sau này tự được chép),
//   toppings, topping_ingredients, product_toppings, discount_programs, discount_program_products,
//   expense_categories (nhãn đang dùng)

// Gán id mới cho từng row nguồn (giữ map cũ→mới để row con trỏ về) rồi gắn address đích.
function remapRows(list: Row[] | undefined, idMap: Map<string, string>, targetAddressId: UUID) {
    return (list || []).map(r => {
        const id = crypto.randomUUID()
        idMap.set(r.id, id)
        return { ...r, id, address_id: targetAddressId }
    })
}

async function insertAll(table: string, rows: Row[], errMsg: string) {
    if (!rows.length) return
    const { error } = await supabase.from(table).insert(rows)
    if (error) throw new Error(errMsg + error.message)
}

// Write a snapshot into a freshly-created target address.
async function applySnapshot(targetAddressId: UUID, snapshot: Snapshot, options?: CloneOptions, onProgress?: CloneProgress) {
    const opts = { menu: true, recipes: true, extras: true, ingredients: true, toppings: true, discounts: true, expenseCategories: true, ...options }
    const emit = (phase: string, count: number) => { try { onProgress?.({ phase, count }) } catch { /* never let UI bug break clone */ } }

    const productIdMap = new Map<string, string>() // source product id → target product id

    // ── 0. Wipe any pre-existing data at target ───────────────────────────────────
    // Why: a Postgres trigger seeds every new address with a default menu (products +
    // recipes). If we just append clone results, the new address ends up with
    // defaults + clone instead of clone only. Safe to hard-delete here because the
    // target address was created seconds ago and has no order_items yet.
    //
    // Delete order matters: extra_ingredients ← product_extras (CASCADE) and
    // recipes ← products (CASCADE), so deleting products + product_extras handles
    // their children. ingredient_costs is independent.
    {
        const { error: e1 } = await supabase.from('product_extras').delete().eq('address_id', targetAddressId)
        if (e1) throw new Error('Lỗi khi dọn tùy chọn cũ ở địa chỉ mới: ' + e1.message)

        const { error: e2 } = await supabase.from('products').delete().eq('owner_address_id', targetAddressId)
        if (e2) throw new Error('Lỗi khi dọn menu cũ ở địa chỉ mới: ' + e2.message)

        // recipes cascades from products, but the trigger may also seed address-scoped
        // recipes that reference shared/global products; clean those up too.
        const { error: e3 } = await supabase.from('recipes').delete().eq('address_id', targetAddressId)
        if (e3) throw new Error('Lỗi khi dọn công thức cũ ở địa chỉ mới: ' + e3.message)

        const { error: e4 } = await supabase.from('ingredient_costs').delete().eq('address_id', targetAddressId)
        if (e4) throw new Error('Lỗi khi dọn nguyên liệu cũ ở địa chỉ mới: ' + e4.message)
    }

    // ── 1. Menu = products (price + sort_order + count_as_cup live on this row) ─────
    if (opts.menu) {
        const list = snapshot.products || []
        emit('menu', list.length)

        if (list.length) {
            // Cột is_divider phải nhất quán trên MỌI row: PostgREST dựng câu INSERT theo
            // union các key trong mảng, row nào thiếu key sẽ nhận NULL (không fallback
            // default false) → vi phạm NOT NULL nếu chỉ vài row có divider (xem lỗi
            // "null value in column is_divider"). Nên luôn gửi cho tất cả.
            const rows = list.map(p => {
                const newId = crypto.randomUUID()
                productIdMap.set(p.id, newId)
                return {
                    id: newId,
                    name: p.name,
                    price: p.price,
                    sort_order: p.sort_order,
                    count_as_cup: p.count_as_cup ?? true,
                    is_active: true,
                    owner_address_id: targetAddressId,
                    is_divider: p.is_divider ?? false,
                }
            })
            await insertAll('products', rows, 'Lỗi khi sao lưu menu: ')
        }
    }

    // ── 2. Recipes (per-address overrides; globals are shared and inherited automatically) ──
    if (opts.recipes && productIdMap.size > 0) {
        const rows = (snapshot.recipes || [])
            .map(r => {
                const newPid = productIdMap.get(r.product_id)
                if (!newPid) return null
                return {
                    product_id: newPid,
                    ingredient: r.ingredient,
                    amount: r.amount,
                    unit: r.unit,
                    address_id: targetAddressId,
                }
            })
            .filter((r): r is NonNullable<typeof r> => !!r)

        emit('recipes', rows.length)
        await insertAll('recipes', rows, 'Lỗi khi sao lưu công thức: ')
    }

    // ── 3. Extras = product_extras + extra_ingredients (need product idMap and extra idMap) ──
    if (opts.extras && productIdMap.size > 0) {
        const extraIdMap = new Map<string, string>()
        const extraRows: Row[] = []
        for (const e of snapshot.extras || []) {
            const newPid = productIdMap.get(e.product_id)
            if (!newPid) continue
            const newId = crypto.randomUUID()
            extraIdMap.set(e.id, newId)
            extraRows.push({
                id: newId,
                product_id: newPid,
                name: e.name,
                price: e.price,
                sort_order: e.sort_order,
                is_sticky: e.is_sticky ?? false,
                address_id: targetAddressId,
            })
        }

        emit('extras', extraRows.length)
        await insertAll('product_extras', extraRows, 'Lỗi khi sao lưu tùy chọn: ')

        const ingRows = (snapshot.extra_ingredients || [])
            .map(i => ({
                extra_id: extraIdMap.get(i.extra_id),
                ingredient: i.ingredient,
                amount: i.amount,
                unit: i.unit,
            }))
            .filter(r => r.extra_id)
        await insertAll('extra_ingredients', ingRows, 'Lỗi khi sao lưu định lượng tùy chọn: ')
    }

    // ── 4. Ingredients = nhóm + ingredient_costs (đủ cột) + ingredient_sort_order ───
    if (opts.ingredients) {
        const costs = snapshot.costs || []
        emit('ingredients', costs.length)

        // Nhóm trước: costs.group_id trỏ về id nhóm MỚI. Trigger sync_ingredient_group_category
        // chỉ ép category theo section của nhóm — nguồn đã khớp sẵn nên giữ nguyên.
        const groupIdMap = new Map<string, string>()
        const groupRows = remapRows(snapshot.ingredient_groups, groupIdMap, targetAddressId)
        await insertAll('ingredient_groups', groupRows, 'Lỗi khi sao lưu nhóm nguyên liệu: ')

        // Chép nguyên row (mọi cột) — chỉ dịch group_id sang id mới.
        const rows = costs.map(c => ({
            ...c,
            address_id: targetAddressId,
            group_id: c.group_id ? groupIdMap.get(c.group_id) ?? null : null,
        }))
        await insertAll('ingredient_costs', rows, 'Lỗi khi sao lưu nguyên liệu: ')

        const sortOrder = snapshot.ingredient_sort_order
        if (Array.isArray(sortOrder) && sortOrder.length > 0) {
            const { error: updErr } = await supabase
                .from('addresses')
                .update({ ingredient_sort_order: sortOrder })
                .eq('id', targetAddressId)
            if (updErr) throw new Error('Lỗi khi sao lưu thứ tự nguyên liệu: ' + updErr.message)
        }
    }

    // ── 5. Toppings = toppings + công thức (topping_ingredients) + món áp dụng (product_toppings) ──
    if (opts.toppings) {
        const toppingIdMap = new Map<string, string>()
        const toppingRows = remapRows(snapshot.toppings, toppingIdMap, targetAddressId)
        emit('toppings', toppingRows.length)
        await insertAll('toppings', toppingRows, 'Lỗi khi sao lưu topping: ')

        const ingRows = (snapshot.topping_ingredients || [])
            .map(i => ({ topping_id: toppingIdMap.get(i.topping_id), ingredient: i.ingredient, amount: i.amount, unit: i.unit }))
            .filter(r => r.topping_id)
        await insertAll('topping_ingredients', ingRows, 'Lỗi khi sao lưu công thức topping: ')

        const linkRows = (snapshot.product_toppings || [])
            .map(l => ({ product_id: productIdMap.get(l.product_id), topping_id: toppingIdMap.get(l.topping_id) }))
            .filter(r => r.product_id && r.topping_id)
        await insertAll('product_toppings', linkRows, 'Lỗi khi sao lưu topping áp dụng món: ')
    }

    // ── 6. Chương trình giảm giá = discount_programs (đủ cột, giữ nguyên bật/tắt) + món áp dụng ──
    if (opts.discounts) {
        const programIdMap = new Map<string, string>()
        const programRows = remapRows(snapshot.discount_programs, programIdMap, targetAddressId)
        emit('discounts', programRows.length)
        await insertAll('discount_programs', programRows, 'Lỗi khi sao lưu chương trình giảm giá: ')

        const linkRows = (snapshot.discount_program_products || [])
            .map(l => ({ discount_program_id: programIdMap.get(l.discount_program_id), product_id: productIdMap.get(l.product_id) }))
            .filter(r => r.discount_program_id && r.product_id)
        await insertAll('discount_program_products', linkRows, 'Lỗi khi sao lưu món áp dụng giảm giá: ')
    }

    // ── 7. Danh mục chi phí: thay bộ nhãn mặc định do trigger seed bằng bộ của nguồn ──────────
    // Địa chỉ mới chưa có khoản chi nào trỏ vào nhãn nên xoá được; nguồn rỗng thì giữ mặc định.
    if (opts.expenseCategories && snapshot.expense_categories?.length) {
        emit('expenseCategories', snapshot.expense_categories.length)
        const { error: delErr } = await supabase.from('expense_categories').delete().eq('address_id', targetAddressId)
        if (delErr) throw new Error('Lỗi khi dọn danh mục chi phí mặc định: ' + delErr.message)
        const rows = snapshot.expense_categories.map(c => ({ ...c, address_id: targetAddressId }))
        await insertAll('expense_categories', rows, 'Lỗi khi sao lưu danh mục chi phí: ')
    }

    // Invalidate any stale prefetch cache for the target address. AddressSelectPage's prefetch
    // effect fires the moment the new address row appears, which races against this clone — if
    // prefetch wins, it stores empty arrays under cache_*_${targetId}. Clearing here forces
    // ProductContext to network-fetch on next /pos mount, which gets the correct data.
    for (const name of ['products', 'recipes', 'costs', 'units', 'extras', 'extra_ingredients', 'configs', 'ingredient_groups', 'toppings', 'product_toppings', 'discount_programs', 'product_discounts']) {
        try { localStorage.removeItem(buildCacheKey(targetAddressId, name)) } catch { /* ignore */ }
    }

    return { productCount: productIdMap.size }
}

export async function cloneAddressConfig(sourceAddressId: UUID, targetAddressId: UUID, options: CloneOptions = {}, onProgress?: CloneProgress) {
    const { data, error } = await supabase.rpc('get_address_config', { p_address_id: sourceAddressId })
    if (error || !data) throw new Error('Lỗi khi đọc cấu hình nguồn: ' + (error?.message || 'không có dữ liệu'))
    return applySnapshot(targetAddressId, data, options, onProgress)
}

/**
 * Cross-account clone: read source config via share code (RPC bypasses RLS),
 * write into target (owned by caller), then record referral attribution.
 */
export async function cloneFromShareCode(code: string, targetAddressId: UUID, onProgress?: CloneProgress) {

    const { data, error } = await supabase.rpc('get_shared_config', { p_code: code })
    if (error) throw new Error(error.message || 'Mã không hợp lệ')
    if (!data) throw new Error('Mã không hợp lệ hoặc đã hết hạn')

    const result = await applySnapshot(targetAddressId, data, {}, onProgress)

    // Referral attribution (best-effort — clone already succeeded, don't fail on this).
    if (data.source_address_id) {
        try {
            await supabase
                .from('addresses')
                .update({ referred_from_address_id: data.source_address_id })
                .eq('id', targetAddressId)
        } catch { /* attribution is non-critical */ }
    }

    return result
}

/**
 * Read-only peek at a share code's config — for the "what will I copy" preview.
 * Returns the snapshot data, or null if the code is invalid/expired.
 */
export async function getSharedConfig(code?: string | null) {
    if (!code) return null
    const { data, error } = await supabase.rpc('get_shared_config', { p_code: code })
    if (error || !data) return null
    return data
}

/** Generate (or reuse) a share code for an address the caller owns. */
export async function createAddressShareCode(addressId: UUID) {
    const { data, error } = await supabase.rpc('create_address_share_code', { p_address_id: addressId })
    if (error) throw new Error(error.message || 'Không thể tạo mã')
    return data
}
