// Format VND currency
export function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + 'đ'
}

// Format a raw number string with Vietnamese thousand separators for input display
// e.g. "1000000" → "1.000.000"
export function formatVNDInput(value) {
    if (!value && value !== 0) return ''
    const numStr = String(value).replace(/[^\d]/g, '')
    if (!numStr) return ''
    return new Intl.NumberFormat('vi-VN').format(Number(numStr))
}

// Parse a formatted VND input string back to a number
// e.g. "1.000.000" → 1000000
export function parseVNDInput(formatted) {
    if (!formatted) return 0
    const numStr = String(formatted).replace(/[^\d]/g, '')
    return Number(numStr) || 0
}

// Calculate the ingredient cost of a single product based on its recipe
// ingredientCosts must be provided from DB
export function calculateProductCost(productId, recipes, ingredientCosts) {
    if (!recipes || !Array.isArray(recipes)) return 0;
    const costs = ingredientCosts || {};
    const productRecipe = recipes.filter(r => r.product_id === productId);

    return productRecipe.reduce((totalCost, item) => {
        const unitCost = costs[item.ingredient] || 0;
        return totalCost + (item.amount * unitCost);
    }, 0);
}
