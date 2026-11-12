import { ingredientLabel, lookupByLabel } from './ingredients'
import { dateStringVN, nextDayStr } from './dateVN'
import type { CartExtra, Row } from '../types/domain'

/** Dòng bảng recipes. unit/address_id có khi đọc từ DB, không cần khi chỉ tính tiêu hao. */
export interface RecipeRow { product_id: string; ingredient: string; amount: number; unit?: string | null; address_id?: string | null }
export interface ExtraIngRow { ingredient: string; amount: number; extra_id?: string; unit?: string | null }
export type ExtraIngredients = Record<string, ExtraIngRow[]>
/** ingredient → lượng tiêu hao */
export type UsageMap = Record<string, number>
/** Order item đã chuẩn hoá (orderItemsOf) hoặc đang ở shape thô (server/offline) */
interface OrderItem { productId?: string; product_id?: string; quantity?: number; qty?: number; extras?: { id: string }[] }
export interface Pack2 { size: number; unit: string }

// Làm tròn 1 chữ số thập phân — dùng chung cho mọi phép tồn/hao hụt để tránh 3 nơi
// tự định nghĩa lại rồi lệch epsilon nhau.
export const r1 = (n: unknown) => Math.round((Number(n) || 0) * 10) / 10

const idObjs = (ids?: string[]) => (ids || []).map(id => ({ id }))

/** Món nghi "pha bán nhưng không bấm bill" (findMissingCupCandidates). */
export interface MissingCupCandidate {
    productId: string; productName: string; estimatedCups: number; confidence: number
    estimatedRevenue: number; ingredientValue: number
    cashMatch: boolean // két dư (Thực thu − Doanh thu) ≈ estimatedRevenue
    similar: string[] // món khác khớp gần bằng (±3%) cùng số ly — không phân biệt nổi bằng hao hụt
    matches: { ingredient: string; haoHut: number; amount: number; ratio: number }[]
    // Phân rã theo ngân sách hao hụt (xem decompose): cups = ly gán được món (mỗi phần tử = 1 ly), rest = hao hụt còn lại chưa gán được.
    cups: { name: string; price: number; rows: { ingredient: string; amount: number }[] }[]
    rest: { ingredient: string; amount: number }[]
}

/** Ứng viên kèm thống kê lặp lại do findMissingCupCandidates thêm vào. */
export type RepeatedMissingCupCandidate = MissingCupCandidate & { repeatDays: number; repeatWindowDays: number }

/**
 * Tính toán giá vốn của một sản phẩm, bao gồm cả tuỳ chọn thêm (extras).
 * 
 * @param {string} productId - ID của món chính
 * @param {Array} extras - Danh sách các tuỳ chọn đi kèm (ví dụ: [{id: 'size_L', name: 'Size L', price: 5000}])
 * @param {Array} recipes - Toàn bộ recipes để tìm công thức của món chính
 * @param {Object} extraIngredients - Map extra_id -> mảng ingredients. VD: { 'size_L': [{ingredient: 'Ca_phe', amount: 7}, {ingredient: 'Ly_S', amount: -1}, {ingredient: 'Ly_L', amount: 1}] }
 * @param {Object} ingredientCosts - Map ingredient_id -> cost (giá vốn 1 đơn vị)
 * @returns {number} Tổng giá vốn
 */
export function calculateItemCost(productId: string, extras: { id: string }[] = [], recipes: RecipeRow[] = [], extraIngredients: ExtraIngredients = {}, ingredientCosts: Record<string, number> = {}) {
    let totalCost = 0;

    // 1. Tính giá vốn món chính
    const productRecipe = recipes.filter(r => r.product_id === productId);
    productRecipe.forEach(item => {
        const unitCost = ingredientCosts[item.ingredient] || 0;
        totalCost += (item.amount * unitCost);
    });

    // 2. Tính giá vốn của extras
    extras.forEach(extra => {
        const extraIngs = extraIngredients[extra.id] || [];
        extraIngs.forEach(ei => {
            const unitCost = ingredientCosts[ei.ingredient] || 0;
            totalCost += (ei.amount * unitCost);
        });
    });

    return totalCost;
}

// recipes gom sẵn theo product_id. Không có nó thì mỗi order item quét lại toàn bộ bảng
// recipes → cuối ca vài trăm đơn × vài trăm dòng công thức = quadratic ngay trên máy nhân viên.
export function groupRecipesByProduct(recipes?: RecipeRow[] | null) {
    const byProduct = new Map<string, RecipeRow[]>();
    (recipes || []).forEach(r => {
        const list = byProduct.get(r.product_id);
        if (list) list.push(r);
        else byProduct.set(r.product_id, [r]);
    });
    return byProduct;
}

// Chuẩn hoá item của MỘT đơn về { productId, qty, extras } — nguồn duy nhất cho mọi
// chỗ nạp đơn vào calculateEstimatedConsumption/buildIngredientToProduct. Nhận cả 3
// shape đang tồn tại: order_items (server), orderItems / cart (đơn offline chờ sync).
export function orderItemsOf(order: Row) {
    return (order.order_items || order.orderItems || order.cart || []).map((i: Row) => ({
        productId: i.product_id || i.productId,
        qty: i.quantity || i.qty || 1,
        extras: [
            ...(i.extra_ids ? idObjs(i.extra_ids) : (i.extras || [])),
            // Topping tính như extra: tiêu hao lấy từ nguồn của nó (fetchToppingSources); topping chưa có nguồn → map không có key → 0.
            ...(i.topping_ids ? idObjs(i.topping_ids) : (i.toppings || [])),
        ],
    }))
}

// Đơn còn sống (chưa xoá) — server dùng deleted_at, đơn offline dùng deletedAt.
export const isLiveOrder = (o: Row) => !o.deleted_at && !o.deletedAt

/** Tổng doanh thu các đơn còn sống; nhận nhiều danh sách (đơn server + đơn offline chờ đồng bộ). */
export const sumLiveRevenue = (...lists: Row[][]) =>
    lists.flat().reduce((sum, o) => (isLiveOrder(o) ? sum + (o.total || 0) : sum), 0)

/**
 * Tính tổng lượng nguyên liệu tiêu hao dự kiến dựa trên danh sách món đã bán.
 *
 * @param {Array} orderItems - Mảng các order item (có thể lấy từ todayOrders + offlineToday)
 *                             Cấu trúc yêu cầu: { product_id hoặc productId, quantity hoặc qty, extras: [] }
 * @param {Array} recipes - Toàn bộ bản ghi recipes
 * @param {Object} extraIngredients - Map extra_id -> array of {ingredient, amount}
 * @returns {Object} object mapping ingredient -> tổng số lượng tiêu hao
 */
export function calculateEstimatedConsumption(orderItems: OrderItem[], recipes: RecipeRow[], extraIngredients: ExtraIngredients) {
    const estimated: UsageMap = {};
    const recipesByProduct = groupRecipesByProduct(recipes);

    orderItems.forEach(item => {
        // Hỗ trợ cả 2 naming convention (productId vs product_id)
        const id = item.productId || item.product_id;
        const qty = item.quantity || item.qty || 1;
        const extras = item.extras || [];

        // 1. Tiêu hao của món chính
        const productRecipes = recipesByProduct.get(id!) || [];
        productRecipes.forEach(r => {
            if (!estimated[r.ingredient]) estimated[r.ingredient] = 0;
            estimated[r.ingredient] += r.amount * qty;
        });

        // 2. Tiêu hao của extras
        extras.forEach(extra => {
            const extraIngs = extraIngredients[extra.id] || [];
            extraIngs.forEach(ei => {
                if (!estimated[ei.ingredient]) estimated[ei.ingredient] = 0;
                estimated[ei.ingredient] += ei.amount * qty;
            });
        });
    });

    // Xóa những nguyên liệu có lượng tiêu hao = 0 (tránh bị hiển thị trống hoặc âm do bù trừ do thiết lập sai sót nhẹ nếu có)
    Object.keys(estimated).forEach(key => {
        // Làm tròn lấy 1 chữ số thập phân để tránh lỗi epsilon Math floating point của JS (ví dụ 0.1 + 0.2 = 0.30000000004)
        estimated[key] = Math.round(estimated[key] * 10) / 10;
        if (estimated[key] === 0) {
            delete estimated[key];
        }
    });

    return estimated;
}

/**
 * Trung bình nhiều bản đồ tiêu hao (mỗi bản = 1 tuần lịch sử cùng thứ) thành 1 dự báo mượt
 * hơn — dùng để tránh forecast "Soạn"/"Chuẩn bị" nhạy cảm với 1 ngày bất thường (nghỉ lễ,
 * vắng khách đột xuất) của đúng 1 tuần trước. Tuần không bán gì cho 1 nguyên liệu vẫn tính
 * là 0 trong trung bình (không loại trừ khỏi mẫu số) vì đó là tín hiệu thật (ế ngày đó).
 *
 * @param {Array<Object>} maps - mảng usedMap (ingredient -> lượng tiêu hao), 1 map/tuần
 * @returns {Object} ingredient -> trung bình, làm tròn 1 chữ số thập phân, bỏ nếu = 0
 */
export function averageIngredientMaps(maps?: (UsageMap | null | undefined)[] | null) {
    const weeks = (maps || []).filter((m): m is UsageMap => !!m);
    if (weeks.length === 0) return {};

    const sums: UsageMap = {};
    weeks.forEach(map => {
        Object.entries(map).forEach(([ingredient, amount]) => {
            sums[ingredient] = (sums[ingredient] || 0) + (Number(amount) || 0);
        });
    });

    const averaged: UsageMap = {};
    Object.entries(sums).forEach(([ingredient, sum]) => {
        const avg = r1(sum / weeks.length);
        if (avg !== 0) averaged[ingredient] = avg;
    });
    return averaged;
}

// Dự báo tiêu hao: trung bình các tuần mẫu. weeks = mỗi phần tử là order_items của 1 ngày mẫu
// [{ product_id, quantity, extra_ids }] (fetchLastWeekSameDayOrderItems).
export function forecastFromWeeks(weeks: Row[][], recipes: RecipeRow[], extraIngredients: ExtraIngredients) {
    return averageIngredientMaps(weeks.map(items => calculateEstimatedConsumption(
        items.map(i => ({ productId: i.product_id, qty: i.quantity, extras: [...idObjs(i.extra_ids), ...idObjs(i.topping_ids)] })),
        recipes, extraIngredients)));
}

/**
 * Tính breakdown tiêu hao theo từng biến thể (sản phẩm + tổ hợp extras) cho mỗi nguyên liệu.
 * Dùng để drill-down "Tiêu CT" trong inventory audit.
 *
 * Variant key: `productId` nếu không có extras, hoặc `productId|<sorted extra ids>`.
 *
 * @returns {Object} breakdown[ingredient][variantKey] = { name, qty, totalAmount }
 */
export function calculateConsumptionBreakdown(orderItems: OrderItem[], recipes: RecipeRow[], extraIngredients: ExtraIngredients, products: Row[] = [], productExtras: Record<string, Row[]> = {}) {
    const breakdown: Record<string, Record<string, { name: string; qty: number; totalAmount: number }>> = {};
    const recipesByProduct = groupRecipesByProduct(recipes);
    const productNames = new Map((products || []).map(p => [p.id, p.name]));

    // Build extra-id → extra-name lookup từ productExtras { productId: [{ id, name, ... }] }
    const extraNames: Record<string, string> = {};
    Object.values(productExtras || {}).forEach(list => {
        (list || []).forEach(ex => {
            if (ex && ex.id) extraNames[ex.id] = ex.name || ex.id;
        });
    });

    const ensure = (ingredient: string, variantKey: string, displayName: string) => {
        if (!breakdown[ingredient]) breakdown[ingredient] = {};
        if (!breakdown[ingredient][variantKey]) {
            breakdown[ingredient][variantKey] = { name: displayName, qty: 0, totalAmount: 0 };
        }
    };

    orderItems.forEach(item => {
        const id = item.productId || item.product_id;
        const qty = item.quantity || item.qty || 1;
        const extras = item.extras || [];
        const productName: string = productNames.get(id) || String(id);

        const extraIds = extras.map(e => e?.id).filter((id): id is string => !!id).slice().sort();
        const variantKey = extraIds.length ? `${id}|${extraIds.join(',')}` : String(id);
        const extraLabels = extraIds.map(eid => extraNames[eid] || eid);
        const displayName = extraLabels.length
            ? `${productName} (${extraLabels.join(', ')})`
            : productName;

        // Track which ingredients this order item touches, so qty is counted only once
        // even if both base recipe and an extra affect the same ingredient.
        const counted = new Set<string>();

        const touch = (ingredient: string, amount: number) => {
            ensure(ingredient, variantKey, displayName);
            if (!counted.has(ingredient)) {
                breakdown[ingredient][variantKey].qty += qty;
                counted.add(ingredient);
            }
            breakdown[ingredient][variantKey].totalAmount =
                Math.round((breakdown[ingredient][variantKey].totalAmount + amount * qty) * 10) / 10;
        };

        (recipesByProduct.get(id!) || []).forEach(r => touch(r.ingredient, r.amount));
        extras.forEach(extra => {
            (extraIngredients[extra.id] || []).forEach(ei => touch(ei.ingredient, ei.amount));
        });
    });

    return breakdown;
}

/**
 * Bucket ingredient COGS across all orders into {main, packaging, tools}
 * using CURRENT recipes + ingredient category map.
 *
 * Returns absolute VND amounts per bucket — caller can rescale against a
 * historical totalCOGS to absorb recipe-drift when needed (Range mode uses
 * order.total_cost snapshots which can diverge from current-recipe cost).
 *
 * Ingredients with no category (null) are treated as 'main' to match the
 * UX rule: legacy NVL fall under "Nguyên liệu chính" until reclassified.
 */
export function splitCogsByCategory(orders: Row[] | null | undefined, recipes: RecipeRow[], extraIngredients: ExtraIngredients, ingredientCosts: Record<string, number>, categoryByIngredient?: Map<string, string | null> | Record<string, string | null> | null) {
    const bucket = { main: 0, packaging: 0, tools: 0 }
    const bucketFor = (key: string): keyof typeof bucket => {
        const cat = (categoryByIngredient instanceof Map ? categoryByIngredient.get(key) : categoryByIngredient?.[key]) ?? null
        return cat === 'packaging' || cat === 'tools' ? cat : 'main'
    }
    const recipesByProduct = groupRecipesByProduct(recipes)
    for (const o of orders || []) {
        if (!isLiveOrder(o)) continue
        const items = o.order_items || o.cart || o.orderItems || []
        for (const item of items) {
            const qty = item.quantity || item.qty || 1
            const productId = item.product_id || item.productId
            for (const r of recipesByProduct.get(productId) || []) {
                bucket[bucketFor(r.ingredient)] += (ingredientCosts[r.ingredient] || 0) * (r.amount || 0) * qty
            }
            const extras = item.extras || (item.extra_ids ? idObjs(item.extra_ids) : [])
            for (const e of extras) {
                const eid = e?.id
                if (!eid) continue
                for (const ei of extraIngredients[eid] || []) {
                    bucket[bucketFor(ei.ingredient)] += (ingredientCosts[ei.ingredient] || 0) * (ei.amount || 0) * qty
                }
            }
        }
    }
    return bucket
}

// Nguyên liệu nằm trong công thức hoặc extra nào đó.
export function buildRecipeIngredientSet(recipes: RecipeRow[] = [], extraIngredients: ExtraIngredients = {}) {
    const set = new Set<string>()
    for (const r of recipes) if (r?.ingredient) set.add(r.ingredient)
    for (const list of Object.values(extraIngredients || {}))
        for (const ei of (list || [])) if (ei?.ingredient) set.add(ei.ingredient)
    return set
}

// Như lookupByLabel nhưng dựng chỉ mục nhãn MỘT lần cho mỗi map (cache theo identity — map tiêu hao không bị sửa
// sau khi tạo): lookupByLabel quét cả map mỗi lần trượt khoá, nhân (ngày × nguyên liệu) là hàng trăm nghìn lần.
const labelIndexOf = new WeakMap<UsageMap, Map<string, number>>()
export function usedOf(map: UsageMap, ingredient: string): number {
    if (map[ingredient] != null) return map[ingredient]
    let index = labelIndexOf.get(map)
    if (!index) {
        index = new Map<string, number>()
        for (const [k, v] of Object.entries(map)) {
            const label = ingredientLabel(k).toLowerCase()
            if (!index.has(label)) index.set(label, v)
        }
        labelIndexOf.set(map, index)
    }
    return index.get(ingredientLabel(ingredient).toLowerCase()) ?? 0
}

/**
 * Đi TỪNG NGÀY LỊCH (kể cả ngày không có phiếu chốt) và nối tồn quầy qua các ngày không đếm:
 *   Đầu kỳ  = item.opening đã lưu (đóng băng) ?? tồn cuối ngày trước
 *   Lý thuyết = Đầu kỳ + Nhập thêm − Sử dụng
 *   Cuối ngày = Cuối kỳ đã đếm ?? max(0, Lý thuyết)   ← không đếm thì tồn quầy THEO lý thuyết
 * Đếm lại (remaining) đặt lại mốc; không có tồn vật lý âm nên số mang sang ngày sau kẹp ≥ 0
 * (Lý thuyết trong row vẫn giữ nguyên số âm để tính hao hụt).
 *
 * Nguyên liệu "có trạng thái" từ ngày đầu tiên nó xuất hiện (item trong phiếu hoặc `seed`);
 * trước đó không sinh row. Ngày không có phiếu → không có item → opening = tồn cuối ngày trước.
 * `seed`: ingredient → tồn cuối ngày NGAY TRƯỚC ngày phiếu đầu tiên (không biết tiêu hao của các
 * ngày trước đó, nên không nối ngược).
 * Mỗi ngày tối đa 1 phiếu (uniq_shift_closings_address_vn_day); trùng thì lấy cái chốt muộn nhất.
 * throughDay: ngày cuối (gồm) cần nối; bỏ trống = ngày của phiếu cuối cùng.
 *
 * @returns {Array<{dayStr, ingredient, opening, restock, used, theoretical, remaining, end, closingIdx}>}
 *   remaining = null nếu hôm đó không đếm; closingIdx = vị trí phiếu trong danh sách đã sort
 *   theo closed_at (-1 nếu ngày đó không có phiếu).
 */
export function rollIngredientDays({ shiftClosings = [], dailyConsumption = {}, throughDay, seed = {} }: { shiftClosings?: Row[]; dailyConsumption?: Record<string, UsageMap>; throughDay?: string; seed?: UsageMap }) {
    const sorted = [...shiftClosings].sort((a, b) =>
        new Date(a.closed_at || a.created_at).getTime() - new Date(b.closed_at || b.created_at).getTime()
    )
    const closingOfDay = new Map<string, { c: Row; idx: number }>()
    sorted.forEach((c, idx) => {
        if (!c.inventory_report) return
        const dayStr = dateStringVN(new Date(c.closed_at || c.created_at))
        closingOfDay.set(dayStr, { c, idx })   // sort tăng dần → cái sau ghi đè
    })
    if (!closingOfDay.size) return []

    const state: UsageMap = { ...seed }
    const out: { dayStr: string; ingredient: string; opening: number; restock: number; used: number; theoretical: number; remaining: number | null; end: number; closingIdx: number }[] = []
    const days = [...closingOfDay.keys()].sort()
    const lastDay = throughDay ?? days.at(-1)!
    for (let dayStr = days[0]; dayStr <= lastDay; dayStr = nextDayStr(dayStr)) {
        const entry = closingOfDay.get(dayStr)
        const items = new Map<string, Row>()
        for (const it of entry?.c.inventory_report || []) if (it?.ingredient) items.set(it.ingredient, it)
        const used = dailyConsumption[dayStr] || {}
        for (const ingredient of new Set([...Object.keys(state), ...items.keys()])) {
            const item = items.get(ingredient)
            const opening = item?.opening != null ? item.opening : (state[ingredient] ?? 0)
            const restock = item?.restock || 0
            const usedNum = r1(usedOf(used, ingredient))
            const theoretical = r1(opening + restock - usedNum)
            const remaining = item?.remaining ?? null
            const end = remaining ?? Math.max(0, theoretical)
            state[ingredient] = end
            out.push({ dayStr, ingredient, opening, restock, used: usedNum, theoretical, remaining, end, closingIdx: entry ? entry.idx : -1 })
        }
    }
    return out
}

/**
 * Tồn quầy ƯỚC TÍNH của 1 dòng get_ingredient_stocks_v2 (xem 20261005_ingredient_stocks_counted_on.sql):
 *   quầy = max(0, số đếm cuối + Σ nhập thêm sau ngày đếm − Σ tiêu hao từ sau ngày đếm tới nay)
 * Không nối khi: không có ngày đếm (chỉ từ Đầu kỳ/setup), đã đếm hôm nay mà entry chưa có giờ đếm, hoặc `usedByDay`
 * (từ `fromDay`) không phủ hết khoảng từ ngày đếm — thiếu tiêu hao thì tồn ra cao giả, thà giữ số thô.
 * Entry có `counter_counted_at`: tiêu hao của CHÍNH ngày đếm tính từ giờ đó (`afterCount[ingredient]`, đơn sau giờ đếm —
 * usageAfterCount), cộng các ngày sau. Đếm hôm nay thì chỉ còn phần này.
 * current_stock = kho + quầy ước tính (kho tổng giữ nguyên: nhập thêm đã trừ khỏi kho từ trước).
 * Kẹp ≥ 0 MỘT lần ở cuối (restock_since_count là tổng, không có theo ngày). rollIngredientDays kẹp từng ngày nên khác
 * nhau ở đúng một ca: tồn chạm 0 giữa chừng rồi sau đó mới có nhập thêm — roll thực tế hơn, estimate thấp hơn.
 * usedByDay: { 'YYYY-MM-DD': { ingredient: usedAmount } }
 */
// Tiêu hao của 1 NVL từ sau lần đếm của dòng: phần sau giờ đếm của ngày đếm (nếu có giờ) + các ngày sau đó.
export function usedSinceCount(row: Row, usedByDay: Record<string, UsageMap>, afterCount: UsageMap) {
    let used = row.counter_counted_at ? afterCount[row.ingredient] ?? 0 : 0
    for (const [day, map] of Object.entries(usedByDay)) {
        if (day > row.counter_counted_on) used += usedOf(map, row.ingredient)
    }
    return used
}

export function estimateCounterRow(row: Row, usedByDay: Record<string, UsageMap>, { today, fromDay, afterCount }: { today: string; fromDay: string; afterCount: UsageMap }) {
    const on = row.counter_counted_on
    const at = row.counter_counted_at
    if (!on || (on >= today && !at) || nextDayStr(on) < fromDay) return row
    const counter = Math.max(0, r1(row.counter_stock + row.restock_since_count - usedSinceCount(row, usedByDay, afterCount)))
    return { ...row, counter_stock: counter, current_stock: r1(row.warehouse_stock + counter), counter_estimated: true }
}

/**
 * Đầu kỳ của closing ĐẦU TIÊN trong window cho walkDailyIngredientDiff (làm `openingOverrideMap`): như mặc định của
 * walk — remaining của phiếu gần nhất trước đó, NVL không đếm = 0 — nhưng số ƯỚC TÍNH (estimateOpening) thắng
 * khi có: nó tính từ lần đếm thật cuối + nhập thêm − tiêu hao các ngày đã qua, nên đúng cả khi phiếu cách vài ngày.
 */
export function openingSeed(yesterdayClosing: Row | null | undefined, estimates: UsageMap = {}) {
    const items = (parseInventoryReport(yesterdayClosing?.inventory_report) || []).filter((it: Row) => it?.ingredient)
    return { ...Object.fromEntries(items.map((it: Row) => [it.ingredient, it.remaining ?? 0])), ...estimates }
}

/**
 * CORE — công thức audit DUY NHẤT cho "opening = tồn cuối phiên trước / restock =
 * item.restock / used = tiêu thụ ước tính / theoretical = opening+restock-used /
 * diff = actual-theoretical". Trước đây bị chép tay 3 lần (calculateLossValue,
 * RangeLossCard, buildDailyHaoHutMap) — sửa công thức mà quên sửa hết 1 chỗ thì 3 nơi
 * lệch nhau âm thầm, nguy hiểm vì đây là số tiền thật (feed FinanceCards "Hao hụt/hủy").
 *
 * @param {Array} shiftClosings - không cần sort/dedupe sẵn, hàm tự sort theo closed_at
 * @param {Object} dailyConsumption - { dayStr: {ingredient: usedAmount} }
 * @param {Array} [prevShiftClosings] - nguồn opening cho closing ĐẦU TIÊN trong window
 *   (không có openingOverrideMap thì dùng prevShiftClosings[0], mới nhất, DESC)
 * @param {Object} [openingOverrideMap] - ingredient→remaining, override opening của
 *   closing đầu tiên thay vì suy ra từ prevShiftClosings
 * @returns {Array<{dayStr, ingredient, diff, idx}>} — 1 dòng / (ngày, nguyên liệu đã
 *   nhập Cuối kỳ). idx=0 là closing đầu tiên trong window (opening có thể chỉ là suy
 *   đoán ?? 0 nếu caller không truyền prevShiftClosings/openingOverrideMap — caller tự
 *   quyết định có tin idx=0 hay lọc bỏ).
 */
export function walkDailyIngredientDiff({ shiftClosings = [], dailyConsumption = {}, prevShiftClosings = [], openingOverrideMap = null }: { shiftClosings?: Row[]; dailyConsumption?: Record<string, UsageMap>; prevShiftClosings?: Row[]; openingOverrideMap?: UsageMap | null }) {
    if (!shiftClosings.length) return []

    let firstOpeningMap = openingOverrideMap
    if (!firstOpeningMap) {
        firstOpeningMap = {} as UsageMap
        for (const it of prevShiftClosings?.[0]?.inventory_report || []) {
            firstOpeningMap[it.ingredient] = it.remaining ?? 0
        }
    }

    // Đi theo ngày lịch qua rollIngredientDays: ngày không đếm / không có phiếu vẫn nối lý thuyết
    // → khi đếm lại sau vài ngày, hao hụt là so với tồn ước tính CHỨ KHÔNG phải 0 hay số đếm cũ.
    return rollIngredientDays({ shiftClosings, dailyConsumption, seed: firstOpeningMap })
        .filter(r => r.remaining != null)
        .map(r => ({ dayStr: r.dayStr, ingredient: r.ingredient, diff: r1(r.remaining! - r.theoretical), idx: r.closingIdx }))
}

/**
 * Per-day audit of `actual - (opening + restock - used)` summed across shift
 * closings; returns Σ|diff × unit_cost| where diff < 0 (hao hụt money lost).
 *
 * Mirrors the formula used inline in InventoryReportCard + RangeLossCard so a
 * single source of truth feeds the FinanceCards "Hao hụt / hủy" line.
 *
 * Opening rules (matches the cards):
 *   - First closing: prevShiftClosings[0]?.inventory_report.remaining map,
 *     OR if `openingOverrideMap` supplied use it as the base (Daily passes
 *     a precomputed map that already folds in yesterday + opening overrides).
 *   - Subsequent closings: previous closing's `remaining` per ingredient.
 *   - Always: `item.opening` on the closing wins when present.
 *
 * dailyConsumption: { 'YYYY-MM-DD': { ingredient: usedAmount, ... } }.
 *   Caller computes via calculateEstimatedConsumption on orders bucketed
 *   by VN local date (matches the existing cards' dayStr key).
 *
 * `recipeIngredients` (optional Set): ingredients consumed by some recipe/extra.
 *   An item NOT in this set has 0 theoretical usage, so its whole depletion is
 *   real consumption (ống hút, bịch chữ T — bao bì chỉ đếm tồn, không vào công
 *   thức), not waste. Those are split into `consumption` keyed by ingredient so
 *   the P&L can name them instead of lumping into "Hao hụt". Omit → all to loss.
 *
 * Returns { loss, consumption: { ingredient: value } }; {loss:0,consumption:{}}
 * when there are no closings.
 */
export function calculateLossValue({
    shiftClosings,
    prevShiftClosings = [],
    dailyConsumption = {},
    ingredientConfigs = [],
    openingOverrideMap = null,
    recipeIngredients = null,
}: {
    shiftClosings?: Row[] | null; prevShiftClosings?: Row[]; dailyConsumption?: Record<string, UsageMap>
    ingredientConfigs?: Row[] | null; openingOverrideMap?: UsageMap | null; recipeIngredients?: Set<string> | null
}) {
    if (!shiftClosings || shiftClosings.length === 0) return { loss: 0, consumption: {} }
    const costByIngredient = new Map<string, number>()
    for (const c of ingredientConfigs || []) costByIngredient.set(c.ingredient, c.unit_cost || 0)

    const diffs = walkDailyIngredientDiff({ shiftClosings, dailyConsumption, prevShiftClosings, openingOverrideMap })

    let totalLoss = 0
    const consumption: UsageMap = {}
    for (const { ingredient, diff } of diffs) {
        const diffValue = diff * (costByIngredient.get(ingredient) || 0)
        if (diffValue < 0) {
            // Không có trong công thức nào → tiêu hao thật, không phải thất thoát.
            if (recipeIngredients && !recipeIngredients.has(ingredient)) {
                consumption[ingredient] = (consumption[ingredient] || 0) + Math.abs(diffValue)
            } else {
                totalLoss += Math.abs(diffValue)
            }
        }
    }
    return { loss: totalLoss, consumption }
}

// Cấp quy đổi 2 của 1 dòng ingredient_costs → { size, unit } (size tính theo cấp 1), hoặc null.
// Dùng làm opts.pack2 cho formatPackedQty (không cấp 1 thì formatPackedQty bỏ qua cấp 2).
export const pack2Of = (cfg?: Row | null): Pack2 | null => cfg?.pack2_size && cfg?.pack2_unit
    ? { size: Number(cfg.pack2_size), unit: cfg.pack2_unit } : null

// Đơn vị nhập/đếm, lớn → nhỏ: [cấp 2], cấp 1, đơn vị gốc. mult = số đơn vị gốc trong 1 đơn vị đó.
// Không có quy cách cấp 1 → chỉ còn đơn vị gốc.
export function unitTiersOf(packSize: unknown, packUnit: string | null | undefined, pack2: Pack2 | null | undefined, baseUnit: string) {
    const base = { key: 'base', label: baseUnit, mult: 1 }
    const ps = Number(packSize) || 0
    if (!ps || !packUnit) return [base]
    return [...(pack2 ? [{ key: 'pack2', label: pack2.unit, mult: ps * pack2.size }] : []), { key: 'pack', label: packUnit, mult: ps }, base]
}

// Số gói nguyên (vd needPacks) → "1 thùng + 3 hộp" khi có cấp 2, không thì "15 hộp".
export function formatPackCount(packs: number, packUnit: string | null | undefined, pack2?: Pack2 | null) {
    const bigs = pack2 ? Math.floor(packs / pack2.size) : 0
    const rem = pack2 ? packs - bigs * pack2.size : packs
    return [bigs > 0 && `${bigs} ${pack2!.unit}`, (rem > 0 || bigs === 0) && `${rem} ${packUnit || ''}`.trim()].filter(Boolean).join(' + ')
}

// Format a base-unit quantity into pack-aware text. e.g. 5350 + (1000, 'bịch', 'g')
// → "5 bịch + 350 g". Falls back to "{qty} {baseUnit}" when pack info missing.
//   qty: number in baseUnit
//   packSize/packUnit: optional pack config
//   baseUnit: the small-unit label (g, ml, cái, …)
//   { compact: true } drops the base remainder when 0 (e.g. "5 bịch" not "5 bịch + 0 g")
//   { pack2: { size, unit } } cấp 2 tính theo CẤP 1: 1 thùng = 12 hộp → "1 thùng + 2 hộp + 40 ml"
export function formatPackedQty(qty: unknown, packSize: unknown, packUnit: string | null | undefined, baseUnit: string | null | undefined, opts: { pack2?: Pack2 | null; compact?: boolean } = {}) {
    const n = Math.round(Number(qty || 0) * 10) / 10
    const unit = baseUnit || 'đv'
    const ps = Number(packSize || 0)
    if (!ps || !packUnit || ps <= 0 || !Number.isFinite(n)) {
        return `${n.toLocaleString('vi-VN')} ${unit}`.trim()
    }
    const sign = n < 0 ? -1 : 1
    const neg = sign < 0 ? '-' : ''
    const abs = Math.abs(n)
    const bigSize = opts.pack2 ? ps * opts.pack2.size : 0
    const bigs = bigSize ? Math.floor(abs / bigSize) : 0
    const afterBig = abs - bigs * bigSize
    const packs = Math.floor(afterBig / ps)
    const rem = r1(afterBig - packs * ps)
    const parts: string[] = []
    if (bigs > 0) parts.push(`${neg}${bigs} ${opts.pack2!.unit}`)
    if (packs > 0) parts.push(`${neg}${packs} ${packUnit}`)
    if (rem > 0 || parts.length === 0 || !opts.compact) parts.push(`${(sign * rem).toLocaleString('vi-VN')} ${unit}`)
    return parts.join(' + ')
}

// Gợi ý quy đổi nhỏ dưới số chính (số chính luôn là đơn vị nhỏ nhất): "= 5 bịch + 350 g".
// null khi không có quy cách đóng gói hoặc chưa đủ 1 gói (khỏi lặp lại đúng số chính).
export function packHint(qty: unknown, packSize: unknown, packUnit: string | null | undefined, baseUnit: string | null | undefined, pack2?: Pack2 | null) {
    const ps = Number(packSize || 0)
    if (!ps || !packUnit || Math.abs(Number(qty || 0)) < ps) return null
    return `= ${formatPackedQty(qty, ps, packUnit, baseUnit, { compact: true, pack2 })}`
}

// Với mỗi nguyên liệu, chọn "sản phẩm đại diện" = món BÁN CHẠY NHẤT có dùng nguyên
// liệu đó, để quy đổi hao hụt → số ly tương đương ("≈ 33 ly cà phê sữa") giúp user
// hình dung magnitude. Bỏ nguyên liệu tỉ lệ 1:1 (ly/nắp) — "≈ 220 ly cà phê sữa" cho
// "Dư 220 cái" không thêm thông tin nào.
//
// orderItems: [{ productId, qty }] đã phẳng hoá (mọi caller đều có sẵn dạng này).
export function buildIngredientToProduct({ orderItems = [], recipes = [], products = [] }: { orderItems?: { productId: string; qty?: number }[]; recipes?: RecipeRow[] | null; products?: Row[] | null }) {
    const sales: Record<string, number> = {}
    for (const i of orderItems) sales[i.productId] = (sales[i.productId] || 0) + (i.qty || 1)

    const map: Record<string, { productId: string; amountPerCup: number; sales: number; productName?: string }> = {}
    for (const r of recipes || []) {
        if (!r.amount || r.amount <= 0) continue
        const s = sales[r.product_id] || 0
        const cur = map[r.ingredient]
        // Ưu tiên best-seller; không có đơn nào thì rơi về recipe gặp đầu tiên.
        if (!cur || s > cur.sales) map[r.ingredient] = { productId: r.product_id, amountPerCup: r.amount, sales: s }
    }

    const byId = new Map((products || []).map(p => [p.id, p]))
    for (const ing of Object.keys(map)) {
        const ref = map[ing]
        const p = byId.get(ref.productId)
        if (!p?.name || ref.amountPerCup === 1) { delete map[ing]; continue }
        ref.productName = p.name.toLowerCase()
    }
    return map
}

const MEASURED_UNITS = new Set(['g', 'ml', 'kg', 'l'])
// Phần bì trừ khỏi tồn quầy: chỉ khi đo được (g/ml/kg/l) và có số đếm quầy.
const tareCutOf = (counter: number | null | undefined, tareWeight: number | null | undefined, unit: string) =>
    MEASURED_UNITS.has(unit) && (tareWeight ?? 0) > 0 && counter != null ? Math.min(counter, tareWeight!) : 0

// Tổng tồn thật = kho + quầy − bì. Tồn quầy lưu là số cân gồm bì nên bì chỉ trừ khi đo được (g/ml/kg/l).
// Dùng chung cho hiển thị tổng và nhãn Hết/Sắp hết để hai nơi không lệch nhau. null = chưa có số tồn.
export function netStockOf(stock: Row | null | undefined, tareWeight: number | null | undefined, unit: string) {
    const total = stock?.current_stock ?? null
    if (total === null) return null
    const counter = stock!.counter_stock
    return r1(total - tareCutOf(counter, tareWeight, unit))
}

// Sắp hết = (còn hàng) mà tồn QUẦY thật (đã trừ bì) < tồn quầy ít nhất, hoặc tồn KHO < tồn kho ít nhất
// (min_stock). Ngưỡng null/0 = không đặt. Hết hàng (tổng ≤ 0) là trạng thái riêng → false ở đây.
export function isLowStockOf(stock: Row, { tareWeight, minStock, minCounterStock }: { tareWeight?: number | null; minStock?: number | null; minCounterStock?: number | null }, unit: string) {
    const net = netStockOf(stock, tareWeight, unit)
    if (net === null || net <= 0) return false
    const counter = stock.counter_stock
    const tareCut = tareCutOf(counter, tareWeight, unit)
    const below = (v: number | null | undefined, min: number | null | undefined) => (min ?? 0) > 0 && v != null && v < min!
    return below(stock.warehouse_stock, minStock) || below(counter != null ? r1(counter - tareCut) : null, minCounterStock)
}

// inventory_report từ DB có thể là mảng hoặc chuỗi JSON → mảng; null nếu hỏng/không phải mảng
// (caller tự quyết bỏ qua hay coi là rỗng — remote rỗng ≠ remote hỏng).
export function parseInventoryReport(v: unknown): Row[] | null {
    if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return null } }
    return Array.isArray(v) ? v : null
}

// Hao hụt = Thực tế − Lý thuyết cho 1 nguyên liệu. null = chưa nhập Cuối kỳ (pending),
// caller phải tự phân biệt null với 0 (đã kiểm và khớp). Nguồn dùng chung giữa
// InventoryReportCard (audit UI) và findMissingCupCandidates bên dưới — tránh 2 nơi
// tính hao hụt lệch công thức nhau.
export function computeBalance({ inventoryValue, restockValue, openingValue, openingFallback, used }: { inventoryValue?: unknown; restockValue?: unknown; openingValue?: unknown; openingFallback?: unknown; used?: unknown }) {
    const openingNum = r1(openingValue ?? openingFallback)
    const restockNum = r1(restockValue)
    const usedNum = r1(used)
    const lyThuyet = r1(openingNum + restockNum - usedNum)
    const hasActual = inventoryValue !== undefined && inventoryValue !== ''
    return { openingNum, usedNum, lyThuyet, haoHut: hasActual ? r1(r1(inventoryValue) - lyThuyet) : null }
}

export const computeHaoHut = (args: Parameters<typeof computeBalance>[0]) => computeBalance(args).haoHut

/**
 * PROTOTYPE — dò nghi vấn "pha bán nhưng không bấm bill": chỉ ra MÓN NÀO, THIẾU MẤY LY.
 *
 * Ý tưởng: coi hao hụt hôm nay là 1 vector (mỗi nguyên liệu hụt bao nhiêu, quy ra tiền). Giả thuyết
 * "pha N ly món P không bấm bill" dự đoán đúng N × công thức P. Điểm của giả thuyết =
 *   phần giá trị hao hụt nó GIẢI THÍCH được (Σ min(hụt, N×định lượng) × giá vốn)
 *   − phần nó dự đoán SAI (nguyên liệu lẽ ra phải hụt N×định lượng mà thực tế không hụt, ngoài dung sai).
 * confidence = điểm / tổng giá trị hao hụt → "khớp X% hao hụt". Nguyên liệu dùng chung mọi món (ly, nắp)
 * không còn tự làm món nào cũng thành nghi vấn: món có cà phê mà cà phê không hụt thì bị trừ điểm.
 *
 * ⚠️ Gợi ý để soi lại, KHÔNG phải kết luận — hụt đúng tỉ lệ 1 công thức vẫn có thể do định lượng sai, đổ nhầm.
 *
 * @param noiseByIngredient ingredient → độ lệch chuẩn hao hụt lịch sử (computeIngredientNoise): dung sai cho phần
 *   "dự đoán sai" = 2× độ ồn; chưa có lịch sử thì 30% định lượng 1 ly.
 * @returns ứng viên confidence ≥ 50%, ≥ 2 nguyên liệu khớp, sort confidence giảm dần — phần tử đầu là nghi vấn
 *   chính. estimatedRevenue = N × giá bán; ingredientValue = giá trị hụt được giải thích; matches = nguyên liệu khớp.
 */
export function findMissingCupCandidates({ ingredientsList = [], haoHutByIngredient = {}, recipes = [], products = [], noiseByIngredient = {}, extraIngredients = {}, productExtras = {}, cashDiff = null }: { ingredientsList?: Row[]; haoHutByIngredient?: Record<string, number | null>; recipes?: RecipeRow[]; products?: Row[] | null; noiseByIngredient?: UsageMap; extraIngredients?: ExtraIngredients; productExtras?: Record<string, CartExtra[]>; cashDiff?: number | null }) {
    const baseByProduct: Record<string, Record<string, number>> = {}
    for (const r of recipes) {
        if (!r.amount || r.amount <= 0) continue
        const b = baseByProduct[r.product_id] ??= {}
        b[r.ingredient] = (b[r.ingredient] || 0) + r.amount
    }
    // Mỗi món = công thức gốc + từng biến thể "món + 1 extra" (size Lớn: Ly 350ml −1, Ly 470ml +1…) — ly bán ra có thể là bản
    // extra, công thức gốc một mình không giải thích được hao hụt của nó. Cộng dồn định lượng, bỏ dòng ≤ 0.
    type Variant = { productId: string; label: string; extraPrice: number; rows: { ingredient: string; amount: number }[] }
    const variants: Variant[] = []
    const maxAmount: UsageMap = {}
    const usedBy: UsageMap = {}
    for (const [productId, base] of Object.entries(baseByProduct)) {
        const seen = new Set<string>()
        const add = (label: string, extraPrice: number, amounts: Record<string, number>) => {
            const rows = Object.entries(amounts).filter(([, a]) => a > 0).map(([ingredient, amount]) => ({ ingredient, amount }))
            variants.push({ productId, label, extraPrice, rows })
            for (const r of rows) { maxAmount[r.ingredient] = Math.max(maxAmount[r.ingredient] || 0, r.amount); seen.add(r.ingredient) }
        }
        add('', 0, base)
        for (const ex of productExtras[productId] || []) {
            const ei = extraIngredients[ex.id]
            if (!ei?.length) continue
            const merged = { ...base }
            for (const e of ei) merged[e.ingredient] = (merged[e.ingredient] || 0) + e.amount
            add(ex.name, Number(ex.price) || 0, merged)
        }
        for (const ing of seen) usedBy[ing] = (usedBy[ing] || 0) + 1
    }
    // Bao bì không đếm được (bịch T, ống hút) hụt không nói gì về số ly → loại khỏi cả mẫu số lẫn công thức.
    const skip = (ingredient: string) => /^(bịch t|ống hút)/.test(ingredientLabel(ingredient).toLowerCase())
    // Trọng số = độ phổ biến trong công thức (ly, nắp có ở mọi món → nặng nhất, rồi cà phê/cacao/matcha) / định lượng
    // lớn nhất → quy về "đơn vị ly", không phụ thuộc giá vốn. Giá vốn chỉ dùng cho ingredientValue.
    const productCount = Object.keys(baseByProduct).length
    const weight: UsageMap = {}
    const unitCost: UsageMap = {}
    for (const ing of ingredientsList) {
        const k = ing.ingredient
        weight[k] = skip(k) || !maxAmount[k] ? 0 : (usedBy[k] || 0) / productCount / maxAmount[k]
        unitCost[k] = Number(ing.unit_cost) || 0
    }
    // Dung sai = 2× độ nhiễu lịch sử (sàn 30% định lượng 1 ly). Ly/nắp đếm được từng cái → không dung sai (đếm sai 1 cái là đã lệch 1 ly): không để nhiễu
    // lịch sử làm "hụt 4 ly" không còn bác được giả thuyết "5 ly".
    const isCup = (ingredient: string) => /^(ly|nắp)/.test(ingredientLabel(ingredient).toLowerCase())
    const tolOf = (ingredient: string, amount: number, noise: number | null) =>
        isCup(ingredient) ? 0 : noise != null ? Math.max(2 * noise, 0.3 * amount) : 0.3 * amount
    const lossOf = (ingredient: string) => {
        const h = lookupByLabel<number | null>(ingredient, haoHutByIngredient, null)
        return h == null ? null : Math.max(0, -h)
    }
    let total = 0
    for (const ing of ingredientsList) total += (lossOf(ing.ingredient) || 0) * (weight[ing.ingredient] || 0)
    if (total <= 0) return []

    const productById = new Map((products || []).map(p => [p.id, p]))
    // Phân rã N ly thành từng món thật theo NGÂN SÁCH hao hụt: lấy từng ly một, mỗi ly phải nằm gọn trong phần hao hụt CÒN LẠI
    // (trừ dần những gì các ly trước đã "dùng" — 36ml sữa đặc hụt chỉ đủ 1 ly cà phê sữa, không phải 3). Mỗi bước chọn món dùng nhiều
    // nguyên liệu nhất trong ngân sách; dung sai như tolOf (ly/nắp không dung sai). Ly nào không món nào đỡ nổi thì để ở `rest`:
    // phần hao hụt chưa gán được món (vd 2 ly + 2 nắp + 34g cà phê → có ly cà phê không sữa/không đường mà menu không có món tương ứng).
    const pool = variants.flatMap(v => {
        const p = productById.get(v.productId)
        if (!p?.is_active || !(Number(p.price) > 0)) return []
        return [{ ...v, name: v.label ? `${p.name} (${v.label})` : p.name, price: Number(p.price) + v.extraPrice, rows: v.rows.filter(r => !skip(r.ingredient)) }]
    })
    // Khoá theo nguyên liệu TRONG CÔNG THỨC (lossOf tự dò theo nhãn): khoá ở ingredientsList có thể khác khoá công thức ("cup" vs "Ly").
    const lossVec = [...new Set(pool.flatMap(v => v.rows.map(r => r.ingredient)))].flatMap(ingredient => {
        const loss = lossOf(ingredient)
        if (loss == null) return []
        const scale = maxAmount[ingredient] || 1
        return [{ ingredient, loss, scale, tol: tolOf(ingredient, scale, lookupByLabel<number | null>(ingredient, noiseByIngredient, null)) }]
    })
    const amtVec = pool.map(v => lossVec.map(x => v.rows.find(r => r.ingredient === x.ingredient)?.amount ?? 0))
    const decompose = (n: number) => {
        const left = lossVec.map(x => x.loss + x.tol)
        const used = lossVec.map(() => 0)
        const cups: MissingCupCandidate['cups'] = []
        for (let c = 0; c < n; c++) {
            let best = -1, bestScore = 0
            amtVec.forEach((a, i) => {
                if (!a.every((x, k) => x <= left[k] + 1e-9)) return
                const score = a.reduce((s, x, k) => s + x / lossVec[k].scale, 0)
                if (score > bestScore) { bestScore = score; best = i }
            })
            if (best < 0) break
            amtVec[best].forEach((x, k) => { left[k] -= x; used[k] += x })
            cups.push({ name: pool[best].name, price: pool[best].price, rows: pool[best].rows })
        }
        const rest = lossVec.flatMap((x, k) => x.loss - used[k] >= 0.25 * x.scale ? [{ ingredient: x.ingredient, amount: r1(x.loss - used[k]) }] : [])
        return { cups, rest }
    }
    const candidates: MissingCupCandidate[] = []
    for (const { productId, label, extraPrice, rows } of variants) {
        const product = productById.get(productId)
        // Giá 0đ (món test/chưa cấu hình giá) → không có chuyện "bán thiếu ghi nhận".
        if (!product?.is_active || !(Number(product.price) > 0)) continue
        const known = rows.filter(r => !skip(r.ingredient)).map(r => {
            const noise = lookupByLabel<number | null>(r.ingredient, noiseByIngredient, null)
            return { ...r, loss: lossOf(r.ingredient), w: weight[r.ingredient] || 0, tol: tolOf(r.ingredient, r.amount, noise) }
        }).filter(r => r.loss != null) as { ingredient: string; amount: number; loss: number; w: number; tol: number }[]
        if (known.length < 2) continue // chưa đếm đủ để cross-check

        const scoreAt = (n: number) => known.reduce((s, r) =>
            s + Math.min(r.loss, n * r.amount) * r.w - Math.max(0, n * r.amount - r.loss - r.tol) * r.w, 0)
        const maxN = Math.min(20, Math.ceil(Math.max(...known.map(r => r.loss / r.amount))))
        const price = (Number(product.price) || 0) + extraPrice
        // Két dư (thực thu > doanh thu hệ thống) = tiền của những ly pha bán không bấm bill: bằng chứng độc lập với kho.
        // n·giá khớp két dư (±10%, tối thiểu 2.000đ) thì n được ưu tiên — hao hụt kho chọn n gần đúng, két chốt n chính xác.
        const cashOk = (n: number) => cashDiff != null && cashDiff > 0 && Math.abs(cashDiff - n * price) <= Math.max(2000, cashDiff * 0.1)
        const sc = Array.from({ length: maxN }, (_, i) => scoreAt(i + 1)) // sc[n-1] = điểm của n ly
        let best = Math.max(0, ...sc), bestN = best > 0 ? sc.indexOf(best) + 1 : 0
        if (!bestN) continue
        let cashN = 0
        for (let n = 1; n <= maxN; n++) if (sc[n - 1] > 0 && cashOk(n) && (!cashN || sc[n - 1] > sc[cashN - 1])) cashN = n
        if (cashN && sc[cashN - 1] >= 0.8 * best) { bestN = cashN; best = sc[cashN - 1] }
        const cashMatch = cashOk(bestN)

        const matches = known.filter(r => r.loss >= 0.5 * bestN * r.amount)
            .map(r => ({ ingredient: r.ingredient, haoHut: -r.loss, amount: r.amount, ratio: r.loss / r.amount }))
        const confidence = best / total
        // Két khớp là bằng chứng thứ 2 → hạ nhẹ ngưỡng hao hụt; vẫn cần ≥ 2 nguyên liệu (két dư có thể chỉ là tiền thừa).
        // Ly/nắp có ở mọi món: chỉ hụt ly+nắp thì không chỉ được món nào → cần ≥ 1 nguyên liệu riêng của món khớp.
        if (matches.length < 2 || !matches.some(m => !isCup(m.ingredient)) || confidence < (cashMatch ? 0.4 : 0.5)) continue
        candidates.push({
            productId,
            productName: label ? `${product.name} (${label})` : product.name,
            estimatedCups: bestN,
            confidence,
            estimatedRevenue: bestN * price,
            cashMatch,
            similar: [],
            ingredientValue: known.reduce((s, r) => s + Math.min(r.loss, bestN * r.amount) * (unitCost[r.ingredient] ?? 0), 0),
            matches,
            ...decompose(bestN),
        })
    }
    // Mỗi món chỉ giữ biến thể khớp nhất (attachRepeatHistory tra theo productId).
    const sorted = candidates.sort((a, b) => Number(b.cashMatch) - Number(a.cashMatch) || b.confidence - a.confidence)
        .filter((c, i, a) => a.findIndex(o => o.productId === c.productId) === i)
    for (const c of sorted) c.similar = sorted.filter(o => o !== c && o.estimatedCups === c.estimatedCups && Math.abs(o.confidence - c.confidence) <= 0.03).map(o => o.productName)
    return sorted
}

// Dựng chuỗi hao hụt THEO TỪNG NGÀY từ lịch sử shift_closings (cùng công thức audit
// dùng trong RangeLossCard: opening = tồn cuối phiên trước đó, restock = item.restock,
// used = tiêu thụ ước tính của ngày đó, diff = thực tế − lý thuyết).
//
// Bỏ qua ngày ĐẦU TIÊN trong window vì không biết chắc "opening" của nó (không có
// phiên trước đó trong tập dữ liệu truyền vào) — đơn giản hơn là phải fetch thêm 1
// ngày đệm chỉ để lấy opening, và không đáng vì mục đích ở đây là dò lặp lại nhiều
// ngày, không phải tính tổng tiền chính xác tuyệt đối.
//
// @returns { [dayStr]: { [ingredient]: diff } } — âm = hụt, chỉ gồm nguyên liệu có
//   trong công thức nào đó (bao bì không công thức bị loại, giống RangeLossCard).
// extraUsageByDay = tiêu hao ròng của mẻ sản xuất theo ngày (overlayProduction({}, rows, true)), cộng vào tiêu hao từ đơn.
export function buildDailyHaoHutMap({ shiftClosings = [], orders = [], recipes = [], extraIngredients = {}, extraUsageByDay = {} }: { shiftClosings?: Row[]; orders?: Row[]; recipes?: RecipeRow[]; extraIngredients?: ExtraIngredients; extraUsageByDay?: Record<string, UsageMap> }) {
    if (!shiftClosings.length) return {}
    const recipeSet = buildRecipeIngredientSet(recipes, extraIngredients)

    const dailyOrderItems: Record<string, ReturnType<typeof orderItemsOf>> = {}
    for (const o of orders) {
        if (!isLiveOrder(o)) continue
        const dayStr = dateStringVN(new Date(o.created_at))
        ;(dailyOrderItems[dayStr] ??= []).push(...orderItemsOf(o))
    }
    const dailyConsumption: Record<string, UsageMap> = {}
    for (const [dayStr, items] of Object.entries(dailyOrderItems)) {
        dailyConsumption[dayStr] = calculateEstimatedConsumption(items, recipes, extraIngredients)
    }
    for (const [dayStr, extra] of Object.entries(extraUsageByDay)) {
        const day = dailyConsumption[dayStr] ??= {}
        for (const [k, v] of Object.entries(extra)) day[k] = r1((day[k] ?? 0) + v)
    }

    const lastClosingPerDay: Record<string, Row> = {}
    for (const c of shiftClosings) {
        const dayStr = dateStringVN(new Date(c.closed_at))
        const prev = lastClosingPerDay[dayStr]
        if (!prev || new Date(c.closed_at) > new Date(prev.closed_at)) lastClosingPerDay[dayStr] = c
    }

    const result: Record<string, UsageMap> = {}
    // idx === 0 bỏ qua: ngày đầu window không có phiên trước đó trong tập dữ liệu
    // truyền vào nên opening chỉ là suy đoán (mặc định 0) — không đủ tin để tính diff.
    for (const { dayStr, ingredient, diff, idx } of walkDailyIngredientDiff({
        shiftClosings: Object.values(lastClosingPerDay), dailyConsumption,
    })) {
        if (idx === 0 || !recipeSet.has(ingredient)) continue
        ;(result[dayStr] ??= {})[ingredient] = diff
    }
    return result
}

// Độ nhiễu tự nhiên (đo lường + cân đong) của TỪNG nguyên liệu, suy ra từ độ lệch
// chuẩn hao hụt trong lịch sử gần đây — thay cho tolerance % cứng dùng chung cho mọi
// nguyên liệu. Cần ≥3 ngày có dữ liệu mới tin — ít hơn thì để findMissingCupCandidates
// tự fallback về ±30%/±0.5.
// @returns { [ingredient]: độ lệch chuẩn (đơn vị gốc của nguyên liệu, vd g/ml) }
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2 }
export function computeIngredientNoise(historicalDailyHaoHut: Record<string, UsageMap> = {}) {
    const valuesByIngredient: Record<string, number[]> = {}
    for (const dayMap of Object.values(historicalDailyHaoHut)) {
        for (const [ingredient, diff] of Object.entries(dayMap)) {
            ;(valuesByIngredient[ingredient] ??= []).push(diff)
        }
    }
    const noise: UsageMap = {}
    for (const [ingredient, values] of Object.entries(valuesByIngredient)) {
        if (values.length < 3) continue
        // Median + MAD (×1.4826 ≈ độ lệch chuẩn nếu phân phối chuẩn) thay vì độ lệch chuẩn: vài ngày bán thiếu thật
        // (chính tín hiệu cần tìm) không làm phồng độ nhiễu của chính nó.
        const med = median(values)
        noise[ingredient] = 1.4826 * median(values.map(v => Math.abs(v - med)))
    }
    return noise
}

/**
 * Chạy findMissingCupCandidates trên TỪNG ngày lịch sử → 1 Set productId mỗi ngày.
 *
 * Tách riêng khỏi attachRepeatHistory vì đây là phần ĐẮT (quét tới 14 ngày) nhưng chỉ
 * phụ thuộc dữ liệu lịch sử — đứng yên trong lúc nhân viên gõ ô kiểm kê. Gộp chung như
 * trước thì mỗi phím gõ quét lại cả 14 ngày. Caller memo hoá riêng 2 phần.
 *
 * @param {Object} historicalDailyHaoHut - { [dayStr]: {ingredient: diff} } từ buildDailyHaoHutMap
 * @param {Object} [noiseByIngredient] - từ computeIngredientNoise, dùng CHUNG dung sai
 *   thích nghi cho cả ngày hôm nay lẫn từng ngày lịch sử — nhất quán 1 tiêu chuẩn.
 * @returns {Array<Set<string>>} mỗi phần tử = productId là candidate của 1 ngày lịch sử
 */
export function buildDayCandidateSets({ ingredientsList, historicalDailyHaoHut = {}, recipes, products, noiseByIngredient = {}, extraIngredients, productExtras }: { ingredientsList?: Row[]; historicalDailyHaoHut?: Record<string, UsageMap>; recipes?: RecipeRow[]; products?: Row[] | null; noiseByIngredient?: UsageMap; extraIngredients?: ExtraIngredients; productExtras?: Record<string, CartExtra[]> }) {
    return Object.keys(historicalDailyHaoHut).map(dayStr =>
        new Set(findMissingCupCandidates({
            ingredientsList, recipes, products, haoHutByIngredient: historicalDailyHaoHut[dayStr], noiseByIngredient, extraIngredients, productExtras,
        }).map(c => c.productId))
    )
}

/**
 * Gắn "lặp lại mấy ngày gần đây" vào các candidate của hôm nay — tín hiệu quan
 * trọng nhất để phân biệt trùng hợp ngẫu nhiên (1 ngày) với dấu hiệu thật (lặp lại
 * nhiều ngày).
 *
 * @param {Array} todayCandidates - kết quả findMissingCupCandidates() của hôm nay
 * @param {Array<Set<string>>} dayCandidateSets - từ buildDayCandidateSets()
 * @returns candidates hôm nay, thêm field `repeatDays` (số ngày gần đây món này CŨNG
 *   là candidate) + `repeatWindowDays` (tổng số ngày có dữ liệu để so), sort theo
 *   repeatDays trước tiên — lặp lại nhiều ngày mới đáng tin, không phải trùng hợp 1 lần — rồi % hao hụt khớp.
 */
export function attachRepeatHistory<C extends { productId: string; matches: unknown[]; confidence: number; cashMatch?: boolean }>(todayCandidates: C[], dayCandidateSets: Set<string>[] = []) {
    if (!todayCandidates.length) return []
    return todayCandidates
        .map(c => ({
            ...c,
            repeatDays: dayCandidateSets.filter(set => set.has(c.productId)).length,
            repeatWindowDays: dayCandidateSets.length,
        }))
        .sort((a, b) => Number(!!b.cashMatch) - Number(!!a.cashMatch) || b.repeatDays - a.repeatDays || b.confidence - a.confidence)
}
