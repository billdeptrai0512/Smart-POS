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
export function calculateItemCost(productId, extras = [], recipes = [], extraIngredients = {}, ingredientCosts = {}) {
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

/**
 * Tính tổng lượng nguyên liệu tiêu hao dự kiến dựa trên danh sách món đã bán.
 * 
 * @param {Array} orderItems - Mảng các order item (có thể lấy từ todayOrders + offlineToday)
 *                             Cấu trúc yêu cầu: { product_id hoặc productId, quantity hoặc qty, extras: [] }
 * @param {Array} recipes - Toàn bộ bản ghi recipes
 * @param {Object} extraIngredients - Map extra_id -> array of {ingredient, amount}
 * @returns {Object} object mapping ingredient -> tổng số lượng tiêu hao
 */
export function calculateEstimatedConsumption(orderItems, recipes, extraIngredients) {
    const estimated = {};

    orderItems.forEach(item => {
        // Hỗ trợ cả 2 naming convention (productId vs product_id)
        const id = item.productId || item.product_id;
        const qty = item.quantity || item.qty || 1;
        const extras = item.extras || [];

        // 1. Tiêu hao của món chính
        const productRecipes = recipes.filter(r => r.product_id === id);
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
 * Tính breakdown tiêu hao theo từng biến thể (sản phẩm + tổ hợp extras) cho mỗi nguyên liệu.
 * Dùng để drill-down "Tiêu CT" trong inventory audit.
 *
 * Variant key: `productId` nếu không có extras, hoặc `productId|<sorted extra ids>`.
 *
 * @returns {Object} breakdown[ingredient][variantKey] = { name, qty, totalAmount }
 */
export function calculateConsumptionBreakdown(orderItems, recipes, extraIngredients, products = [], productExtras = {}) {
    const breakdown = {};

    // Build extra-id → extra-name lookup từ productExtras { productId: [{ id, name, ... }] }
    const extraNames = {};
    Object.values(productExtras || {}).forEach(list => {
        (list || []).forEach(ex => {
            if (ex && ex.id) extraNames[ex.id] = ex.name || ex.id;
        });
    });

    const ensure = (ingredient, variantKey, displayName) => {
        if (!breakdown[ingredient]) breakdown[ingredient] = {};
        if (!breakdown[ingredient][variantKey]) {
            breakdown[ingredient][variantKey] = { name: displayName, qty: 0, totalAmount: 0 };
        }
    };

    orderItems.forEach(item => {
        const id = item.productId || item.product_id;
        const qty = item.quantity || item.qty || 1;
        const extras = item.extras || [];
        const productName = products.find(p => p.id === id)?.name || id;

        const extraIds = extras.map(e => e?.id).filter(Boolean).slice().sort();
        const variantKey = extraIds.length ? `${id}|${extraIds.join(',')}` : id;
        const extraLabels = extraIds.map(eid => extraNames[eid] || eid);
        const displayName = extraLabels.length
            ? `${productName} (${extraLabels.join(', ')})`
            : productName;

        // Track which ingredients this order item touches, so qty is counted only once
        // even if both base recipe and an extra affect the same ingredient.
        const counted = new Set();

        const touch = (ingredient, amount) => {
            ensure(ingredient, variantKey, displayName);
            if (!counted.has(ingredient)) {
                breakdown[ingredient][variantKey].qty += qty;
                counted.add(ingredient);
            }
            breakdown[ingredient][variantKey].totalAmount =
                Math.round((breakdown[ingredient][variantKey].totalAmount + amount * qty) * 10) / 10;
        };

        recipes.filter(r => r.product_id === id).forEach(r => touch(r.ingredient, r.amount));
        extras.forEach(extra => {
            (extraIngredients[extra.id] || []).forEach(ei => touch(ei.ingredient, ei.amount));
        });
    });

    return breakdown;
}

/**
 * Tính toán số lượng cần nhập dựa trên lịch sử tiêu thụ và mức tồn kho.
 * Hỗ trợ làm tròn theo quy cách đóng gói (pack size) và tồn tối thiểu (min stock).
 *
 * @param {Object} params
 * @param {number} params.past7DaysUsed - Tổng số lượng tiêu hao trong 7 ngày qua
 * @param {number} params.currentStock - Số lượng tồn kho hiện tại
 * @param {number} params.wastagePct - Phần trăm hao hụt dự phòng (ví dụ 10 cho 10%)
 * @param {number|null} params.minStock - Ngưỡng tồn kho tối thiểu
 * @param {number|null} params.packSize - Quy cách đóng gói (ví dụ 500)
 * @returns {Object} { packsNeeded, finalRefill, coverageDays, isMinStockTriggered, rawTarget }
 */
export function calculateRefillTarget({
    past7DaysUsed,
    currentStock,
    wastagePct,
    minStock = null,
    packSize = null
}) {
    // 1. Tính mức tiêu thụ trung bình mỗi ngày
    const dailyAvg = (past7DaysUsed || 0) / 7;

    // 2. Tính số lượng mục tiêu thô cần có cho ngày tiếp theo (có tính hao hụt)
    let rawTarget = Math.round(dailyAvg * (1 + (wastagePct || 0) / 100) * 10) / 10;

    // 3. Áp dụng sàn tồn tối thiểu (minStock)
    const effectiveTarget = Math.max(minStock ?? 0, rawTarget);
    const isMinStockTriggered = minStock != null && minStock > rawTarget && currentStock < minStock;

    // 4. Tính khoảng trống cần bù (gap)
    let gap = effectiveTarget - currentStock;
    if (gap < 0) gap = 0;

    // 5. Làm tròn theo quy cách đóng gói (packSize)
    let packsNeeded = 0;
    let finalRefill = gap;

    if (packSize && packSize > 0) {
        if (gap > 0) {
            packsNeeded = Math.ceil(gap / packSize);
            finalRefill = packsNeeded * packSize;
        } else {
            packsNeeded = 0;
            finalRefill = 0;
        }
    } else {
        finalRefill = Math.round(finalRefill * 10) / 10; // Làm tròn 1 chữ số thập phân nếu không có packSize
    }

    // 6. Tính số ngày bao phủ (coverageDays)
    const totalAfterRefill = currentStock + finalRefill;
    const coverageDays = dailyAvg > 0 ? Math.round((totalAfterRefill / dailyAvg) * 10) / 10 : Infinity;

    return {
        packsNeeded,
        finalRefill,
        coverageDays,
        isMinStockTriggered,
        rawTarget,
        effectiveTarget
    };
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
export function splitCogsByCategory(orders, recipes, extraIngredients, ingredientCosts, categoryByIngredient) {
    const bucket = { main: 0, packaging: 0, tools: 0 }
    const bucketFor = (key) => {
        const cat = (categoryByIngredient?.get?.(key)) ?? categoryByIngredient?.[key] ?? null
        return cat === 'packaging' || cat === 'tools' ? cat : 'main'
    }
    for (const o of orders || []) {
        if (o?.deleted_at) continue
        const items = o.order_items || o.cart || o.orderItems || []
        for (const item of items) {
            const qty = item.quantity || item.qty || 1
            const productId = item.product_id || item.productId
            for (const r of recipes || []) {
                if (r.product_id !== productId) continue
                bucket[bucketFor(r.ingredient)] += (ingredientCosts[r.ingredient] || 0) * (r.amount || 0) * qty
            }
            const extras = item.extras || (item.extra_ids ? item.extra_ids.map(id => ({ id })) : [])
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

/**
 * Per-day audit of `actual - (opening + restock - used)` summed across shift
 * closings; returns Σ|diff × unit_cost| where diff < 0 (hao hụt money lost).
 *
 * Mirrors the formula used inline in InventoryRefillCard + RangeLossCard so a
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
export function buildRecipeIngredientSet(recipes = [], extraIngredients = {}) {
    const set = new Set()
    for (const r of recipes) if (r?.ingredient) set.add(r.ingredient)
    for (const list of Object.values(extraIngredients || {}))
        for (const ei of (list || [])) if (ei?.ingredient) set.add(ei.ingredient)
    return set
}

export function calculateLossValue({
    shiftClosings,
    prevShiftClosings = [],
    dailyConsumption = {},
    ingredientConfigs = [],
    openingOverrideMap = null,
    recipeIngredients = null,
}) {
    if (!shiftClosings || shiftClosings.length === 0) return { loss: 0, consumption: {} }
    const sorted = [...shiftClosings].sort((a, b) =>
        new Date(a.closed_at || a.created_at) - new Date(b.closed_at || b.created_at)
    )
    const costByIngredient = new Map()
    for (const c of ingredientConfigs || []) costByIngredient.set(c.ingredient, c.unit_cost || 0)

    let prevPeriodMap = null
    if (openingOverrideMap) {
        prevPeriodMap = openingOverrideMap
    } else if (prevShiftClosings?.[0]?.inventory_report) {
        prevPeriodMap = {}
        for (const it of prevShiftClosings[0].inventory_report) {
            prevPeriodMap[it.ingredient] = it.remaining ?? 0
        }
    } else {
        prevPeriodMap = {}
    }

    let totalLoss = 0
    const consumption = {}
    sorted.forEach((closing, idx) => {
        if (!closing.inventory_report) return
        const dayStr = new Date(closing.closed_at || closing.created_at).toLocaleDateString('sv-SE')
        const usedMap = dailyConsumption[dayStr] || {}

        for (const item of closing.inventory_report) {
            if (item.remaining == null) continue
            let opening
            if (item.opening != null) {
                opening = item.opening
            } else if (idx === 0) {
                opening = prevPeriodMap[item.ingredient] ?? 0
            } else {
                const prev = sorted[idx - 1]
                const prevItem = (prev?.inventory_report || []).find(i => i.ingredient === item.ingredient)
                opening = prevItem?.remaining ?? 0
            }
            const restock = item.restock || 0
            const used = Math.round((usedMap[item.ingredient] || 0) * 10) / 10
            const theoretical = Math.round((opening + restock - used) * 10) / 10
            const diff = Math.round((item.remaining - theoretical) * 10) / 10
            const diffValue = diff * (costByIngredient.get(item.ingredient) || 0)
            if (diffValue < 0) {
                // Không có trong công thức nào → tiêu hao thật, không phải thất thoát.
                if (recipeIngredients && !recipeIngredients.has(item.ingredient)) {
                    consumption[item.ingredient] = (consumption[item.ingredient] || 0) + Math.abs(diffValue)
                } else {
                    totalLoss += Math.abs(diffValue)
                }
            }
        }
    })
    return { loss: totalLoss, consumption }
}

// Format a base-unit quantity into pack-aware text. e.g. 5350 + (1000, 'bịch', 'g')
// → "5 bịch + 350 g". Falls back to "{qty} {baseUnit}" when pack info missing.
//   qty: number in baseUnit
//   packSize/packUnit: optional pack config
//   baseUnit: the small-unit label (g, ml, cái, …)
//   { compact: true } drops the base remainder when 0 (e.g. "5 bịch" not "5 bịch + 0 g")
export function formatPackedQty(qty, packSize, packUnit, baseUnit, opts = {}) {
    const n = Math.round(Number(qty || 0) * 10) / 10
    const unit = baseUnit || 'đv'
    const ps = Number(packSize || 0)
    if (!ps || !packUnit || ps <= 0 || !Number.isFinite(n)) {
        return `${n.toLocaleString('vi-VN')} ${unit}`.trim()
    }
    const sign = n < 0 ? -1 : 1
    const abs = Math.abs(n)
    const packs = Math.floor(abs / ps)
    const rem = Math.round((abs - packs * ps) * 10) / 10
    const parts = []
    if (packs > 0) parts.push(`${sign < 0 ? '-' : ''}${packs} ${packUnit}`)
    if (rem > 0 || packs === 0 || !opts.compact) parts.push(`${(sign * rem).toLocaleString('vi-VN')} ${unit}`)
    return parts.filter(Boolean).join(' + ')
}
