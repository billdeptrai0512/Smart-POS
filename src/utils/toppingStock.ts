import type { ExtraIngredients, RecipeRow } from './inventory'

// Topping có 1 dòng tồn kho riêng cùng tên (ingredient_costs, tạo cùng lúc với topping). Khi xoá topping, dòng đó chỉ được dọn nếu
// không còn ai dùng khoá này: thành phẩm trùng tên, công thức món, tuỳ chọn thêm / nguồn của topping khác, công thức topping khác.
export function isIngredientReferenced(key: string, ctx: {
    recipes: RecipeRow[]
    extraIngredients: ExtraIngredients // gồm cả nguồn của topping (key = id extra hoặc topping)
    batchKeys: Set<string>
    toppingIngredients: Record<string, { ingredient: string }[]> // công thức của các topping KHÁC
    excludeId: string // topping đang xoá
}) {
    if (ctx.batchKeys.has(key)) return true
    if (ctx.recipes.some(r => r.ingredient === key)) return true
    if (Object.entries(ctx.extraIngredients).some(([id, rows]) => id !== ctx.excludeId && rows.some(r => r.ingredient === key))) return true
    return Object.entries(ctx.toppingIngredients).some(([id, rows]) => id !== ctx.excludeId && rows.some(r => r.ingredient === key))
}
