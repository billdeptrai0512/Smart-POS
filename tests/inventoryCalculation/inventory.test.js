import { describe, it, expect } from 'vitest';
import { calculateItemCost, calculateEstimatedConsumption } from '../../src/utils/inventory';

describe('Inventory Calculation Logic', () => {
    // Mock DB Data
    const recipes = [
        { product_id: 'cafe_sua', ingredient: 'CaPhe', amount: 20 },
        { product_id: 'cafe_sua', ingredient: 'SuaDac', amount: 30 },
        { product_id: 'cafe_sua', ingredient: 'LyNho', amount: 1 },
    ];

    const extraIngredients = {
        'ly_lon': [
            { ingredient: 'LyNho', amount: -1 }, // Trừ ly nhỏ
            { ingredient: 'LyLon', amount: 1 },  // Thêm ly lớn
            { ingredient: 'CaPhe', amount: 7 }   // Thêm 7g cafe
        ],
        'them_tran_chau': [
            { ingredient: 'TranChau', amount: 50 } // Thêm 50g trân châu
        ]
    };

    const ingredientCosts = {
        'CaPhe': 200,   // 200đ / gram
        'SuaDac': 100,  // 100đ / ml
        'LyNho': 1000,  // 1000đ / cái
        'LyLon': 1500,  // 1500đ / cái
        'TranChau': 50  // 50đ / gram
    };

    it('tính giá vốn (COGS) cho món chính (không có tuỳ chọn)', () => {
        const cost = calculateItemCost('cafe_sua', [], recipes, extraIngredients, ingredientCosts);
        // (20 * 200) + (30 * 100) + (1 * 1000) = 4000 + 3000 + 1000 = 8000
        expect(cost).toBe(8000);
    });

    it('tính giá vốn cho món có tuỳ chọn thay thế (Ly lớn) và thêm (Trân Châu)', () => {
        const extras = [{ id: 'ly_lon' }, { id: 'them_tran_chau' }];
        const cost = calculateItemCost('cafe_sua', extras, recipes, extraIngredients, ingredientCosts);

        // Món chính: 8000
        // Ly lớn: (-1 * 1000) + (1 * 1500) + (7 * 200) = -1000 + 1500 + 1400 = 1900
        // Trân châu: 50 * 50 = 2500
        // Tổng: 8000 + 1900 + 2500 = 12400
        expect(cost).toBe(12400);
    });

    it('tính số lượng tiêu hao dự kiến cho 1 ly bình thường', () => {
        const orders = [{ product_id: 'cafe_sua', qty: 1, extras: [] }];
        const consumption = calculateEstimatedConsumption(orders, recipes, extraIngredients);

        expect(consumption).toEqual({
            'CaPhe': 20,
            'SuaDac': 30,
            'LyNho': 1
        });
    });

    it('tính số lượng tiêu hao dự kiến khi đổi sang Ly lớn (bù trừ âm vỏ ly, cộng thêm định lượng Cà phê)', () => {
        const orders = [{ product_id: 'cafe_sua', qty: 2, extras: [{ id: 'ly_lon' }] }];
        // Mua 2 ly sữa size L
        // Món chính: CaPhe(40), SuaDac(60), LyNho(2)
        // Extra (2x): LyNho(-2), LyLon(2), CaPhe(14)
        // Tổng: CaPhe(54), SuaDac(60), LyNho(0 -> bị xoá khỏi danh sách), LyLon(2)

        const consumption = calculateEstimatedConsumption(orders, recipes, extraIngredients);

        expect(consumption).toEqual({
            'CaPhe': 54,
            'SuaDac': 60,
            // LyNho bị xoá vì tổng bằng 0
            'LyLon': 2
        });
    });
});
