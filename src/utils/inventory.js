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
