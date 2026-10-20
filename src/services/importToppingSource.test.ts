import { describe, it, expect } from 'vitest'
import { resolveImportPlan, type ExistingData, type ParsedWorkbook } from './importService'

const existing: ExistingData = { products: [], toppings: [{ id: 't1', name: 'Trân châu' }], ingredientCosts: { đường: {}, trân_châu_nấu: {} }, extras: [], discountPrograms: [] }
const parsed = (toppings: Record<string, unknown>[]): ParsedWorkbook => ({
    products: [], ingredients: [], recipes: [], toppings, toppingIngredients: [], toppingLinks: [], extras: [], extraIngredients: [], sheets: ['Topping'],
})

describe('import Excel: nguồn tồn kho của topping', () => {
    it('đọc nguồn (nguyên liệu / thành phẩm có sẵn), bỏ qua + cảnh báo khi thiếu cột, sai tên, hoặc lượng ≤ 0', () => {
        const { plan, warnings } = resolveImportPlan(parsed([
            { 'Tên topping': 'Trân châu', 'Giá bán': 5000, 'Nguồn tồn kho': 'Trân châu nấu', 'Lượng mỗi phần': 30 },
            { 'Tên topping': 'Kem', 'Giá bán': 7000, 'Nguồn tồn kho': 'Đường', 'Lượng mỗi phần': '' },
            { 'Tên topping': 'Thạch', 'Giá bán': 5000, 'Nguồn tồn kho': 'Không có', 'Lượng mỗi phần': 10 },
            { 'Tên topping': 'Sương sáo', 'Giá bán': 5000, 'Nguồn tồn kho': 'Đường', 'Lượng mỗi phần': 0 },
            { 'Tên topping': 'Flan', 'Giá bán': 5000 },
        ]), existing)
        expect(plan.toppingSources).toEqual([{ toppingName: 'Trân châu', ingredient: 'trân_châu_nấu', amount: 30 }])
        expect(warnings).toHaveLength(3)
    })
})
