import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchIngredientStocks } from '../services/ingredientStockService'
import { fetchIngredientCostsAndUnits } from '../services/ingredientCostService'
import { fetchAllRecipes } from '../services/recipeService'
import { fetchExtraIngredients } from '../services/productService'
import { fetchLastWeekSameDayOrderItems } from '../services/reportService'
import { withCounterEstimate } from '../services/counterEstimate'
import { forecastFromWeeks } from '../utils/inventory'
import { buildGroupPrepPlan, HISTORY_OFFSETS_TOMORROW } from '../utils/prepToday'

// Số liệu "Soạn kho nhóm": tải công thức / cấu hình / tồn quầy / dự báo mai của TỪNG chi nhánh trong nhóm kho chung
// (mỗi chi nhánh có công thức + quy cách riêng nên không dùng được ProductContext của địa chỉ đang chọn), rồi gộp bằng
// buildGroupPrepPlan. Chỉ đọc. ~5 request × số chi nhánh mỗi lần tải.
// addresses: [{ id, name }] gồm cả địa chỉ đang chọn.
//   branches: [{ id, name, ingredientsList, counterStock, forecast }]; pool: kho tổng chung { ing: số }.
export function useGroupPrep(addresses) {
    const [state, setState] = useState({ branches: null, pool: null, loading: false, error: null })
    const key = addresses.map(a => a.id).join('|')

    const load = useCallback(async () => {
        setState(s => ({ ...s, loading: true, error: null }))
        try {
            const extraP = fetchExtraIngredients() // không phụ thuộc chi nhánh — chạy song song với mọi thứ khác
            const results = await Promise.all(addresses.map(async ({ id, name }) => {
                const recipesP = fetchAllRecipes(id)
                const stocksP = fetchIngredientStocks(id)
                // Ước tính tồn quầy cần công thức + extras + tồn — nối chuỗi thay vì chờ cả lô, để dự báo/cấu hình tải chồng lên.
                const estimatedP = Promise.all([stocksP, recipesP, extraP])
                    .then(([stocks, recipes, extraIngredients]) => withCounterEstimate(stocks, id, { recipes, extraIngredients, canPersist: false }))
                const weeksP = Promise.all(HISTORY_OFFSETS_TOMORROW.map(d => fetchLastWeekSameDayOrderItems(id, d)))
                const [{ rows }, recipes, stocks, estimated, weeks, extraIngredients] =
                    await Promise.all([fetchIngredientCostsAndUnits(id), recipesP, stocksP, estimatedP, weeksP, extraP])
                return {
                    warehouse: Object.fromEntries(stocks.map(s => [s.ingredient, s.warehouse_stock])),
                    branch: {
                        id, name, ingredientsList: rows,
                        forecast: forecastFromWeeks(weeks, recipes, extraIngredients),
                        counterStock: Object.fromEntries(estimated.map(s => [s.ingredient, s.counter_stock])),
                    },
                }
            }))
            // Kho tổng là 1 pool chung — mọi chi nhánh trả cùng số, lấy của chi nhánh đầu.
            setState({ branches: results.map(r => r.branch), pool: results[0].warehouse, loading: false, error: null })
        } catch (error) {
            console.error('useGroupPrep', error)
            setState({ branches: null, pool: null, loading: false, error })
        }
        // addresses đổi identity mỗi render — phụ thuộc vào `key` (danh sách id).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])

    useEffect(() => { load() }, [load])
    const plan = useMemo(() => state.branches && buildGroupPrepPlan({ branches: state.branches, pool: state.pool }), [state.branches, state.pool])
    return { ...state, plan, reload: load }
}
