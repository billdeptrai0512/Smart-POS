import { describe, it, expect } from 'vitest';
import { calculateEstimatedConsumption, calculateConsumptionBreakdown } from './inventory';

const recipes = [
    { product_id: 'cf_den', ingredient: 'coffee_g', amount: 18 },
    { product_id: 'cf_den', ingredient: 'cup', amount: 1 },
    { product_id: 'cf_sua', ingredient: 'coffee_g', amount: 22 },
    { product_id: 'cf_sua', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: 'cf_sua', ingredient: 'cup', amount: 1 },
];

const extraIngredients = {
    size_l: [
        { ingredient: 'coffee_g', amount: 5 },
        { ingredient: 'cup', amount: 0 },
    ],
};

const products = [
    { id: 'cf_den', name: 'Cà phê đen' },
    { id: 'cf_sua', name: 'Cà phê sữa' },
];

// ─── calculateEstimatedConsumption ───────────────────────────────────────────

describe('calculateEstimatedConsumption', () => {
    it('tính đúng tiêu hao cơ bản không có extras', () => {
        const orders = [
            { productId: 'cf_den', qty: 3, extras: [] },
            { productId: 'cf_sua', qty: 2, extras: [] },
        ];
        const result = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        expect(result['coffee_g']).toBe(3 * 18 + 2 * 22); // 54 + 44 = 98
        expect(result['condensed_milk_ml']).toBe(2 * 30);  // 60
        expect(result['cup']).toBe(3 + 2);                 // 5
    });

    it('cộng đúng lượng từ extras', () => {
        const orders = [{ productId: 'cf_den', qty: 2, extras: [{ id: 'size_l' }] }];
        const result = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        // 2 * (18 + 5) = 46
        expect(result['coffee_g']).toBe(46);
    });

    it('trả về 0 khi không có đơn hàng', () => {
        const result = calculateEstimatedConsumption([], recipes, extraIngredients);
        expect(Object.keys(result).length).toBe(0);
    });

    it('xoá nguyên liệu có lượng = 0 sau khi tính', () => {
        const zeroExtra = { size_zero: [{ ingredient: 'coffee_g', amount: -18 }] };
        const orders = [{ productId: 'cf_den', qty: 1, extras: [{ id: 'size_zero' }] }];
        const result = calculateEstimatedConsumption(orders, recipes, zeroExtra);
        expect(result['coffee_g']).toBeUndefined();
    });

    it('làm tròn 1 chữ số thập phân để tránh floating point', () => {
        const fractionalRecipes = [{ product_id: 'p1', ingredient: 'syrup_ml', amount: 0.1 }];
        const orders = Array.from({ length: 3 }, () => ({ productId: 'p1', qty: 1, extras: [] }));
        const result = calculateEstimatedConsumption(orders, fractionalRecipes, {});
        expect(result['syrup_ml']).toBe(0.3);
    });

    it('hỗ trợ cả product_id lẫn productId', () => {
        const orders = [{ product_id: 'cf_den', quantity: 1, extras: [] }];
        const result = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        expect(result['coffee_g']).toBe(18);
    });
});

// ─── calculateConsumptionBreakdown ───────────────────────────────────────────

describe('calculateConsumptionBreakdown', () => {
    it('nhóm đúng theo productId', () => {
        const orders = [
            { productId: 'cf_den', qty: 3, extras: [] },
            { productId: 'cf_sua', qty: 2, extras: [] },
        ];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        expect(result['coffee_g']['cf_den'].qty).toBe(3);
        expect(result['coffee_g']['cf_den'].totalAmount).toBe(54);
        expect(result['coffee_g']['cf_sua'].qty).toBe(2);
        expect(result['coffee_g']['cf_sua'].totalAmount).toBe(44);
    });

    it('tổng breakdown khớp với calculateEstimatedConsumption', () => {
        const orders = [
            { productId: 'cf_den', qty: 5, extras: [] },
            { productId: 'cf_sua', qty: 3, extras: [{ id: 'size_l' }] },
        ];
        const total = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        const breakdown = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);

        for (const [ingredient, byProduct] of Object.entries(breakdown)) {
            const sumFromBreakdown = Object.values(byProduct).reduce((s, e) => s + e.totalAmount, 0);
            expect(Math.round(sumFromBreakdown * 10) / 10).toBe(total[ingredient]);
        }
    });

    it('dùng productId làm name fallback khi không có trong products', () => {
        const orders = [{ productId: 'unknown_id', qty: 1, extras: [] }];
        const customRecipes = [{ product_id: 'unknown_id', ingredient: 'coffee_g', amount: 10 }];
        const result = calculateConsumptionBreakdown(orders, customRecipes, {}, []);
        expect(result['coffee_g']['unknown_id'].name).toBe('unknown_id');
    });

    it('accumulate đúng khi cùng product xuất hiện nhiều lần', () => {
        const orders = [
            { productId: 'cf_den', qty: 2, extras: [] },
            { productId: 'cf_den', qty: 3, extras: [] },
        ];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        expect(result['coffee_g']['cf_den'].qty).toBe(5);
        expect(result['coffee_g']['cf_den'].totalAmount).toBe(90);
    });

    it('extras cộng vào đúng sản phẩm đặt hàng', () => {
        const orders = [{ productId: 'cf_den', qty: 1, extras: [{ id: 'size_l' }] }];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        // 18 (recipe) + 5 (extra) = 23
        expect(result['coffee_g']['cf_den'].totalAmount).toBe(23);
    });

    it('trả về object rỗng khi không có đơn hàng', () => {
        const result = calculateConsumptionBreakdown([], recipes, extraIngredients, products);
        expect(Object.keys(result).length).toBe(0);
    });
});
