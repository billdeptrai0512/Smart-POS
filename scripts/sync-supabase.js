import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');

const getEnv = (key) => {
    const match = envContent.match(new RegExp(`${key}=(.*)`));
    return match ? match[1].trim() : null;
};

const supabaseUrl = getEnv('VITE_SUPABASE_URL');
const supabaseKey = getEnv('VITE_SUPABASE_ANON_KEY');

// Default costs from constants.js
const INGREDIENT_COSTS = {
    coffee_g: 250,
    cacao_powder_g: 650,
    matcha_powder_g: 1000,
    sugar_g: 19,
    rich_g: 150,
    condensed_milk_ml: 50,
    fresh_milk_ml: 35,
    cup: 800,
    lid: 200,
};

// Default recipes from orderService.js
const DEMO_RECIPES = [
    { product_id: '11111111-1111-1111-1111-111111111101', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111101', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111101', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111102', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'coffee_g', amount: 10 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'fresh_milk_ml', amount: 50 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'condensed_milk_ml', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111103', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'coffee_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'fresh_milk_ml', amount: 60 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'sugar_g', amount: 10 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111104', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'salt_cream_ml', amount: 40 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111105', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111106', ingredient: 'coffee_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111106', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111106', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'cacao_powder_g', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'fresh_milk_ml', amount: 40 },
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111107', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'matcha_powder_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'condensed_milk_ml', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'fresh_milk_ml', amount: 60 },
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111108', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'coffee_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'cacao_powder_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'condensed_milk_ml', amount: 30 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'fresh_milk_ml', amount: 40 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111109', ingredient: 'lid', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'matcha_powder_g', amount: 15 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'condensed_milk_ml', amount: 20 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'fresh_milk_ml', amount: 60 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'salt_cream_ml', amount: 40 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'cup', amount: 1 },
    { product_id: '11111111-1111-1111-1111-111111111110', ingredient: 'lid', amount: 1 }
];

const supabase = createClient(supabaseUrl, supabaseKey);

async function sync() {
    console.log('🔄 Đang đồng bộ Giá nguyên liệu (Costs)...');
    let costCount = 0;
    for (const [ingredient, cost] of Object.entries(INGREDIENT_COSTS)) {
        const { error } = await supabase
            .from('ingredient_costs')
            .upsert({ ingredient, unit_cost: cost }, { onConflict: 'ingredient' });
        if (error) {
            console.error('❌ Lỗi khi đồng bộ giá của', ingredient, error);
        } else {
            costCount++;
        }
    }
    console.log(`✅ Đồng bộ xong ${costCount} mục giá nguyên liệu.`);

    console.log('\n🔄 Đang đồng bộ Công thức rỗng/mặc định (Recipes)...');

    // Delete existing recipes for the demo products and insert fresh ones
    const productIds = [...new Set(DEMO_RECIPES.map(r => r.product_id))];
    if (productIds.length > 0) {
        const { error: delError } = await supabase
            .from('recipes')
            .delete()
            .in('product_id', productIds);

        if (delError) {
            console.error('❌ Lỗi khi xóa công thức cũ:', delError);
        } else {
            console.log(`Đã xóa công thức cũ cho ${productIds.length} sản phẩm.`);

            const { error: insError } = await supabase
                .from('recipes')
                .insert(DEMO_RECIPES);

            if (insError) {
                console.error('❌ Lỗi khi chèn công thức mới:', insError);
            } else {
                console.log(`✅ Đã chèn thành công ${DEMO_RECIPES.length} mục công thức.`);
            }
        }
    }

    console.log('\n🎉 ĐỒNG BỘ HOÀN TẤT!');
}

sync();
