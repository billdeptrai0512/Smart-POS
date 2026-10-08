// Nhân bản chi nhánh: applySnapshot phải dịch id nguồn → id mới ở MỌI bảng con (nhóm nguyên liệu,
// topping, giảm giá) và chép nguyên row ingredient_costs. Nguồn: src/services/backupService.js

import { describe, it, expect, vi, beforeEach } from 'vitest'

const inserts = [] // { table, rows }
const rpcData = { current: null }

vi.mock('../../src/lib/supabaseClient', () => ({
    supabase: {
        rpc: async () => ({ data: rpcData.current, error: null }),
        from: (table) => ({
            insert: async (rows) => { inserts.push({ table, rows }); return { error: null } },
            delete: () => ({ eq: async () => ({ error: null }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
        }),
    },
}))

import { cloneAddressConfig } from '../../src/services/backupService'

const rowsOf = (table) => inserts.filter(i => i.table === table).flatMap(i => i.rows)

describe('cloneAddressConfig', () => {
    beforeEach(() => {
        inserts.length = 0
        rpcData.current = {
            products: [{ id: 'p1', name: 'Trà', price: 10000, sort_order: 0, count_as_cup: true, is_divider: false }],
            recipes: [], extras: [], extra_ingredients: [],
            ingredient_groups: [{ id: 'g1', name: 'Sữa', section: 'main', sort_order: 2 }],
            costs: [
                { ingredient: 'sữa', unit_cost: 5, unit: 'ml', category: 'main', group_id: 'g1', pack_size: 1286, pack_unit: 'hộp', pack2_size: 12, pack2_unit: 'thùng', min_stock: 2, min_counter_stock: 1, count_in_audit: false, tare_weight: 30 },
                { ingredient: 'ly', unit_cost: 1, unit: 'cái', category: 'packaging', group_id: null },
            ],
            ingredient_sort_order: [],
            toppings: [{ id: 't1', name: 'Trân châu', price: 5000, sort_order: 0 }],
            topping_ingredients: [{ topping_id: 't1', ingredient: 'sữa', amount: 1, unit: 'ml' }],
            product_toppings: [{ product_id: 'p1', topping_id: 't1' }, { product_id: 'p-lạ', topping_id: 't1' }],
            discount_programs: [{ id: 'd1', name: 'Happy hour', type: 'percent', value: 20, days_of_week: [1], start_date: null, end_date: null, enabled: true }],
            discount_program_products: [{ discount_program_id: 'd1', product_id: 'p1' }],
            expense_categories: [{ name: 'Tiền sữa', group_section: 'inventory', sort_order: 5, is_active: true, is_default: false }],
        }
    })

    it('chép nhóm + nguyên row ingredient_costs, group_id trỏ về nhóm MỚI', async () => {
        await cloneAddressConfig('src', 'dst')
        const [group] = rowsOf('ingredient_groups')
        expect(group).toMatchObject({ name: 'Sữa', section: 'main', sort_order: 2, address_id: 'dst' })
        expect(group.id).not.toBe('g1')

        const [sua, ly] = rowsOf('ingredient_costs')
        expect(sua).toMatchObject({ address_id: 'dst', group_id: group.id, pack_size: 1286, pack2_unit: 'thùng', min_counter_stock: 1, count_in_audit: false, tare_weight: 30 })
        expect(ly.group_id).toBeNull()
    })

    it('danh mục chi phí: thay bộ mặc định bằng bộ của nguồn, gắn địa chỉ mới', async () => {
        await cloneAddressConfig('src', 'dst')
        expect(rowsOf('expense_categories')).toEqual([{ name: 'Tiền sữa', group_section: 'inventory', sort_order: 5, is_active: true, is_default: false, address_id: 'dst' }])
    })

    it('topping + giảm giá: id con trỏ về id mới, bỏ liên kết tới món không có trong menu', async () => {
        await cloneAddressConfig('src', 'dst')
        const newProductId = rowsOf('products')[0].id
        const [topping] = rowsOf('toppings')
        expect(topping).toMatchObject({ name: 'Trân châu', address_id: 'dst' })
        expect(rowsOf('topping_ingredients')).toEqual([{ topping_id: topping.id, ingredient: 'sữa', amount: 1, unit: 'ml' }])
        expect(rowsOf('product_toppings')).toEqual([{ product_id: newProductId, topping_id: topping.id }])

        const [program] = rowsOf('discount_programs')
        expect(program).toMatchObject({ name: 'Happy hour', enabled: true, address_id: 'dst' })
        expect(program.id).not.toBe('d1')
        expect(rowsOf('discount_program_products')).toEqual([{ discount_program_id: program.id, product_id: newProductId }])
    })
})
