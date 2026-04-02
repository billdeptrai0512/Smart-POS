// Quick Extras (UUID formatted for safe DB parsing)
export const QUICK_EXTRAS = [
    { id: 'ex1', name: 'Lớn', price: 6000 },
    { id: 'ex2', name: 'Trà đá', price: 0 },
]

// Payment methods (order-level, not per-item)
// export const PAYMENT_METHODS = [
//     { id: 'cash', name: 'Tiền mặt', label: 'Tiền mặt' },
//     { id: 'transfer', name: 'Chuyển khoản', label: 'Momo' },
// ]

// Ingredient display names for warnings
export const INGREDIENT_NAMES = {
    coffee_g: 'Cà phê',
    cacao_powder_g: 'Cacao',
    matcha_powder_g: 'Matcha',
    sugar_g: 'Đường',
    condensed_milk_ml: 'Sữa đặc',
    fresh_milk_ml: 'Sữa tươi',
    salt_cream_ml: 'Kem muối',
    cup: 'Ly',
    lid: 'Nắp',
}


// Vietnamese day names
export const DAY_NAMES = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

// Ingredient unit costs for profit calculation
export const INGREDIENT_COSTS = {
    coffee_g: 250,           // 250đ/g -> 250k/kg
    cacao_powder_g: 650,      // 650đ/g -> 130k/200g
    matcha_powder_g: 1000,    // 1000đ/g -> 100k/100g
    sugar_g: 19,             // 19đ/g -> 19k/kg
    rich_g: 150,             // 150đ/g -> 150k/kg
    condensed_milk_ml: 50,   // 62.000đ = 1 hộp - 1.284kg/l => 62.000đ / 1.284l = 48.286đ/ml -> sửa đặc hộp lớn  ~ 60k
    fresh_milk_ml: 35,       // 35.000đ = 1 hộp / 1l => 35đ/ml -> sữa tươi hộp lớn  
    cup: 800,                // 800đ/ly nhựa
    lid: 200,                // 200đ/nắp
}
