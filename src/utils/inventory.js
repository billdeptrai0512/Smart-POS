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
