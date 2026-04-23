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

    // ── qty không bị double-count khi extra ảnh hưởng cùng ingredient với recipe ──

    it('[qty] 1 ly không có extra → qty=1', () => {
        const orders = [{ productId: 'cf_den', qty: 1, extras: [] }];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        expect(result['coffee_g']['cf_den'].qty).toBe(1);
    });

    it('[qty] 1 ly có extra ảnh hưởng cùng coffee_g → qty vẫn là 1, không phải 2', () => {
        const orders = [{ productId: 'cf_den', qty: 1, extras: [{ id: 'size_l' }] }];
        const result = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        // BUG cũ: qty=2 (base+extra đều increment), ĐÚNG: qty=1
        expect(result['coffee_g']['cf_den'].qty).toBe(1);
        expect(result['coffee_g']['cf_den'].totalAmount).toBe(23); // 18+5
    });

    it('[qty] 50 ly cà phê sữa, 20 có size_l → qty=50 (không phải 70)', () => {
        const recipesLocal = [{ product_id: 'cf_sua', ingredient: 'coffee_g', amount: 17 }];
        const extraIngsLocal = { size_l: [{ ingredient: 'coffee_g', amount: 8 }] };
        const orders = [
            ...Array.from({ length: 30 }, () => ({ productId: 'cf_sua', qty: 1, extras: [] })),
            ...Array.from({ length: 20 }, () => ({ productId: 'cf_sua', qty: 1, extras: [{ id: 'size_l' }] })),
        ];
        const result = calculateConsumptionBreakdown(orders, recipesLocal, extraIngsLocal, [{ id: 'cf_sua', name: 'Cà phê sữa' }]);
        expect(result['coffee_g']['cf_sua'].qty).toBe(50);                    // 50 ly thực tế
        expect(result['coffee_g']['cf_sua'].totalAmount).toBe(30 * 17 + 20 * 25); // 510+500=1010
    });

    it('[qty] extra chỉ-only ingredient (không có trong recipe) → qty = số order có extra đó', () => {
        // cup không bị ảnh hưởng bởi size_l (amount=0 trong extraIngredients), chỉ recipe mới có
        // Nhưng nếu extra thêm ingredient mới hoàn toàn không có trong recipe:
        const recipesLocal = [{ product_id: 'p1', ingredient: 'coffee_g', amount: 10 }];
        const extraIngsLocal = { topping: [{ ingredient: 'tran_chau', amount: 50 }] };
        const orders = [
            { productId: 'p1', qty: 3, extras: [] },
            { productId: 'p1', qty: 2, extras: [{ id: 'topping' }] },
        ];
        const result = calculateConsumptionBreakdown(orders, recipesLocal, extraIngsLocal, [{ id: 'p1', name: 'P1' }]);
        // coffee_g: 5 cups tổng
        expect(result['coffee_g']['p1'].qty).toBe(5);
        expect(result['coffee_g']['p1'].totalAmount).toBe(50);
        // tran_chau: chỉ 2 cups có topping
        expect(result['tran_chau']['p1'].qty).toBe(2);
        expect(result['tran_chau']['p1'].totalAmount).toBe(100);
    });

    it('[qty] extra âm (swap ly nhỏ → ly lớn) → qty của ingredient bị ảnh hưởng không bị double-count', () => {
        // ly_swap: LyNho=-1, LyLon=+1
        const recipesLocal = [
            { product_id: 'p1', ingredient: 'LyNho', amount: 1 },
            { product_id: 'p1', ingredient: 'coffee_g', amount: 17 },
        ];
        const extraIngsLocal = { ly_lon: [{ ingredient: 'LyNho', amount: -1 }, { ingredient: 'LyLon', amount: 1 }] };
        const orders = [{ productId: 'p1', qty: 5, extras: [{ id: 'ly_lon' }] }];
        const result = calculateConsumptionBreakdown(orders, recipesLocal, extraIngsLocal, [{ id: 'p1', name: 'P1' }]);
        // LyNho: base +1, extra -1 → totalAmount=0 → entry có thể tồn tại với total=0
        expect(result['LyNho']['p1'].qty).toBe(5);       // 5 ly thực, không phải 10
        expect(result['LyNho']['p1'].totalAmount).toBe(0);
        // LyLon: chỉ từ extra → qty=5
        expect(result['LyLon']['p1'].qty).toBe(5);
        expect(result['LyLon']['p1'].totalAmount).toBe(5);
    });

    it('[qty] tổng breakdown totalAmount khớp calculateEstimatedConsumption (invariant)', () => {
        const orders = [
            { productId: 'cf_den', qty: 5, extras: [] },
            { productId: 'cf_sua', qty: 3, extras: [{ id: 'size_l' }] },
        ];
        const total = calculateEstimatedConsumption(orders, recipes, extraIngredients);
        const breakdown = calculateConsumptionBreakdown(orders, recipes, extraIngredients, products);
        for (const [ingredient, byProduct] of Object.entries(breakdown)) {
            const sum = Math.round(Object.values(byProduct).reduce((s, e) => s + e.totalAmount, 0) * 10) / 10;
            expect(sum).toBe(total[ingredient] ?? 0);
        }
    });

    it('[qty] nhiều extras trên cùng 1 order, mỗi extra ảnh hưởng ingredient khác nhau → qty đúng cho từng', () => {
        const recipesLocal = [{ product_id: 'p1', ingredient: 'coffee_g', amount: 17 }];
        const extraIngsLocal = {
            size_l: [{ ingredient: 'coffee_g', amount: 5 }],
            topping: [{ ingredient: 'tran_chau', amount: 50 }],
        };
        const orders = [{ productId: 'p1', qty: 2, extras: [{ id: 'size_l' }, { id: 'topping' }] }];
        const result = calculateConsumptionBreakdown(orders, recipesLocal, extraIngsLocal, [{ id: 'p1', name: 'P1' }]);
        expect(result['coffee_g']['p1'].qty).toBe(2);           // không double-count
        expect(result['coffee_g']['p1'].totalAmount).toBe(44);  // 2*(17+5)
        expect(result['tran_chau']['p1'].qty).toBe(2);
        expect(result['tran_chau']['p1'].totalAmount).toBe(100);
    });
});
