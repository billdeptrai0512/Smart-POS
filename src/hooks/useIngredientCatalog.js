import { useState, useEffect, useCallback } from 'react'
import { fetchIngredientCostsWithUnits } from '../services/orderService'
import { sortIngredients } from '../utils/ingredients'

// Danh mục nguyên liệu (giá vốn + đơn vị), sắp theo thứ tự cấu hình của địa chỉ.
// Tách khỏi useShiftInventoryState vì đây là dữ liệu MASTER, không liên quan gì
// tới state kiểm kê/baseline/đồng bộ đa thiết bị của 1 ca — reload độc lập,
// không đọc/ghi baseline.
export function useIngredientCatalog(addressId, ingredientSortOrder) {
    const [ingredientsList, setIngredientsList] = useState([])
    const [isLoadingIngredients, setIsLoadingIngredients] = useState(true)

    const reloadIngredients = useCallback(() => {
        if (addressId === undefined) { setIsLoadingIngredients(false); return Promise.resolve() }
        setIsLoadingIngredients(true)
        return fetchIngredientCostsWithUnits(addressId).then(list => {
            // Loại nguyên liệu được tắt "kiểm kê hao hụt" (count_in_audit === false).
            // Thiếu cờ (phiếu cũ / chưa migrate) → mặc định hiện.
            const sorted = [...list]
                .filter(r => r.count_in_audit !== false)
                .sort((a, b) => sortIngredients(a.ingredient, b.ingredient, ingredientSortOrder))
            setIngredientsList(sorted)
        }).finally(() => setIsLoadingIngredients(false))
    }, [addressId, ingredientSortOrder])

    // Fetch-on-mount + refetch-on-dep-change; reloadIngredients sets isLoading=true
    // synchronously before the async fetch so the very first render already shows
    // loading state. Same intentional pattern as useHistoryRangeFetch.js.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { reloadIngredients() }, [reloadIngredients])

    return { ingredientsList, isLoadingIngredients, reloadIngredients }
}
