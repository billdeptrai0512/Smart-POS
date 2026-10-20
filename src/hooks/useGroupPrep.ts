import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { fetchIngredientStocks } from '../services/ingredientStockService'
import { fetchIngredientCostsAndUnits } from '../services/ingredientCostService'
import { fetchAllRecipes } from '../services/recipeService'
import { fetchExtraIngredients, fetchBatchKeys } from '../services/productService'
import { fetchForecastDays } from '../services/reportService'
import { historicalCache } from '../services/cache'
import { withCounterEstimate } from '../services/counterEstimate'
import { forecastFromWeeks } from '../utils/inventory'
import { buildGroupPrepPlan, HISTORY_OFFSETS_TOMORROW, RECENT_OFFSETS_TOMORROW, type GroupPrepBranch } from '../utils/prepToday'
import type { Row } from '../types/domain'
import type { ExtraIngredients, RecipeRow } from '../utils/inventory'
import type { UsageMap } from '../utils/inventory'

// Phần KHÔNG đổi sau khi nhập kho (công thức, cấu hình NVL, dự báo mai) — giữ lại để làm tươi chỉ tồn kho + tồn quầy.
interface Static { extra: ExtraIngredients; recipes: Record<string, RecipeRow[]> }
const stockMap = (rows: Row[] | null | undefined, field: string) => Object.fromEntries((rows ?? []).map(s => [s.ingredient, s[field]]))

interface State { branches: GroupPrepBranch[] | null; pool: UsageMap | null; loading: boolean; error: unknown }

// Số liệu "Soạn kho nhóm": tải công thức / cấu hình / tồn quầy / dự báo mai của TỪNG chi nhánh trong nhóm kho chung
// (mỗi chi nhánh có công thức + quy cách riêng nên không dùng được ProductContext của địa chỉ đang chọn), rồi gộp bằng
// buildGroupPrepPlan. Chỉ đọc. ~5 request × số chi nhánh mỗi lần tải.
// addresses: [{ id, name }] gồm cả địa chỉ đang chọn.
//   branches: [{ id, name, ingredientsList, counterStock, forecast }]; pool: kho tổng chung { ing: số }.
export function useGroupPrep(addresses: { id: string; name: string }[], minAsFloor = false) {
    const [state, setState] = useState<State>({ branches: null, pool: null, loading: false, error: null })
    const key = addresses.map(a => a.id).join('|')
    const staticRef = useRef<Static | null>(null)

    const load = useCallback(async () => {
        setState(s => ({ ...s, loading: true, error: null }))
        try {
            // Không phụ thuộc chi nhánh nên dùng chung 1 lần đọc (cache 5 phút + gộp các hook cùng lúc) — trước đây mỗi kho tự đọc lại bảng này.
            const extraP = historicalCache.through(['extraIngredients'], () => fetchExtraIngredients())
            const recipesById: Static['recipes'] = {}
            const results = await Promise.all(addresses.map(async ({ id, name }) => {
                const recipesP = fetchAllRecipes(id).then(r => (recipesById[id] = r))
                const stocksP = fetchIngredientStocks(id)
                // Ước tính tồn quầy cần công thức + extras + tồn — nối chuỗi thay vì chờ cả lô, để dự báo/cấu hình tải chồng lên.
                const estimatedP = Promise.all([stocksP, recipesP, extraP])
                    .then(([stocks, recipes, extraIngredients]) => withCounterEstimate(stocks, id, { recipes, extraIngredients, canPersist: false }))
                const weeksP = fetchForecastDays(id, HISTORY_OFFSETS_TOMORROW, RECENT_OFFSETS_TOMORROW)
                const [{ rows }, recipes, stocks, estimated, weeks, extraIngredients, batchKeys] =
                    await Promise.all([fetchIngredientCostsAndUnits(id), recipesP, stocksP, estimatedP, weeksP, extraP, fetchBatchKeys(id)])
                return {
                    warehouse: stockMap(stocks, 'warehouse_stock'),
                    branch: {
                        id, name,
                        // Thành phẩm tự làm, không mua/lấy từ kho → loại khỏi danh sách soạn.
                        ingredientsList: rows.filter((i: Row) => !batchKeys.has(i.ingredient)),
                        forecast: forecastFromWeeks(weeks, recipes, extraIngredients),
                        sampleDays: weeks.filter((w: Row[]) => w.length).length,
                        counterStock: stockMap(estimated, 'counter_stock'),
                    },
                }
            }))
            staticRef.current = { extra: await extraP, recipes: recipesById }
            // Kho tổng là 1 pool chung — mọi chi nhánh trả cùng số, lấy của chi nhánh đầu.
            setState({ branches: results.map(r => r.branch), pool: results[0].warehouse, loading: false, error: null })
        } catch (error) {
            console.error('useGroupPrep', error)
            setState({ branches: null, pool: null, loading: false, error })
        }
        // addresses đổi identity mỗi render — phụ thuộc vào `key` (danh sách id).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])

    // Sau khi nhập kho chỉ tồn kho + tồn quầy đổi → đọc lại đúng 2 thứ đó (~2 request/chi nhánh thay vì ~6); chưa có gì để tái dùng / lỗi thì tải đầy đủ.
    const reload = useCallback(async () => {
        const st = staticRef.current
        if (!st) return load()
        try {
            const results = await Promise.all(addresses.map(async ({ id }) => {
                const stocks = await fetchIngredientStocks(id)
                const estimated = await withCounterEstimate(stocks, id, { recipes: st.recipes[id], extraIngredients: st.extra, canPersist: false })
                return { id, warehouse: stockMap(stocks, 'warehouse_stock'), counterStock: stockMap(estimated, 'counter_stock') }
            }))
            setState(s => ({
                ...s,
                pool: results[0].warehouse,
                branches: s.branches && s.branches.map(b => ({ ...b, counterStock: results.find(r => r.id === b.id)?.counterStock ?? b.counterStock })),
            }))
        } catch (error) {
            console.error('useGroupPrep reload', error)
            return load()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, key])

    useEffect(() => { load() }, [load])
    const plan = useMemo(
        () => state.branches && buildGroupPrepPlan({ branches: state.branches, pool: state.pool, minAsFloor }),
        [state.branches, state.pool, minAsFloor])
    // Cấu hình đơn vị CHUNG của kho cho mỗi nguyên liệu (đơn vị gốc + quy cách nhập): lấy của địa chỉ đầu danh sách, địa chỉ nào
    // thiếu thì mượn của địa chỉ kế — mọi số trên UI nhóm kho đọc qua đây để gọi tên đơn vị giống nhau.
    const cfgOf = useMemo(() => {
        const m: Record<string, Row> = {}
        for (const b of state.branches || []) for (const i of b.ingredientsList) m[i.ingredient] ??= i
        return m
    }, [state.branches])
    return { ...state, plan, cfgOf, reload }
}
